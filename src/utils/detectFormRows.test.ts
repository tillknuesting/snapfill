import { describe, expect, it, vi } from 'vitest'

// pdf.js requires a real browser (DOMMatrix etc.); we stub the module and
// only set the constants we need.
vi.mock('pdfjs-dist', () => ({ OPS: { constructPath: 91 } }))

import { detectFormRows, findRowAt, refineRowsWithText, type FormRow, type TextBox } from './detectFormRows'
import type { PDFPageProxy } from 'pdfjs-dist'

const ROWS: FormRow[] = [
  // Two-cell row at top
  { topY: 100, height: 20, xStart: 50,  xEnd: 200 },
  { topY: 100, height: 20, xStart: 200, xEnd: 350 },
  // Three-cell row below it
  { topY: 130, height: 20, xStart: 50,  xEnd: 150 },
  { topY: 130, height: 20, xStart: 150, xEnd: 250 },
  { topY: 130, height: 20, xStart: 250, xEnd: 350 },
  // A standalone row far down
  { topY: 400, height: 30, xStart: 80,  xEnd: 300 },
]

describe('findRowAt — direct hits', () => {
  it('returns the cell containing the click', () => {
    expect(findRowAt(ROWS, 75, 110)).toBe(ROWS[0])
    expect(findRowAt(ROWS, 250, 110)).toBe(ROWS[1])
  })

  it('disambiguates between cells in the same row', () => {
    expect(findRowAt(ROWS, 100, 140)).toBe(ROWS[2])
    expect(findRowAt(ROWS, 200, 140)).toBe(ROWS[3])
    expect(findRowAt(ROWS, 300, 140)).toBe(ROWS[4])
  })

  it('honours row boundaries (top and bottom)', () => {
    expect(findRowAt(ROWS, 100, 100)).toBe(ROWS[0])  // exact top
    expect(findRowAt(ROWS, 100, 120)).toBe(ROWS[0])  // exact bottom (inclusive)
  })
})

describe('findRowAt — proximity fallback', () => {
  it('snaps to a nearby row above the cursor when within threshold', () => {
    // Click 10pt below row at topY=100 (which ends at 120)
    expect(findRowAt(ROWS, 75, 128)).toBe(ROWS[2]) // 128 falls inside the second row band [130, 150]? No — 128 is just above 130
    // 128 is between 120 and 130 — gap. Fallback should pick whichever row's
    // center is closest. row[0]'s center is 110, row[2]'s center is 140. dy=18 vs dy=12.
  })

  it('returns null when click is far above any row on that x-range', () => {
    expect(findRowAt(ROWS, 100, 50)).toBeNull()  // 50pt above topY=100, beyond threshold
  })

  it('returns null when x is outside any row x-range', () => {
    expect(findRowAt(ROWS, 600, 110)).toBeNull()
  })

  it('respects a custom threshold', () => {
    // 50pt below top of standalone row — too far with a 25pt threshold
    expect(findRowAt(ROWS, 100, 480, 25)).toBeNull()
    // ...but acceptable if threshold is loose
    expect(findRowAt(ROWS, 100, 480, 100)).toBe(ROWS[5])
  })
})

describe('findRowAt — empty input', () => {
  it('returns null when there are no rows', () => {
    expect(findRowAt([], 100, 100)).toBeNull()
  })
})

// Minimal fake page that returns a hand-crafted operator list. constructPath
// args are [opSubArray, argSubArray, minMax] — we only need minMax to exercise
// the bbox-based detection.
function fakePage(_pageHeight: number, paths: Array<[number, number, number, number]>): PDFPageProxy {
  return {
    getOperatorList: async () => ({
      fnArray: paths.map(() => 91),
      argsArray: paths.map((mm) => [null, null, new Float32Array(mm)]),
    }),
  } as unknown as PDFPageProxy
}

describe('detectFormRows — full algorithm', () => {
  it('returns one cell per consecutive line pair (underline-style)', async () => {
    // 3 horizontal lines at PDF native y = 700, 680, 660 (so topY = 100, 120, 140
    // for a 800pt page); same x range. Spacing 20 pt → 2 consecutive pairs.
    const H = 800
    const rows = await detectFormRows(
      fakePage(H, [
        [50, 700, 500, 700],
        [50, 680, 500, 680],
        [50, 660, 500, 660],
      ]),
      H,
    )
    // 3 lines → 2 rows (one per consecutive pair). Single isolated lines used
    // to spawn a 20pt cap row above them, but that produced bogus snap targets
    // on real forms with stray decorative rules; the cap-row hack was removed.
    expect(rows).toHaveLength(2)
    rows.forEach((r) => {
      expect(r.xStart).toBeCloseTo(50, 1)
      expect(r.xEnd).toBeCloseTo(500, 1)
      expect(r.height).toBeCloseTo(20, 1)
    })
  })

  it('splits rows by a vertical divider that covers ≥80% of row height', async () => {
    const H = 800
    // Two H-lines at y=700, 680 → one row of height 20 above the lower.
    // V-line at x=200 spanning y=720→660 (covers full row band).
    const rows = await detectFormRows(
      fakePage(H, [
        [50, 700, 500, 700],
        [50, 680, 500, 680],
        [200, 660, 200, 720],
      ]),
      H,
    )
    // 2 rows × 2 cells = 4 (cap + between)
    expect(rows.length).toBeGreaterThanOrEqual(2)
    // At least one row should be split: have an xStart of 50 AND another with xStart ≈ 200
    const xs = new Set(rows.map((r) => Math.round(r.xStart)))
    expect(xs.has(50)).toBe(true)
    expect(xs.has(200)).toBe(true)
  })

  it('does not split when a vertical line covers <80% of the row', async () => {
    const H = 800
    // Two H-lines spaced 20 pt apart → row band y=680..700 in PDF native →
    // topY band 100..120. A V-line that only covers 5pt does not divide.
    const rows = await detectFormRows(
      fakePage(H, [
        [50, 700, 500, 700],
        [50, 680, 500, 680],
        [200, 695, 200, 700],  // only 5pt tall — doesn't reach 80% of 20pt
      ]),
      H,
    )
    // No splits — every row should span the full 50→500
    rows.forEach((r) => {
      expect(r.xStart).toBeCloseTo(50, 1)
      expect(r.xEnd).toBeCloseTo(500, 1)
    })
  })

  it('treats large gaps as section breaks (>1.35× median spacing)', async () => {
    const H = 1000
    // Two clusters of 3 lines at 20 pt spacing, with a 50 pt gap between clusters.
    // Median gap = 20; 50 > 1.35 × 20 = 27 → split.
    const rows = await detectFormRows(
      fakePage(H, [
        // Top cluster (PDF native y values, descending from page top)
        [50, 900, 500, 900],
        [50, 880, 500, 880],
        [50, 860, 500, 860],
        // Bottom cluster, after a 50 pt gap
        [50, 810, 500, 810],
        [50, 790, 500, 790],
        [50, 770, 500, 770],
      ]),
      H,
    )
    // No row should span the section gap (~50 pt height). All rows should be
    // close to the typical 20 pt spacing.
    const tallRows = rows.filter((r) => r.height > 35)
    expect(tallRows).toHaveLength(0)
  })

  it('ignores short horizontal segments (width ≤ 30 pt) but caps an isolated long underline', async () => {
    const H = 800
    const rows = await detectFormRows(
      fakePage(H, [
        [10, 700, 25, 700],   // only 15 pt wide — discarded as noise
        [50, 680, 200, 680],  // 150 pt wide — long isolated underline → cap row
      ]),
      H,
    )
    // Single long isolated rule (≥80pt) earns its own 18pt cap row above —
    // covers the "kindergarten form's signature line at the bottom" case.
    expect(rows).toHaveLength(1)
    expect(rows[0].height).toBe(18)
  })

  it('does NOT cap a short isolated segment (signature-line threshold = 80pt)', async () => {
    const H = 800
    const rows = await detectFormRows(
      fakePage(H, [
        [50, 680, 100, 680],  // only 50pt wide — under the 80pt sig-line threshold
      ]),
      H,
    )
    expect(rows).toHaveLength(0)
  })

  it('returns an empty array on a page with no draw ops', async () => {
    const rows = await detectFormRows(fakePage(800, []), 800)
    expect(rows).toEqual([])
  })

  it('emits a cell directly for each reasonable-sized rectangle', async () => {
    const H = 800
    // Two boxed inputs (modern form style). bbox: [xmin, ymin, xmax, ymax].
    // Box A at native y 680→700 (20pt tall), 50→200 wide → topY=100, height=20.
    // Box B at native y 600→614 (14pt tall), 50→180 wide → topY=186, height=14.
    const rows = await detectFormRows(
      fakePage(H, [
        [50, 680, 200, 700],
        [50, 600, 180, 614],
      ]),
      H,
    )
    expect(rows).toHaveLength(2)
    // Sorted smallest-first (area), so box B (14×130 = 1820) before A (20×150 = 3000).
    expect(rows[0]).toMatchObject({ topY: 186, height: 14, xStart: 50, xEnd: 180 })
    expect(rows[1]).toMatchObject({ topY: 100, height: 20, xStart: 50, xEnd: 200 })
  })

  it('drops rectangles that are too small or too large to be input fields', async () => {
    const H = 800
    const rows = await detectFormRows(
      fakePage(H, [
        [50, 700, 60,  710],   // 10×10 — too small (< 20w / < 9h passable but w fails)
        [50, 600, 70,  608],   // 20×8 — h below FINAL_MIN_H
        [50, 100, 600, 750],   // 550×650 — page-sized, too tall
        [50, 500, 200, 514],   // 150×14 — kept
      ]),
      H,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ height: 14 })
  })

  it('dedupes line-derived rows that overlap a rect cell', async () => {
    const H = 800
    // A boxed input at native y=680..700, x=50..200 (topY=100, height=20).
    // PLUS top and bottom rule lines at the same Y-positions, which
    // independently would yield a line-row at the same place. Expect 1 cell.
    const rows = await detectFormRows(
      fakePage(H, [
        [50, 680, 200, 700],   // rect cell (priority)
        [50, 700, 200, 700],   // top edge line
        [50, 680, 200, 680],   // bottom edge line
      ]),
      H,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ topY: 100, height: 20 })
  })
})

describe('refineRowsWithText — top-label shrink', () => {
  // Mirror of the IRS 1040 Name/Address cell: a 25pt-tall row band with a
  // small label "Your first name and initial" at the very top. Label is 7pt
  // tall starting at the row's topY.
  const ROW_1040: FormRow = { topY: 100, height: 25, xStart: 50, xEnd: 320 }
  const LABEL_TOP: TextBox = { x: 54, y: 101, w: 110, h: 7 }

  it('pushes topY past a small label sitting at the top of the row', () => {
    const [refined] = refineRowsWithText([ROW_1040], [LABEL_TOP])
    // Label's bottom is at y = 108 → new topY = 109, height = 100+25 - 109 = 16.
    expect(refined.topY).toBe(109)
    expect(refined.height).toBe(16)
    expect(refined.xStart).toBe(50)
    expect(refined.xEnd).toBe(320)
  })

  it('leaves the row alone when there are no text boxes', () => {
    const [refined] = refineRowsWithText([ROW_1040], [])
    expect(refined).toEqual(ROW_1040)
  })

  it('ignores text outside the row x-range', () => {
    const off: TextBox = { x: 400, y: 101, w: 50, h: 7 }
    const [refined] = refineRowsWithText([ROW_1040], [off])
    expect(refined).toEqual(ROW_1040)
  })

  it('ignores text outside the row y-range', () => {
    const above: TextBox = { x: 60, y: 50, w: 100, h: 7 }
    const below: TextBox = { x: 60, y: 200, w: 100, h: 7 }
    const [refined] = refineRowsWithText([ROW_1040], [above, below])
    expect(refined).toEqual(ROW_1040)
  })

  it('does NOT shrink when the label sits in the bottom half of the row', () => {
    // 1040-style underline forms put labels below the line; the writing area
    // is above, so we leave the cell alone.
    const bottomLabel: TextBox = { x: 60, y: 116, w: 100, h: 7 }
    const [refined] = refineRowsWithText([ROW_1040], [bottomLabel])
    expect(refined).toEqual(ROW_1040)
  })

  it('does NOT shrink when text is too tall to be a label (>= 50% row height)', () => {
    // Looks more like a user-typed value on a prefilled form than a label.
    const tall: TextBox = { x: 60, y: 102, w: 100, h: 14 }
    const [refined] = refineRowsWithText([ROW_1040], [tall])
    expect(refined).toEqual(ROW_1040)
  })

  it('does NOT shrink when shrinking would leave the row below FINAL_MIN_H', () => {
    // Tiny row + label that would consume almost everything → preserve.
    const tinyRow: FormRow = { topY: 100, height: 12, xStart: 50, xEnd: 320 }
    // Label 5pt tall starting at the very top → would leave height 6 (< 8).
    const label: TextBox = { x: 60, y: 100, w: 80, h: 5 }
    const [refined] = refineRowsWithText([tinyRow], [label])
    expect(refined).toEqual(tinyRow)
  })

  it('shrinks past the deepest label when several stack at the top', () => {
    // Two label lines stacked: "Your first name and initial" + a continuation.
    const a: TextBox = { x: 54, y: 101, w: 110, h: 6 }
    const b: TextBox = { x: 54, y: 108, w: 60,  h: 5 }
    const [refined] = refineRowsWithText([ROW_1040], [a, b])
    // Deepest bottom = 113 → new topY = 114, height = 11.
    expect(refined.topY).toBe(114)
    expect(refined.height).toBe(11)
  })

  it('only refines rows that actually contain a label — others pass through unchanged', () => {
    const otherRow: FormRow = { topY: 200, height: 25, xStart: 50, xEnd: 320 }
    const [first, second] = refineRowsWithText([ROW_1040, otherRow], [LABEL_TOP])
    expect(first.topY).toBe(109)
    expect(second).toEqual(otherRow)
  })

  it('considers a label that overlaps the x-range only partially', () => {
    // Label extends slightly past xEnd — still counts as inside.
    const label: TextBox = { x: 250, y: 101, w: 80, h: 7 } // x+w = 330 > 320
    const [refined] = refineRowsWithText([ROW_1040], [label])
    expect(refined.topY).toBe(109)
  })
})
