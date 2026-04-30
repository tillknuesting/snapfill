import { describe, expect, it, vi } from 'vitest'

// pdf.js requires a real browser (DOMMatrix etc.); we stub the module and
// only set the constants we need.
vi.mock('pdfjs-dist', () => ({ OPS: { constructPath: 91 } }))

import { detectFormRows, findRowAt, type FormRow } from './detectFormRows'
import type { PDFPageProxy } from 'pdfjs-dist'

// Build a fake PDFPageProxy that returns a hand-crafted operator list. Each
// path is a [xmin, ymin, xmax, ymax] tuple — that's all the detector reads.
function fakePage(paths: Array<[number, number, number, number]>): PDFPageProxy {
  return {
    getOperatorList: async () => ({
      fnArray: paths.map(() => 91),
      argsArray: paths.map((mm) => [null, null, new Float32Array(mm)]),
    }),
  } as unknown as PDFPageProxy
}

// Convenience builders. PDF coords are bottom-left origin; our `topY` field is
// top-left. For brevity these accept page-top coordinates and emit the
// equivalent bottom-left bbox for a 800pt-tall page.
const PAGE_H = 800
function rect(topY: number, height: number, xStart: number, xEnd: number): [number, number, number, number] {
  // bbox = [xmin, ymin, xmax, ymax] in PDF native (bottom-left).
  return [xStart, PAGE_H - (topY + height), xEnd, PAGE_H - topY]
}
function hline(topY: number, xStart: number, xEnd: number): [number, number, number, number] {
  return [xStart, PAGE_H - topY, xEnd, PAGE_H - topY]
}
function vline(x: number, topYTop: number, topYBottom: number): [number, number, number, number] {
  return [x, PAGE_H - topYBottom, x, PAGE_H - topYTop]
}

describe('detectFormRows — sort order invariant', () => {
  it('returns cells sorted smallest-area-first', async () => {
    const rows = await detectFormRows(
      fakePage([
        rect(100, 24, 50,  450),  // 400 × 24 = 9600
        rect(200, 12, 50,  200),  // 150 × 12 = 1800
        rect(300, 16, 50,  300),  // 250 × 16 = 4000
      ]),
      PAGE_H,
    )
    expect(rows).toHaveLength(3)
    const areas = rows.map((r) => (r.xEnd - r.xStart) * r.height)
    for (let i = 1; i < areas.length; i++) {
      expect(areas[i]).toBeGreaterThanOrEqual(areas[i - 1])
    }
  })

  it('findRowAt picks the smallest enclosing cell when several contain the click', async () => {
    // A wide row with a tighter cell nested inside (same vertical band, narrower x).
    const rows = await detectFormRows(
      fakePage([
        rect(100, 24, 50, 500),   // 450 × 24 — outer
        rect(100, 24, 200, 280),  // 80 × 24 — inner, nested
      ]),
      PAGE_H,
    )
    // Click inside the nested cell. We expect findRowAt to return the inner one.
    const hit = findRowAt(rows, 240, 110)
    expect(hit).not.toBeNull()
    expect(hit?.xStart).toBe(200)
    expect(hit?.xEnd).toBe(280)
  })
})

describe('detectFormRows — vertical-divider precision', () => {
  it('splits when divider overlap is *strictly greater* than 80% of row height', async () => {
    // Row band = topY 100..120 (height 20). 80% = 16pt. Divider must overlap
    // > 16pt to split. Make it 17pt to land just above the threshold.
    const rows = await detectFormRows(
      fakePage([
        hline(100, 50, 500),
        hline(120, 50, 500),
        // Divider band: topY 102..119 → 17pt. Computed via vline(x, top, bottom).
        vline(200, 102, 119),
      ]),
      PAGE_H,
    )
    const xs = rows.map((r) => r.xStart).sort((a, b) => a - b)
    expect(xs).toContain(50)
    expect(xs).toContain(200)
  })

  it('does NOT split when divider overlap is exactly 80% (boundary excluded)', async () => {
    // Same row band, divider 16pt — exactly 80%, the condition is `> 0.8`.
    const rows = await detectFormRows(
      fakePage([
        hline(100, 50, 500),
        hline(120, 50, 500),
        vline(200, 102, 118),  // 16pt — boundary, no split
      ]),
      PAGE_H,
    )
    const xs = rows.map((r) => r.xStart)
    // Only one cell, spanning 50..500
    expect(xs).toEqual([50])
    expect(rows[0].xEnd).toBe(500)
  })

  it('produces every cell when several dividers slice the same row', async () => {
    const rows = await detectFormRows(
      fakePage([
        hline(100, 50, 500),
        hline(120, 50, 500),
        vline(150, 100, 120),
        vline(250, 100, 120),
        vline(380, 100, 120),
      ]),
      PAGE_H,
    )
    expect(rows).toHaveLength(4)
    const cuts = rows.map((r) => [r.xStart, r.xEnd]).sort((a, b) => a[0] - b[0])
    expect(cuts).toEqual([
      [50, 150], [150, 250], [250, 380], [380, 500],
    ])
  })

  it('drops slivers narrower than the FINAL_MIN_W (12 pt)', async () => {
    const rows = await detectFormRows(
      fakePage([
        hline(100, 50, 500),
        hline(120, 50, 500),
        // Two dividers very close together → middle slice ~5pt wide → dropped.
        vline(200, 100, 120),
        vline(205, 100, 120),
      ]),
      PAGE_H,
    )
    // Three potential slices (50..200, 200..205, 205..500) but 200..205 is only
    // 5pt and gets filtered. Expect 2 cells.
    expect(rows).toHaveLength(2)
    const widths = rows.map((r) => r.xEnd - r.xStart).sort((a, b) => a - b)
    expect(widths.every((w) => w >= 12)).toBe(true)
  })
})

describe('detectFormRows — section gaps via height filter', () => {
  it('drops the inter-cluster pair when its gap exceeds FINAL_MAX_H (40 pt)', async () => {
    // Cluster A at topY 100, 120 (gap 20) and cluster B at topY 200, 220 (gap 20).
    // The inferred row from A→B has height 80 (120 → 200), exceeding 40 → dropped.
    const rows = await detectFormRows(
      fakePage([
        hline(100, 50, 500),
        hline(120, 50, 500),
        hline(200, 50, 500),
        hline(220, 50, 500),
      ]),
      PAGE_H,
    )
    // Three rows possible (100→120, 120→200, 200→220) — only the first and
    // third survive the 40-pt filter.
    expect(rows).toHaveLength(2)
    rows.forEach((r) => expect(r.height).toBe(20))
  })

  it('treats two clusters with x-spans that don’t match as separate groups', async () => {
    // Group A at xs 50→500, group B at xs 60→510. Difference > 6 → no merge.
    // Each group has 2 lines = 1 row each. 2 rows total.
    const rows = await detectFormRows(
      fakePage([
        hline(100, 50, 500),
        hline(120, 50, 500),
        hline(200, 60, 510),
        hline(220, 60, 510),
      ]),
      PAGE_H,
    )
    expect(rows).toHaveLength(2)
    const aRow = rows.find((r) => r.xStart === 50)
    const bRow = rows.find((r) => r.xStart === 60)
    expect(aRow).toBeDefined()
    expect(bRow).toBeDefined()
  })
})

describe('detectFormRows — robustness', () => {
  it('ignores paths with missing or truncated bbox arrays', async () => {
    const opList = {
      fnArray: [91, 91, 91, 91],
      argsArray: [
        [null, null, undefined],                      // missing bbox
        [null, null, new Float32Array([10, 20])],     // too short
        [null, null, new Float32Array([10, 20, 30])], // still too short
        [null, null, new Float32Array([50, PAGE_H - 120, 200, PAGE_H - 100])], // valid rect
      ],
    }
    const page = { getOperatorList: async () => opList } as unknown as PDFPageProxy
    const rows = await detectFormRows(page, PAGE_H)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ topY: 100, height: 20, xStart: 50, xEnd: 200 })
  })

  it('treats the same rect drawn twice (stroke + fill) as one cell', async () => {
    const rows = await detectFormRows(
      fakePage([
        rect(100, 14, 50, 200),
        rect(100, 14, 50, 200),  // identical duplicate
        rect(100.4, 14.3, 50.2, 199.6),  // near-duplicate within 1pt
      ]),
      PAGE_H,
    )
    expect(rows).toHaveLength(1)
  })

  it('returns an empty array for an empty page', async () => {
    const rows = await detectFormRows(fakePage([]), PAGE_H)
    expect(rows).toEqual([])
  })

  it('survives a page with only un-classifiable primitives', async () => {
    const rows = await detectFormRows(
      fakePage([
        // Too small in every direction
        [10, 10, 12, 12],
        // Too tall to be a rule, too narrow to be a column
        [100, 100, 102, 700],
        // Too short to cluster
        [10, 200, 25, 200],
      ]),
      PAGE_H,
    )
    expect(rows).toEqual([])
  })
})

describe('detectFormRows — mixed-source dedupe', () => {
  it('drops a line-derived row when a rect already covers the same area', async () => {
    const rows = await detectFormRows(
      fakePage([
        // The rect.
        rect(100, 20, 50, 300),
        // Two rules at the rect's top and bottom edges → would otherwise be a duplicate row.
        hline(100, 50, 300),
        hline(120, 50, 300),
      ]),
      PAGE_H,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ topY: 100, height: 20, xStart: 50, xEnd: 300 })
  })

  it('keeps both when the line pair sits clearly outside the rect', async () => {
    const rows = await detectFormRows(
      fakePage([
        rect(100, 20, 50, 300),  // rect at topY 100
        hline(200, 50, 300),     // line pair at topY 200..220 — separate field
        hline(220, 50, 300),
      ]),
      PAGE_H,
    )
    expect(rows).toHaveLength(2)
    const tops = rows.map((r) => r.topY).sort((a, b) => a - b)
    expect(tops).toEqual([100, 200])
  })
})

describe('detectFormRows — coordinate-system handling', () => {
  it('places a rect that touches the top edge of the page correctly', async () => {
    // Rect occupying topY 0..20 (y in PDF native: 780..800, the very top).
    const rows = await detectFormRows(
      fakePage([rect(0, 20, 50, 300)]),
      PAGE_H,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ topY: 0, height: 20 })
  })

  it('places a rect that touches the bottom edge of the page correctly', async () => {
    // PAGE_H = 800. Rect at topY 780..800 (y in PDF native: 0..20).
    const rows = await detectFormRows(
      fakePage([rect(780, 20, 50, 300)]),
      PAGE_H,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ topY: 780, height: 20 })
  })
})

describe('findRowAt — advanced selection', () => {
  const NESTED: FormRow[] = [
    // Pre-sorted smallest-first, mimicking the detector's invariant.
    { topY: 100, height: 12, xStart: 200, xEnd: 280 },  // 80 × 12 = 960
    { topY: 100, height: 18, xStart: 100, xEnd: 220 },  // 120 × 18 = 2160
    { topY: 100, height: 24, xStart: 50,  xEnd: 500 },  // 450 × 24 = 10800
  ]

  it('prefers the smallest enclosing cell (sort-order assumption)', () => {
    expect(findRowAt(NESTED, 240, 108)).toBe(NESTED[0])  // inside small + large
  })

  it('falls back to the next-larger when the smallest does not contain the click', () => {
    // x=150 is inside row[1] (100..220) and row[2] (50..500), not row[0].
    expect(findRowAt(NESTED, 150, 108)).toBe(NESTED[1])
  })

  it('returns null when click is far outside any row x-range', () => {
    expect(findRowAt(NESTED, 700, 110)).toBeNull()
  })

  it('proximity fallback respects x-range, not just y-distance', () => {
    // Click at x=700, y=110: closest row by y is row[0] (center 106), but x is
    // outside its range. Expect null even though y-distance is small.
    expect(findRowAt(NESTED, 700, 110)).toBeNull()
  })

  it('handles many rows without falling apart', () => {
    // Generate 1000 non-overlapping cells stacked vertically.
    const rows: FormRow[] = []
    for (let i = 0; i < 1000; i++) {
      rows.push({ topY: i * 14, height: 12, xStart: 50, xEnd: 200 })
    }
    const t0 = performance.now()
    for (let i = 0; i < 200; i++) {
      const target = Math.floor(Math.random() * 1000)
      const hit = findRowAt(rows, 100, target * 14 + 6)
      expect(hit?.topY).toBe(target * 14)
    }
    const elapsed = performance.now() - t0
    // Linear scan; should comfortably finish well under a second.
    expect(elapsed).toBeLessThan(1000)
  })
})

describe('detectFormRows — underline-style fallback', () => {
  // Page has many isolated horizontal rules (≥4 H-lines) and no rect-derived
  // cells: classic "Name: ____________" form. The detector should synthesise
  // a cap row above each isolated rule.
  it('emits 18pt cap rows above isolated long rules when there are no rect cells', async () => {
    const rows = await detectFormRows(
      fakePage([
        // Each line is at a unique x-span so groups are length-1.
        hline(200, 50,  300),
        hline(260, 60,  320),
        hline(320, 70,  340),
        hline(380, 80,  360),
      ]),
      PAGE_H,
    )
    expect(rows).toHaveLength(4)
    rows.forEach((r) => expect(r.height).toBe(18))
    const tops = rows.map((r) => r.topY).sort((a, b) => a - b)
    // Cap rows sit 18pt ABOVE each rule.
    expect(tops).toEqual([182, 242, 302, 362])
  })

  it('does NOT emit cap rows for a stray short rule on a rect-rich form', async () => {
    // Plenty of rects + one *short* isolated rule (under the 80pt
    // signature-line threshold). The stray short rule stays dropped — it's
    // probably a column tick or section-marker, not a writing line.
    const paths: Array<[number, number, number, number]> = []
    for (let i = 0; i < 6; i++) {
      paths.push(rect(100 + i * 30, 14, 50, 200))
    }
    paths.push(hline(500, 50, 100))  // 50pt — too short for the sig-line rule
    const rows = await detectFormRows(fakePage(paths), PAGE_H)
    expect(rows).toHaveLength(6)
    rows.forEach((r) => expect(r.height).toBe(14))
  })

  it('caps an isolated LONG rule on a rect-rich form (signature line at the bottom)', async () => {
    // Modern boxed form + a clear signature line below the boxes. The
    // isolated long rule (≥80pt, no rect overlap) earns a cap row so
    // snap targets the writing area above it.
    const paths: Array<[number, number, number, number]> = []
    for (let i = 0; i < 6; i++) {
      paths.push(rect(100 + i * 30, 14, 50, 200))
    }
    paths.push(hline(500, 50, 400))  // 350pt — clearly a signature line
    const rows = await detectFormRows(fakePage(paths), PAGE_H)
    expect(rows).toHaveLength(7)  // 6 rects + 1 cap row from the sig line
    const capRow = rows.find((r) => r.height === 18)
    expect(capRow).toBeDefined()
  })

  it('caps long isolated rules even when fewer than 4 are present (sig-line rule)', async () => {
    // Three long isolated rules, no rect cells. Each ≥80pt → each earns a
    // cap row regardless of how many H-lines exist on the page.
    const rows = await detectFormRows(
      fakePage([
        hline(200, 50, 300),
        hline(260, 60, 320),
        hline(320, 70, 340),
      ]),
      PAGE_H,
    )
    expect(rows).toHaveLength(3)
    rows.forEach((r) => expect(r.height).toBe(18))
  })

  it('skips cap rows that would extend above the page top', async () => {
    // 4 singletons at very small topY values (near the top of the page); the
    // 18pt cap room above would push topY negative for some.
    const rows = await detectFormRows(
      fakePage([
        hline(2,   50, 300),  // cap would be at topY -16 → dropped
        hline(20,  50, 300),  // cap at topY 2 → kept
        hline(60,  50, 300),
        hline(100, 50, 300),
      ]),
      PAGE_H,
    )
    expect(rows).toHaveLength(3)
    rows.forEach((r) => expect(r.topY).toBeGreaterThanOrEqual(0))
  })
})

describe('detectFormRows — invariants', () => {
  it('every emitted cell satisfies the size filters', async () => {
    // Random but bounded inputs; verify postconditions hold.
    const paths: Array<[number, number, number, number]> = []
    for (let i = 0; i < 60; i++) {
      const top = 50 + Math.random() * 600
      const w = 5 + Math.random() * 600
      const h = 5 + Math.random() * 80
      const x = Math.random() * 400
      paths.push(rect(top, h, x, x + w))
    }
    const rows = await detectFormRows(fakePage(paths), PAGE_H)
    rows.forEach((r) => {
      expect(r.height).toBeGreaterThanOrEqual(8)
      expect(r.height).toBeLessThanOrEqual(40)
      expect(r.xEnd - r.xStart).toBeGreaterThanOrEqual(12)
      expect(r.xStart).toBeLessThan(r.xEnd)
      expect(r.topY).toBeGreaterThanOrEqual(0)
    })
  })

  it('does not emit a cell with negative or zero dimensions', async () => {
    const rows = await detectFormRows(
      fakePage([
        // Pathologically inverted bbox — pdfjs would normalize, but defensive coverage.
        [200, 700, 50,  720],   // xmin > xmax
        [50,  720, 200, 700],   // ymin > ymax (flipped)
        rect(100, 14, 50, 200), // sanity rect
      ]),
      PAGE_H,
    )
    rows.forEach((r) => {
      expect(r.xEnd - r.xStart).toBeGreaterThan(0)
      expect(r.height).toBeGreaterThan(0)
    })
  })
})
