// Text-run grouping + alignment heuristics for the edit-text mode. Pulled
// out of PdfPage so they're easy to unit-test without booting pdf.js. The
// runtime feeds `TextRun[]` from `getTextContent()` through:
//   1. groupTextRuns       — merge per-line same-font runs (per-word splits)
//   2. groupParagraphs     — merge same-X-start, same-style paragraph lines
//   3. detectAlignment     — flag runs whose neighbours form a right- or
//                            center-aligned column
import type { FontFamily } from '@/types'

export interface TextRun {
  str: string
  // PDF points, top-left origin
  x: number; y: number; w: number; h: number
  fontName: string
  family: FontFamily
  fontSize: number
  bold: boolean
  italic: boolean
  align?: 'left' | 'center' | 'right'
  // When groupParagraphs has merged several lines into one editing unit,
  // this carries the pre-formatted HTML (with <br> separators) so the click
  // handler can reuse it as-is rather than re-escaping the joined `str`.
  _multiLineHtml?: string
}

const escapeHtml = (s: string) => s
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')

// Merge runs that appear next to each other on the same baseline and share
// a font. pdf.js commonly splits visually-contiguous text into many small
// items (per-word, per-glyph, around kerning); editing them as separate
// targets feels granular and confusing.
export function groupTextRuns(runs: TextRun[]): TextRun[] {
  if (runs.length < 2) return runs
  const sorted = [...runs].sort((a, b) => {
    const dy = Math.round(a.y * 2) - Math.round(b.y * 2)
    return dy !== 0 ? dy : a.x - b.x
  })
  const out: TextRun[] = []
  for (const r of sorted) {
    const prev = out[out.length - 1]
    const sameLine = prev && Math.abs(prev.y - r.y) < 1.5
    const sameFont = prev && prev.fontName === r.fontName
    const sameStyle = prev && prev.bold === r.bold && prev.italic === r.italic
    const closeEnough = prev && (r.x - (prev.x + prev.w)) < prev.fontSize * 0.55
    if (prev && sameLine && sameFont && sameStyle && closeEnough && r.x >= prev.x) {
      const gap = Math.max(0, r.x - (prev.x + prev.w))
      const joined = prev.str + (gap > prev.fontSize * 0.15 ? ' ' : '') + r.str
      out[out.length - 1] = {
        ...prev,
        str: joined,
        w: (r.x + r.w) - prev.x,
        h: Math.max(prev.h, r.h),
      }
    } else {
      out.push(r)
    }
  }
  return out
}

// Group runs that wrap onto multiple lines into one editing unit.
// Conditions: same fontName + same bold/italic, X-start aligned (±2.5pt),
// vertical gap < 0.6 × fontSize, merged height < 7 × fontSize. Encodes the
// merged content as HTML with `<br>` separators on the run's
// `_multiLineHtml` field — keeps round-tripping through parseHtmlToLines
// straightforward.
export function groupParagraphs(runs: TextRun[]): TextRun[] {
  if (runs.length < 2) return runs
  const sorted = [...runs].sort((a, b) => a.y - b.y || a.x - b.x)
  const out: TextRun[] = []
  for (const r of sorted) {
    const prev = out[out.length - 1]
    if (!prev) { out.push(r); continue }
    const sameFont = prev.fontName === r.fontName
    const sameStyle = prev.bold === r.bold && prev.italic === r.italic
    const sameLeft = Math.abs(prev.x - r.x) < 2.5
    const prevBottom = prev.y + prev.h
    const gap = r.y - prevBottom
    const closeEnough = gap >= -1 && gap < r.fontSize * 0.6
    const mergedBottom = Math.max(prev.y + prev.h, r.y + r.h)
    const mergedTop = Math.min(prev.y, r.y)
    const mergedHeight = mergedBottom - mergedTop
    const wouldStayShort = mergedHeight < prev.fontSize * 7
    if (sameFont && sameStyle && sameLeft && closeEnough && wouldStayShort) {
      out[out.length - 1] = {
        ...prev,
        str: prev.str + '\n' + r.str,
        y: mergedTop,
        h: mergedHeight,
        w: Math.max(prev.w, r.w, (r.x + r.w) - prev.x),
        _multiLineHtml: (prev._multiLineHtml ?? escapeHtml(prev.str)) + '<br>' + escapeHtml(r.str),
      }
    } else {
      out.push(r)
    }
  }
  return out
}

// Detect alignment by looking at neighbouring same-style runs across rows.
// If multiple peers share the same right edge (within 2pt) but different
// left edges, the column is right-aligned. Same logic with centers ⇒
// center-aligned. Otherwise default to left.
export function detectAlignment(runs: TextRun[]): TextRun[] {
  if (runs.length < 2) return runs
  // Bin by (fontName, bold, italic) so peer search runs against same-style
  // runs only — the previous full-array scan was O(n²) across the whole
  // page; binning makes it O(sum n_i² over bins) which is vastly smaller
  // when the document mixes fonts (e.g. headings + body in different faces).
  const bins = new Map<string, TextRun[]>()
  for (const r of runs) {
    const key = `${r.fontName}|${r.bold ? 1 : 0}|${r.italic ? 1 : 0}`
    let bin = bins.get(key)
    if (!bin) { bin = []; bins.set(key, bin) }
    bin.push(r)
  }
  return runs.map((r) => {
    const key = `${r.fontName}|${r.bold ? 1 : 0}|${r.italic ? 1 : 0}`
    const bin = bins.get(key)!
    if (bin.length < 3) return r // need at least 3 same-style runs (self + 2 peers)
    const peers = bin.filter((p) =>
      p !== r &&
      Math.abs(p.y - r.y) < r.fontSize * 6 &&
      p.x + p.w > r.x && p.x < r.x + r.w,
    )
    if (peers.length < 2) return r
    const rightMatches = peers.filter((p) => Math.abs((p.x + p.w) - (r.x + r.w)) < 2).length
    const leftMatches  = peers.filter((p) => Math.abs(p.x - r.x) < 2).length
    const centerMatches = peers.filter((p) =>
      Math.abs((p.x + p.w / 2) - (r.x + r.w / 2)) < 2,
    ).length
    if (rightMatches >= 2 && rightMatches > leftMatches) return { ...r, align: 'right' as const }
    if (centerMatches >= 2 && centerMatches > leftMatches && centerMatches > rightMatches) return { ...r, align: 'center' as const }
    return r
  })
}
