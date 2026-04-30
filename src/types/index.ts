export type Mode = 'idle' | 'text' | 'signature' | 'select' | 'draw' | 'image' | 'edit'

export type FontFamily = 'helvetica' | 'times' | 'courier'

// Coordinates and sizes are stored in PDF page units (points), not CSS pixels.
// This way annotations stay pinned when the viewer is resized.
export interface BaseAnnotation {
  id: string
  pageIdx: number
  x: number   // PDF points, top-left origin
  y: number
  w: number
  h: number
}

export interface TextAnnotation extends BaseAnnotation {
  type: 'text'
  data: string        // HTML — supports <b>/<i>/<u> and <br> for line breaks
  fontSize: number    // PDF points
  family: FontFamily
  color: string       // hex
  // If set, this is a date stamp. The displayed `data` is derived from
  // `dateMs` formatted with `dateLocale` (undefined = system locale).
  dateMs?: number
  dateLocale?: string
}

export interface SignatureAnnotation extends BaseAnnotation {
  type: 'signature'
  data: string  // PNG data URL
}

export interface DrawingAnnotation extends BaseAnnotation {
  type: 'drawing'
  // Stroke points in local coords relative to the bbox (0,0 = top-left, Y down).
  points: Array<[number, number]>
  color: string       // hex
  opacity: number     // 0–1
  strokeWidth: number // PDF points
}

// Inserted images — explicitly NOT persisted to IndexedDB. The auto-save
// layer filters out annotations of this type so they live for the current
// session only. The user picks PNG/JPG/GIF/WebP up to a small size cap.
export interface ImageAnnotation extends BaseAnnotation {
  type: 'image'
  data: string  // data URL (data:image/png;base64,…)
  // The original mime helps the PDF builder pick `embedPng` vs `embedJpg` and
  // know whether to re-encode (gif / webp don't have a direct pdf-lib path).
  mime: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
}

// "Edit existing text" annotation — replaces a text run already drawn in the
// source PDF. Visually it covers the original glyphs with a white rectangle
// and renders the user's replacement on top in a matched font; in the export
// pipeline, buildPdf does the same (drawRectangle white + drawText new) so
// the edit travels into the downloaded file.
//
// Known limitations of this approach (Phase 1):
//   - Single-line only. Multi-line paragraph reflow is out of scope.
//   - Cover rectangle is hardcoded white; non-white backgrounds will leak
//     through. Most form-style PDFs are white, so this lands well most of
//     the time and degrades gracefully when it doesn't.
//   - Original font is approximated from the bundled fallbacks (Helvetica /
//     Times / Courier) keyed by pdf.js's reported family class.
export interface TextEditAnnotation extends BaseAnnotation {
  type: 'textEdit'
  data: string         // user's replacement text (plain — no rich runs in v1)
  fontSize: number
  family: FontFamily
  color: string        // hex
  // Cover rectangle that hides the original glyphs. Sampled from the canvas
  // at click time when possible (so colored / non-white backgrounds blend
  // in), defaults to white when sampling fails.
  cover?: string       // hex, default '#ffffff'
  // Detected from neighbour runs in the same column. Drives both the
  // contenteditable's text-align and where buildPdf places the new glyphs
  // within the cover rect.
  align?: 'left' | 'center' | 'right'
  // Bounding box of the ORIGINAL glyphs being masked. Stored separately
  // from x/y/w/h so the user can drag the editor to a new position
  // without exposing the source text — the cover stays put. Older edits
  // without these fields fall back to the editor bbox for the cover too.
  origX?: number
  origY?: number
  origW?: number
  origH?: number
  // Diagnostic only — the pdf.js fontName the original run was drawn in.
  // Carried so future versions can attempt a better font match without
  // inferring it again from the PDF.
  originalFontName?: string
}

export type Annotation = TextAnnotation | SignatureAnnotation | DrawingAnnotation | ImageAnnotation | TextEditAnnotation

export interface PageInfo {
  pageIdx: number
  cssWidth: number
  cssHeight: number
  pdfWidth: number
  pdfHeight: number
}

export interface SavedSignature {
  id: string
  dataUrl: string
  createdAt: number
}

export interface ProfileField {
  id: string
  label: string
  value: string
}
