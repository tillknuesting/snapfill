import * as pdfjsLib from 'pdfjs-dist'
import type { PDFPageProxy } from 'pdfjs-dist'

// A snappable rectangle on the page, in PDF points with top-left origin. The
// detector emits one of these per likely input cell. Two recognition modes
// feed into the result:
//   1. **Boxed inputs.** Modern forms draw fields as rectangles. Each
//      reasonably-sized rectangle in the operator list is a direct cell.
//   2. **Underline-style fields.** Older forms draw a horizontal rule under a
//      label. Pairs of consecutive rules with similar x-span (top edge of one
//      box, bottom edge of the next) define a row; vertical rules can split
//      that row into multiple cells.
//
// Rect cells take priority — line-derived cells that overlap a rect cell by
// more than 50% are dropped, since they describe the same field twice.
export interface FormRow {
  topY: number
  height: number
  xStart: number
  xEnd: number
}

interface RawH { topY: number; xStart: number; xEnd: number }
interface RawV { x: number; topYTop: number; topYBottom: number }

// Reasonable input-box sizes. Values picked from real-form telemetry: IRS 1040
// rects span roughly 22–380 pt wide × 9–24 pt tall; rejecting anything outside
// 20–520 × 9–28 drops page borders and section dividers without losing any
// real field. Final cells are also clamped to 8 ≤ h ≤ 40 below — that filter
// catches degenerate line-derived rows too.
const RECT_MIN_W = 20
const RECT_MAX_W = 520
const RECT_MIN_H = 9
const RECT_MAX_H = 28

const FINAL_MIN_H = 8
const FINAL_MAX_H = 40
const FINAL_MIN_W = 12

// 2D affine: [a, b, c, d, e, f] representing the matrix [[a, c, e], [b, d, f], [0, 0, 1]].
type Mat = [number, number, number, number, number, number]
const I_MAT: Mat = [1, 0, 0, 1, 0, 0]
function mulMat(a: Mat, b: Mat): Mat {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ]
}
function applyMat(m: Mat, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
}

export async function detectFormRows(page: PDFPageProxy, pdfPageHeight: number): Promise<FormRow[]> {
  const opList = await page.getOperatorList()
  const OPS = pdfjsLib.OPS
  const hLines: RawH[] = []
  const vLines: RawV[] = []
  const rectCells: FormRow[] = []

  // Track the current transformation matrix as we walk the op list. Authoring
  // tools differ in how they place rectangles: handwritten / professional
  // PDFs (the IRS forms) author paths in absolute coords, while libraries
  // like pdf-lib translate the origin via `cm` before drawing each shape at
  // (0, 0). Without applying the CTM, those library-generated forms come out
  // with every rect bbox at the origin and the dedupe collapses them all.
  let ctm: Mat = [...I_MAT] as Mat
  const stack: Mat[] = []

  for (let i = 0; i < opList.fnArray.length; i++) {
    const op = opList.fnArray[i]
    if (op === OPS.save) {
      stack.push([...ctm] as Mat)
      continue
    }
    if (op === OPS.restore) {
      const popped = stack.pop()
      if (popped) ctm = popped
      continue
    }
    if (op === OPS.transform) {
      const m = opList.argsArray[i] as Mat
      ctm = mulMat(ctm, m)
      continue
    }
    if (op !== OPS.constructPath) continue

    const minMax = opList.argsArray[i][2] as Float32Array | number[] | undefined
    if (!minMax || minMax.length < 4) continue
    // Transform the bbox corners through the active CTM and renormalise.
    const [ax, ay] = applyMat(ctm, minMax[0], minMax[1])
    const [bx, by] = applyMat(ctm, minMax[2], minMax[3])
    const xmin = Math.min(ax, bx), xmax = Math.max(ax, bx)
    const ymin = Math.min(ay, by), ymax = Math.max(ay, by)
    const w = xmax - xmin
    const h = ymax - ymin

    if (h < 1 && w > 30) {
      hLines.push({ topY: pdfPageHeight - ymax, xStart: xmin, xEnd: xmax })
    } else if (w < 1 && h > 10) {
      vLines.push({
        x: xmin,
        topYTop:    pdfPageHeight - ymax,
        topYBottom: pdfPageHeight - ymin,
      })
    } else if (w >= RECT_MIN_W && w <= RECT_MAX_W && h >= RECT_MIN_H && h <= RECT_MAX_H) {
      rectCells.push({
        topY: pdfPageHeight - ymax,
        height: h,
        xStart: xmin,
        xEnd: xmax,
      })
    }
  }

  const cells: FormRow[] = []
  for (const r of rectCells) {
    // Drop near-duplicates (forms occasionally draw a box twice for stroke + fill).
    const dup = cells.find((c) =>
      Math.abs(c.topY - r.topY) < 1 &&
      Math.abs(c.xStart - r.xStart) < 1 &&
      Math.abs(c.height - r.height) < 1 &&
      Math.abs(c.xEnd - r.xEnd) < 1,
    )
    if (!dup) cells.push(r)
  }

  // Underline-style fallback. Cluster horizontals by similar x-span; within
  // each cluster, every CONSECUTIVE pair defines a row (top edge → bottom
  // edge). Single isolated rules don't produce rows here — there's no upper
  // boundary to bound the typing area, and a 20pt cap-row guess produced
  // garbage on real forms.
  const sorted = [...hLines].sort((a, b) => a.topY - b.topY)
  const groups: RawH[][] = []
  for (const line of sorted) {
    const fit = groups.find((g) => {
      const ref = g[0]
      return Math.abs(ref.xStart - line.xStart) < 6 && Math.abs(ref.xEnd - line.xEnd) < 6
    })
    if (fit) fit.push(line)
    else groups.push([line])
  }

  // Underline-style fallback. If the page has no boxed inputs but many
  // horizontal rules, we treat each isolated long rule as the *bottom* of a
  // writing area and synthesise a cap row 18pt tall above it. This re-enables
  // snap on classic "Name: ____________" forms without re-introducing the
  // bogus cap rows that polluted modern boxed-input forms (which always have
  // many rect cells to gate on).
  const UNDERLINE_CAP_HEIGHT = 18
  // "Underline-style" pages are mostly horizontal rules with no rect cells —
  // every singleton gets a cap row. Modern boxed-input forms (which would
  // get spammed with bogus cap rows) are excluded by the rect-count check.
  const isUnderlineStyle = cells.length < 5 && hLines.length >= 4
  // Threshold: any rule wider than this is "signature-like" (not a tiny
  // tick or a section divider) and earns its own cap row even on
  // boxed-input pages — fixes the "kindergarten form's signature line at
  // the bottom doesn't snap" case.
  const SIG_LINE_MIN_WIDTH = 80

  function rectsOverlapCapRow(line: { topY: number; xStart: number; xEnd: number }): boolean {
    const capTop = line.topY - UNDERLINE_CAP_HEIGHT
    const capBottom = line.topY
    return rectCells.some((rc) =>
      rc.topY < capBottom && rc.topY + rc.height > capTop &&
      rc.xStart < line.xEnd && rc.xEnd > line.xStart,
    )
  }

  const lineRows: FormRow[] = []
  for (const g of groups) {
    if (g.length < 2) {
      const line = g[0]
      const lineWidth = line.xEnd - line.xStart
      const isLongIsolatedSignatureLine =
        lineWidth >= SIG_LINE_MIN_WIDTH && !rectsOverlapCapRow(line)
      if (!isUnderlineStyle && !isLongIsolatedSignatureLine) continue
      const top = line.topY - UNDERLINE_CAP_HEIGHT
      if (top < 0) continue
      if (lineWidth < FINAL_MIN_W) continue
      lineRows.push({
        topY: top,
        height: UNDERLINE_CAP_HEIGHT,
        xStart: line.xStart,
        xEnd: line.xEnd,
      })
      continue
    }
    for (let i = 1; i < g.length; i++) {
      const top = g[i - 1].topY
      const bottom = g[i].topY
      const height = bottom - top
      if (height < FINAL_MIN_H || height > FINAL_MAX_H) continue
      lineRows.push({
        topY: top,
        height,
        xStart: g[i].xStart,
        xEnd: g[i].xEnd,
      })
    }
  }

  // Subdivide line-derived rows by vertical rules that span ≥80% of the row.
  const lineCells: FormRow[] = []
  for (const row of lineRows) {
    const rowTop = row.topY
    const rowBottom = row.topY + row.height
    const xs = new Set<number>()
    for (const v of vLines) {
      const overlap = Math.max(0, Math.min(v.topYBottom, rowBottom) - Math.max(v.topYTop, rowTop))
      if (overlap > row.height * 0.8 && v.x > row.xStart + 2 && v.x < row.xEnd - 2) {
        xs.add(Math.round(v.x * 10) / 10)
      }
    }
    const splits = [...xs].sort((a, b) => a - b)
    const cuts = [row.xStart, ...splits, row.xEnd]
    for (let i = 0; i < cuts.length - 1; i++) {
      const xStart = cuts[i]
      const xEnd = cuts[i + 1]
      if (xEnd - xStart < FINAL_MIN_W) continue
      lineCells.push({ topY: row.topY, height: row.height, xStart, xEnd })
    }
  }

  // Dedupe line cells against rect cells. Prefer the rect — it carries
  // explicit boundaries; the line pair is just an inferred match.
  for (const lc of lineCells) {
    if (cells.some((rc) => overlapFraction(rc, lc) > 0.5)) continue
    cells.push(lc)
  }

  // Final size filter — defends against any pathological inputs that slip
  // through the detector branches (e.g. a thin horizontal rule drawn with a
  // tiny but nonzero ymax-ymin).
  const filtered = cells.filter((c) =>
    c.height >= FINAL_MIN_H &&
    c.height <= FINAL_MAX_H &&
    c.xEnd - c.xStart >= FINAL_MIN_W,
  )

  // Sort smallest-first so findRowAt prefers a tight inner cell over the
  // larger row that contains it when both match a click.
  filtered.sort((a, b) => (a.height * (a.xEnd - a.xStart)) - (b.height * (b.xEnd - b.xStart)))
  return filtered
}

function overlapFraction(a: FormRow, b: FormRow): number {
  const ix = Math.max(0, Math.min(a.xEnd, b.xEnd) - Math.max(a.xStart, b.xStart))
  const iy = Math.max(0, Math.min(a.topY + a.height, b.topY + b.height) - Math.max(a.topY, b.topY))
  const inter = ix * iy
  if (inter === 0) return 0
  const minArea = Math.min(
    (a.xEnd - a.xStart) * a.height,
    (b.xEnd - b.xStart) * b.height,
  )
  return minArea > 0 ? inter / minArea : 0
}

// Bbox used by `refineRowsWithText`. Coords match `FormRow`: top-left origin,
// PDF points. Only x/y/w/h matter — feed it raw text-run boxes from pdf.js or
// any other text source.
export interface TextBox {
  x: number
  y: number
  w: number
  h: number
}

// IRS 1040 (and many other forms) draw each input cell as a band running from
// one horizontal rule to the next, with a small printed label ("Your first
// name and initial") inside the cell at the top. The detector emits the full
// band, so a click snaps the typed text to `topY` — on top of the label,
// not on the writing strip below it.
//
// Refine each row by shrinking `topY` past any small label-shaped text sitting
// in the upper half of the row. Heuristics (deliberately conservative — we'd
// rather under-shrink than chew into a user's filled-in data on a prefilled
// PDF):
//   - text must be fully contained inside the row band, and short relative
//     to it (< 50% of row height) to qualify as a label;
//   - only labels whose top edge is in the upper half of the row count;
//   - the resulting row must still be at least FINAL_MIN_H tall.
export function refineRowsWithText(
  rows: FormRow[],
  texts: ReadonlyArray<TextBox>,
): FormRow[] {
  if (texts.length === 0) return rows
  return rows.map((row) => refineRow(row, texts))
}

function refineRow(row: FormRow, texts: ReadonlyArray<TextBox>): FormRow {
  const rowBottom = row.topY + row.height
  const inside = texts.filter((t) =>
    t.x + t.w > row.xStart + 1 &&
    t.x < row.xEnd - 1 &&
    t.y >= row.topY - 1 &&
    t.y + t.h <= rowBottom + 1 &&
    t.h < row.height * 0.5,
  )
  if (inside.length === 0) return row
  const topZone = row.topY + row.height * 0.5
  const topLabels = inside.filter((t) => t.y < topZone)
  if (topLabels.length === 0) return row
  const labelBottom = Math.max(...topLabels.map((t) => t.y + t.h))
  const newTop = labelBottom + 1
  const newHeight = rowBottom - newTop
  if (newTop <= row.topY) return row
  if (newHeight < FINAL_MIN_H) return row
  return { ...row, topY: newTop, height: newHeight }
}

// Pick which cell a click should snap to. Direct hit first (smallest already,
// since the list is pre-sorted), then nearest by vertical distance for clicks
// just above/below a row.
export function findRowAt(
  rows: FormRow[],
  xPdf: number,
  yPdf: number,
  threshold = 25,
): FormRow | null {
  for (const r of rows) {
    if (
      yPdf >= r.topY && yPdf <= r.topY + r.height &&
      xPdf >= r.xStart && xPdf <= r.xEnd
    ) return r
  }
  let best: FormRow | null = null
  let bestDy = Infinity
  for (const r of rows) {
    if (xPdf < r.xStart - 6 || xPdf > r.xEnd + 6) continue
    const center = r.topY + r.height / 2
    const dy = Math.abs(yPdf - center)
    if (dy < bestDy && dy < threshold) { best = r; bestDy = dy }
  }
  return best
}
