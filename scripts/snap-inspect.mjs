// Diagnostic for the form-snap detector. Loads the bundled fixtures with
// pdfjs's Node-friendly legacy build, dumps the categories of geometric
// primitives the page's operator list contains, and runs the current detector
// to report row count. Run with: node scripts/snap-inspect.mjs
//
// Not part of the test suite — kept around so iterating on the heuristic
// stays driven by real-form data instead of guesswork.

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')

const FIXTURES = [
  'public/fixtures/forms/f1040-2022.pdf',
  'public/fixtures/forms/f1040-2010.pdf',
  'public/fixtures/forms/prefilled_f1040.pdf',
  'public/fixtures/forms/uscis-i9-2011.pdf',
  'public/fixtures/forms/bug1947248_forms.pdf',
  'public/fixtures/forms/annotation-tx.pdf',
  'public/fixtures/forms/annotation-tx2.pdf',
  'public/fixtures/forms/annotation-tx3.pdf',
  'public/fixtures/forms/annotation-text-widget.pdf',
  'public/fixtures/forms/annotation-button-widget.pdf',
  'public/fixtures/forms/annotation-choice-widget.pdf',
  'public/fixtures/forms/widget_hidden_print.pdf',
  'public/fixtures/forms/irs-w9.pdf',
  'public/fixtures/forms/irs-w4.pdf',
  'public/fixtures/forms/irs-schedule-a.pdf',
  'public/fixtures/forms/annotation-freetext.pdf',
  'public/fixtures/forms/xfa-imm1344e.pdf',
  'public/fixtures/forms/de-anmeldung.pdf',
  'public/fixtures/forms/de-krankmeldung.pdf',
  'public/fixtures/forms/de-kuendigung.pdf',
  'public/fixtures/forms/de-mietvertrag.pdf',
  'public/fixtures/forms/de-rechnung.pdf',
  'public/fixtures/forms/de-drv-v0005-rente.pdf',
]

function classify(opList, OPS) {
  const buckets = {
    horizontal: [],   // {y, xs, xe, w}
    vertical:   [],   // {x, ys, ye, h}
    rect:       [],   // {x, y, w, h}
    other:      0,
  }
  for (let i = 0; i < opList.fnArray.length; i++) {
    if (opList.fnArray[i] !== OPS.constructPath) continue
    const args = opList.argsArray[i]
    const minMax = args[2]
    if (!minMax || minMax.length < 4) continue
    const [xmin, ymin, xmax, ymax] = minMax
    const w = xmax - xmin
    const h = ymax - ymin
    if (h < 1 && w > 30) buckets.horizontal.push({ y: ymin, xs: xmin, xe: xmax, w })
    else if (w < 1 && h > 10) buckets.vertical.push({ x: xmin, ys: ymin, ye: ymax, h })
    else if (w > 5 && h > 5) buckets.rect.push({ x: xmin, y: ymin, w, h })
    else buckets.other++
  }
  return buckets
}

// Inline JS copy of the *new* detector — keeps the diagnostic runnable without
// a TS toolchain. Mirrors src/utils/detectFormRows.ts; bump both together.
const RECT_MIN_W = 20, RECT_MAX_W = 520, RECT_MIN_H = 9, RECT_MAX_H = 28
const FINAL_MIN_H = 8, FINAL_MAX_H = 40, FINAL_MIN_W = 12

function overlapFraction(a, b) {
  const ix = Math.max(0, Math.min(a.xEnd, b.xEnd) - Math.max(a.xStart, b.xStart))
  const iy = Math.max(0, Math.min(a.topY + a.height, b.topY + b.height) - Math.max(a.topY, b.topY))
  const inter = ix * iy
  if (inter === 0) return 0
  const minArea = Math.min((a.xEnd - a.xStart) * a.height, (b.xEnd - b.xStart) * b.height)
  return minArea > 0 ? inter / minArea : 0
}

function mulMat(a, b) {
  return [
    a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1],
    a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3],
    a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5],
  ]
}
function applyMat(m, x, y) { return [m[0]*x + m[2]*y + m[4], m[1]*x + m[3]*y + m[5]] }

async function detect(page, OPS, pdfPageHeight) {
  const opList = await page.getOperatorList()
  const hLines = []
  const vLines = []
  const rectCells = []
  let ctm = [1, 0, 0, 1, 0, 0]
  const stack = []
  for (let i = 0; i < opList.fnArray.length; i++) {
    const op = opList.fnArray[i]
    if (op === OPS.save) { stack.push([...ctm]); continue }
    if (op === OPS.restore) { const p = stack.pop(); if (p) ctm = p; continue }
    if (op === OPS.transform) { ctm = mulMat(ctm, opList.argsArray[i]); continue }
    if (op !== OPS.constructPath) continue
    const minMax = opList.argsArray[i][2]
    if (!minMax || minMax.length < 4) continue
    const [ax, ay] = applyMat(ctm, minMax[0], minMax[1])
    const [bx, by] = applyMat(ctm, minMax[2], minMax[3])
    const xmin = Math.min(ax, bx), xmax = Math.max(ax, bx)
    const ymin = Math.min(ay, by), ymax = Math.max(ay, by)
    const w = xmax - xmin, h = ymax - ymin
    if (h < 1 && w > 30) {
      hLines.push({ topY: pdfPageHeight - ymax, xStart: xmin, xEnd: xmax })
    } else if (w < 1 && h > 10) {
      vLines.push({ x: xmin, topYTop: pdfPageHeight - ymax, topYBottom: pdfPageHeight - ymin })
    } else if (w >= RECT_MIN_W && w <= RECT_MAX_W && h >= RECT_MIN_H && h <= RECT_MAX_H) {
      rectCells.push({ topY: pdfPageHeight - ymax, height: h, xStart: xmin, xEnd: xmax })
    }
  }
  const cells = []
  for (const r of rectCells) {
    const dup = cells.find((c) =>
      Math.abs(c.topY - r.topY) < 1 && Math.abs(c.xStart - r.xStart) < 1 &&
      Math.abs(c.height - r.height) < 1 && Math.abs(c.xEnd - r.xEnd) < 1,
    )
    if (!dup) cells.push(r)
  }

  const sorted = [...hLines].sort((a, b) => a.topY - b.topY)
  const groups = []
  for (const line of sorted) {
    const fit = groups.find((g) => {
      const ref = g[0]
      return Math.abs(ref.xStart - line.xStart) < 6 && Math.abs(ref.xEnd - line.xEnd) < 6
    })
    if (fit) fit.push(line); else groups.push([line])
  }
  const UNDERLINE_CAP_HEIGHT = 18
  const isUnderlineStyle = cells.length < 5 && hLines.length >= 4
  const lineRows = []
  for (const g of groups) {
    if (g.length < 2) {
      if (!isUnderlineStyle) continue
      const line = g[0]
      const top = line.topY - UNDERLINE_CAP_HEIGHT
      if (top < 0) continue
      if (line.xEnd - line.xStart < FINAL_MIN_W) continue
      lineRows.push({ topY: top, height: UNDERLINE_CAP_HEIGHT, xStart: line.xStart, xEnd: line.xEnd })
      continue
    }
    for (let i = 1; i < g.length; i++) {
      const top = g[i - 1].topY
      const bottom = g[i].topY
      const height = bottom - top
      if (height < FINAL_MIN_H || height > FINAL_MAX_H) continue
      lineRows.push({ topY: top, height, xStart: g[i].xStart, xEnd: g[i].xEnd })
    }
  }
  const lineCells = []
  for (const row of lineRows) {
    const rowTop = row.topY, rowBottom = row.topY + row.height
    const xs = new Set()
    for (const v of vLines) {
      const overlap = Math.max(0, Math.min(v.topYBottom, rowBottom) - Math.max(v.topYTop, rowTop))
      if (overlap > row.height * 0.8 && v.x > row.xStart + 2 && v.x < row.xEnd - 2) {
        xs.add(Math.round(v.x * 10) / 10)
      }
    }
    const splits = [...xs].sort((a, b) => a - b)
    const cuts = [row.xStart, ...splits, row.xEnd]
    for (let i = 0; i < cuts.length - 1; i++) {
      const xStart = cuts[i], xEnd = cuts[i + 1]
      if (xEnd - xStart < FINAL_MIN_W) continue
      lineCells.push({ topY: row.topY, height: row.height, xStart, xEnd })
    }
  }
  let rectOverlapDrops = 0
  for (const lc of lineCells) {
    if (cells.some((rc) => overlapFraction(rc, lc) > 0.5)) { rectOverlapDrops++; continue }
    cells.push(lc)
  }
  const filtered = cells.filter((c) =>
    c.height >= FINAL_MIN_H && c.height <= FINAL_MAX_H && c.xEnd - c.xStart >= FINAL_MIN_W,
  )
  filtered.sort((a, b) => (a.height * (a.xEnd - a.xStart)) - (b.height * (b.xEnd - b.xStart)))
  return { cells: filtered, hLines, vLines, lineRows, rectOverlapDrops, dedupedRects: cells.length - lineCells.length + rectOverlapDrops }
}

for (const f of FIXTURES) {
  const data = readFileSync(join(root, f))
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data), isEvalSupported: false, disableFontFace: true }).promise
  console.log('\n=== ' + f + ' (' + doc.numPages + ' pages) ===')
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const opList = await page.getOperatorList()
    const vp = page.getViewport({ scale: 1 })
    const buckets = classify(opList, pdfjs.OPS)
    console.log(`  page ${p}: ${vp.width.toFixed(1)} × ${vp.height.toFixed(1)} pt`)
    console.log(`  primitives: H=${buckets.horizontal.length}  V=${buckets.vertical.length}  rect=${buckets.rect.length}  other=${buckets.other}`)
    if (buckets.horizontal.length) {
      const lengths = buckets.horizontal.map((l) => l.w).sort((a, b) => a - b)
      console.log(`  H widths: min=${lengths[0].toFixed(1)} med=${lengths[Math.floor(lengths.length/2)].toFixed(1)} max=${lengths[lengths.length-1].toFixed(1)}`)
    }
    if (buckets.vertical.length) {
      const heights = buckets.vertical.map((l) => l.h).sort((a, b) => a - b)
      console.log(`  V heights: min=${heights[0].toFixed(1)} med=${heights[Math.floor(heights.length/2)].toFixed(1)} max=${heights[heights.length-1].toFixed(1)}`)
    }
    if (buckets.rect.length) {
      const ws = buckets.rect.map((r) => r.w).sort((a, b) => a - b)
      const hs = buckets.rect.map((r) => r.h).sort((a, b) => a - b)
      console.log(`  rect w: min=${ws[0].toFixed(1)} med=${ws[Math.floor(ws.length/2)].toFixed(1)} max=${ws[ws.length-1].toFixed(1)}`)
      console.log(`  rect h: min=${hs[0].toFixed(1)} med=${hs[Math.floor(hs.length/2)].toFixed(1)} max=${hs[hs.length-1].toFixed(1)}`)
    }
    // What rect-based detection (with sensible filters) would yield, by itself.
    const rectCells = buckets.rect.filter((r) =>
      r.w >= 20 && r.w <= 520 && r.h >= 9 && r.h <= 28,
    )
    // Dedupe within ±1pt
    const dedupedRects = []
    for (const r of rectCells) {
      const dup = dedupedRects.find((d) =>
        Math.abs(d.x - r.x) < 1 && Math.abs(d.y - r.y) < 1 &&
        Math.abs(d.w - r.w) < 1 && Math.abs(d.h - r.h) < 1,
      )
      if (!dup) dedupedRects.push(r)
    }
    console.log(`  rect-only → ${rectCells.length} raw cells, ${dedupedRects.length} after ±1pt dedupe`)
    if (dedupedRects.length) {
      const heights = dedupedRects.map((r) => r.h).sort((a, b) => a - b)
      const widths = dedupedRects.map((r) => r.w).sort((a, b) => a - b)
      console.log(`    h: min=${heights[0].toFixed(1)} med=${heights[Math.floor(heights.length/2)].toFixed(1)} max=${heights[heights.length-1].toFixed(1)}`)
      console.log(`    w: min=${widths[0].toFixed(1)} med=${widths[Math.floor(widths.length/2)].toFixed(1)} max=${widths[widths.length-1].toFixed(1)}`)
    }

    const det = await detect(page, pdfjs.OPS, vp.height)
    // Also collect widget-derived rows the way PdfPage now does at runtime.
    const annots = await page.getAnnotations().catch(() => [])
    const widgetRows = []
    for (const a of annots) {
      if (a.subtype !== 'Widget' || !a.fieldName) continue
      if (a.fieldType !== 'Tx') continue
      const [x1, y1, x2, y2] = a.rect
      const xStart = Math.min(x1, x2), xEnd = Math.max(x1, x2)
      const topY = vp.height - Math.max(y1, y2)
      const height = Math.abs(y2 - y1)
      const width = xEnd - xStart
      if (width >= 20 && height >= 9) widgetRows.push({ topY, height, xStart, xEnd })
    }
    function over(a, b) {
      const ix = Math.max(0, Math.min(a.xEnd, b.xEnd) - Math.max(a.xStart, b.xStart))
      const iy = Math.max(0, Math.min(a.topY + a.height, b.topY + b.height) - Math.max(a.topY, b.topY))
      const inter = ix * iy
      if (inter === 0) return 0
      const m = Math.min((a.xEnd - a.xStart) * a.height, (b.xEnd - b.xStart) * b.height)
      return m > 0 ? inter / m : 0
    }
    const combined = [...det.cells]
    let widgetAdds = 0
    for (const w of widgetRows) {
      if (combined.some((c) => over(c, w) > 0.5)) continue
      combined.push(w); widgetAdds++
    }
    console.log(`  detector → ${det.cells.length} drawn cells; widgets → ${widgetRows.length} (${widgetAdds} new); combined → ${combined.length}`)
    if (det.cells.length) {
      const heights = det.cells.map((c) => c.height).sort((a, b) => a - b)
      const widths = det.cells.map((c) => c.xEnd - c.xStart).sort((a, b) => a - b)
      console.log(`    h: min=${heights[0].toFixed(1)} med=${heights[Math.floor(heights.length/2)].toFixed(1)} max=${heights[heights.length-1].toFixed(1)}`)
      console.log(`    w: min=${widths[0].toFixed(1)} med=${widths[Math.floor(widths.length/2)].toFixed(1)} max=${widths[widths.length-1].toFixed(1)}`)
    }
    if (det.cells.length) {
      const heights = det.cells.map((c) => c.height).sort((a, b) => a - b)
      console.log(`  cell heights: min=${heights[0].toFixed(1)} med=${heights[Math.floor(heights.length/2)].toFixed(1)} max=${heights[heights.length-1].toFixed(1)}`)
      const widths = det.cells.map((c) => c.xEnd - c.xStart).sort((a, b) => a - b)
      console.log(`  cell widths:  min=${widths[0].toFixed(1)} med=${widths[Math.floor(widths.length/2)].toFixed(1)} max=${widths[widths.length-1].toFixed(1)}`)
    }
  }
  await doc.destroy()
}
