import { describe, expect, it } from 'vitest'
import { detectAlignment, groupParagraphs, groupTextRuns, type TextRun } from './textRuns'

// Builder for terse fixture creation. Keep `fontName` / `fontSize` /
// styles default to common values so callers only specify the geometry
// that actually drives each test.
function run(p: Partial<TextRun> & { str: string; x: number; y: number; w: number; h?: number }): TextRun {
  return {
    fontName: 'g_d0_f0',
    family: 'helvetica',
    fontSize: 12,
    bold: false,
    italic: false,
    h: 12,
    ...p,
  } as TextRun
}

describe('groupTextRuns — same-line merge', () => {
  it('merges adjacent same-font runs separated by a small gap', () => {
    const out = groupTextRuns([
      run({ str: 'Hello', x: 50, y: 100, w: 30 }),
      run({ str: 'world', x: 84, y: 100, w: 30 }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].str).toBe('Hello world')   // gap > 0.15 × fontSize → space
    expect(out[0].x).toBe(50)
    expect(out[0].w).toBe(64)                 // 84 + 30 - 50
  })

  it('does not insert a space when runs are tightly kerned', () => {
    const out = groupTextRuns([
      run({ str: 'Müller', x: 50, y: 100, w: 30 }),
      run({ str: '-Straße', x: 80.5, y: 100, w: 35 }),  // gap = 0.5pt
    ])
    expect(out).toHaveLength(1)
    expect(out[0].str).toBe('Müller-Straße')   // no space inserted
  })

  it('does not merge runs across different lines', () => {
    const out = groupTextRuns([
      run({ str: 'first', x: 50, y: 100, w: 30 }),
      run({ str: 'second', x: 50, y: 130, w: 30 }),     // different line
    ])
    expect(out).toHaveLength(2)
  })

  it('does not merge runs in different fonts', () => {
    const out = groupTextRuns([
      run({ str: 'Bold', x: 50, y: 100, w: 30, fontName: 'g_d0_f1', bold: true }),
      run({ str: 'normal', x: 84, y: 100, w: 40, fontName: 'g_d0_f0' }),
    ])
    expect(out).toHaveLength(2)
  })

  it('does not merge runs where one is bold and the other is not', () => {
    const out = groupTextRuns([
      run({ str: 'Bold', x: 50, y: 100, w: 30, bold: true }),
      run({ str: 'normal', x: 84, y: 100, w: 40, bold: false }),
    ])
    expect(out).toHaveLength(2)
  })

  it('does not merge runs separated by more than half the font size', () => {
    const out = groupTextRuns([
      run({ str: 'Label', x: 50, y: 100, w: 30 }),
      run({ str: '$1,234', x: 200, y: 100, w: 30 }),    // huge gap (column)
    ])
    expect(out).toHaveLength(2)
  })
})

describe('groupParagraphs — multi-line cluster merge', () => {
  it('merges three left-aligned same-style lines stacked tightly', () => {
    const out = groupParagraphs([
      run({ str: 'Line one', x: 50, y: 100, w: 80 }),
      run({ str: 'Line two', x: 50, y: 114, w: 80 }),
      run({ str: 'Line three', x: 50, y: 128, w: 100 }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].str).toBe('Line one\nLine two\nLine three')
    expect(out[0]._multiLineHtml).toBe('Line one<br>Line two<br>Line three')
    expect(out[0].y).toBe(100)
    expect(out[0].h).toBe(40)                 // 128 + 12 - 100
    expect(out[0].w).toBe(100)                // widest of the three
  })

  it('does not merge lines with different X-starts (different columns)', () => {
    const out = groupParagraphs([
      run({ str: 'left',  x: 50,  y: 100, w: 30 }),
      run({ str: 'right', x: 200, y: 114, w: 30 }),  // x-start differs
    ])
    expect(out).toHaveLength(2)
  })

  it('does not merge lines with different bold/italic', () => {
    const out = groupParagraphs([
      run({ str: 'Heading',  x: 50, y: 100, w: 50, bold: true }),
      run({ str: 'body text', x: 50, y: 114, w: 60, bold: false }),
    ])
    expect(out).toHaveLength(2)
  })

  it('does not merge lines that are too far apart vertically', () => {
    const out = groupParagraphs([
      run({ str: 'first',  x: 50, y: 100, w: 30 }),
      run({ str: 'second', x: 50, y: 200, w: 30 }),  // huge gap
    ])
    expect(out).toHaveLength(2)
  })

  it('escapes HTML special characters in line content', () => {
    const out = groupParagraphs([
      run({ str: '<b>bold</b>',     x: 50, y: 100, w: 50 }),
      run({ str: 'A & B < C > D',   x: 50, y: 114, w: 60 }),
    ])
    expect(out).toHaveLength(1)
    // _multiLineHtml escapes both lines so the contenteditable doesn't
    // render injected markup as HTML.
    expect(out[0]._multiLineHtml).toBe(
      '&lt;b&gt;bold&lt;/b&gt;<br>A &amp; B &lt; C &gt; D',
    )
  })

  it('respects a 7-line height ceiling so unbounded merging cannot happen', () => {
    const lines: TextRun[] = []
    for (let i = 0; i < 12; i++) {
      lines.push(run({ str: 'L' + i, x: 50, y: 100 + i * 14, w: 30 }))
    }
    const out = groupParagraphs(lines)
    // We expect more than one cluster — the merged group can't grow past
    // 7 × fontSize tall, so the 12 lines split into 2+ groups.
    expect(out.length).toBeGreaterThan(1)
  })
})

describe('detectAlignment — column-based alignment inference', () => {
  it('flags a right-aligned column when peers share a right edge', () => {
    const peers = [
      run({ str: '1.00',     x: 196, y: 100, w: 24 }),  // right=220
      run({ str: '12.50',    x: 190, y: 114, w: 30 }),  // right=220
      run({ str: '1,234.99', x: 178, y: 128, w: 42 }),  // right=220
    ]
    const out = detectAlignment(peers)
    expect(out.every((r) => r.align === 'right')).toBe(true)
  })

  it('flags a centered column when peers share an X-center', () => {
    const peers = [
      run({ str: 'a',     x: 197, y: 100, w: 6 }),     // center=200
      run({ str: 'long',  x: 184, y: 114, w: 32 }),    // center=200
      run({ str: 'mid',   x: 191, y: 128, w: 18 }),    // center=200
    ]
    const out = detectAlignment(peers)
    expect(out.every((r) => r.align === 'center')).toBe(true)
  })

  it('leaves a left-aligned column without an explicit align flag', () => {
    const peers = [
      run({ str: 'one',   x: 50, y: 100, w: 18 }),
      run({ str: 'two',   x: 50, y: 114, w: 18 }),
      run({ str: 'three', x: 50, y: 128, w: 30 }),
    ]
    const out = detectAlignment(peers)
    expect(out.every((r) => r.align === undefined)).toBe(true)
  })

  it('does not infer alignment when there are too few peers', () => {
    const out = detectAlignment([
      run({ str: 'lone', x: 196, y: 100, w: 24 }),
      run({ str: 'far',  x: 196, y: 500, w: 24 }),  // outside the 6-line peer window
    ])
    expect(out[0].align).toBeUndefined()
  })

  it('does not infer alignment across different fonts', () => {
    const peers = [
      run({ str: '1', x: 196, y: 100, w: 24, fontName: 'A' }),
      run({ str: '2', x: 190, y: 114, w: 30, fontName: 'B' }),
      run({ str: '3', x: 178, y: 128, w: 42, fontName: 'B' }),
    ]
    const out = detectAlignment(peers)
    // The 'A' font run has no peers; the 'B' runs have only 1 peer each
    // (themselves don't count) → below the threshold of 2.
    expect(out.every((r) => r.align === undefined)).toBe(true)
  })
})
