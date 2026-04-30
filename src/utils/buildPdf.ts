import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import type { Annotation, PageInfo } from '@/types'
import { FONT_FAMILIES, normalizeFamily, pdfFontIdFor } from './fonts'
import { pointsToSmoothPath } from './drawing'
import { assertNever } from './assertNever'

interface BuildPdfOptions {
  pdfBytes: Uint8Array
  annotations: Annotation[]
  pages: PageInfo[]
  formFieldEdits: Map<string, string | boolean>
  // Raster fallback. When provided, we don't load `pdfBytes` through
  // pdf-lib at all — we build a fresh document where each page is the
  // supplied PNG/JPG image at the page's PDF dimensions, then draw
  // annotations on top. The caller switches to this path when the strict
  // pdf-lib load throws on a source PDF whose object structure pdf-lib
  // can't reconcile (real-world government forms with linearised xref
  // streams, etc.). Form-widget edits are dropped in this mode — the
  // image already has the rendered widget state baked in.
  pageImages?: string[]
}

export interface Run {
  text: string
  bold: boolean
  italic: boolean
  underline: boolean
}

export async function buildPdf(opts: BuildPdfOptions): Promise<Uint8Array> {
  const { pdfBytes, annotations, pages, formFieldEdits, pageImages } = opts
  let pdfDoc: Awaited<ReturnType<typeof PDFDocument.load>>
  if (pageImages && pageImages.length === pages.length) {
    // Raster fallback path. Build a fresh document — one page per supplied
    // image at the original PDF dimensions. Annotations are drawn on top
    // by the same loop below.
    //
    // The data URL's MIME prefix tells us whether to embed as JPEG (used
    // by the "make smaller" download path — JPEG with q<1 cuts file size
    // by 5-10× vs PNG on scanned content) or PNG (lossless, used by the
    // raster fallback for un-parseable PDFs).
    pdfDoc = await PDFDocument.create()
    for (let i = 0; i < pages.length; i++) {
      const info = pages[i]
      const dataUrl = pageImages[i]
      const isJpeg = dataUrl.startsWith('data:image/jpeg') || dataUrl.startsWith('data:image/jpg')
      const img = isJpeg
        ? await pdfDoc.embedJpg(dataUrlToBytes(dataUrl))
        : await pdfDoc.embedPng(dataUrlToBytes(dataUrl))
      const page = pdfDoc.addPage([info.pdfWidth, info.pdfHeight])
      page.drawImage(img, { x: 0, y: 0, width: info.pdfWidth, height: info.pdfHeight })
    }
  } else {
    // Many real-world forms are flagged as encrypted (often by their
    // authoring tool, not because they're password-protected) — pdf-lib
    // refuses to load them by default. Since we already loaded the bytes
    // for rendering via pdf.js without complaint, try again ignoring the
    // flag if the strict load fails.
    try {
      pdfDoc = await PDFDocument.load(pdfBytes)
    } catch (err) {
      if (err instanceof Error && /encrypted/i.test(err.message)) {
        pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true })
      } else {
        throw err
      }
    }
  }

  if (!pageImages && formFieldEdits.size > 0) {
    try {
      const form = pdfDoc.getForm()
      for (const [name, value] of formFieldEdits) {
        try {
          const field = form.getField(name)
          const ctor = field.constructor.name
          if (ctor === 'PDFTextField') {
            (field as unknown as { setText: (s: string) => void }).setText(String(value))
          } else if (ctor === 'PDFCheckBox') {
            const cb = field as unknown as { check: () => void; uncheck: () => void }
            if (value) cb.check()
            else cb.uncheck()
          }
        } catch { /* unknown field */ }
      }
      try { form.flatten() } catch { /* leave editable on flatten failure */ }
    } catch { /* no form on this PDF */ }
  }

  type EmbeddedFont = Awaited<ReturnType<typeof pdfDoc.embedFont>>
  const embeddedFonts = new Map<string, EmbeddedFont>()
  async function getFont(stdId: keyof typeof StandardFonts): Promise<EmbeddedFont> {
    let cached = embeddedFonts.get(stdId)
    if (!cached) {
      cached = await pdfDoc.embedFont(StandardFonts[stdId])
      embeddedFonts.set(stdId, cached)
    }
    return cached
  }

  // Unicode font for text outside the WinAnsi character set (Cyrillic,
  // Greek, Vietnamese, Latin Extended). Covers the majority of European
  // languages — CJK, Arabic, Devanagari, Bengali still need their own
  // Noto subset and are not loaded here. Fetched lazily and only embedded
  // (subset to glyphs actually used) when the document needs it.
  let unicodeFont: EmbeddedFont | null = null
  let unicodeFontFailed = false
  async function getUnicodeFont(): Promise<EmbeddedFont | null> {
    if (unicodeFont) return unicodeFont
    if (unicodeFontFailed) return null
    try {
      const res = await fetch('/fonts/NotoSans-Regular.ttf')
      if (!res.ok) { unicodeFontFailed = true; return null }
      const bytes = new Uint8Array(await res.arrayBuffer())
      const fontkit = (await import('@pdf-lib/fontkit')).default
      pdfDoc.registerFontkit(fontkit)
      unicodeFont = await pdfDoc.embedFont(bytes, { subset: true })
      return unicodeFont
    } catch (err) {
      console.warn('Failed to load Unicode font; non-WinAnsi text will fall back', err)
      unicodeFontFailed = true
      return null
    }
  }

  // Pick the right font for a given run: standard fonts (Helvetica/Times/
  // Courier with bold/italic variants) when the text is WinAnsi-compatible,
  // Noto Sans when it isn't and Noto is available. Falls back to the
  // standard font (with the `sanitize` ?-mangle) only if Noto can't load.
  async function pickFontFor(text: string, stdId: keyof typeof StandardFonts): Promise<{
    font: EmbeddedFont
    needsSanitize: boolean
  }> {
    if (isWinAnsiOnly(text)) {
      return { font: await getFont(stdId), needsSanitize: true }
    }
    const noto = await getUnicodeFont()
    if (noto) return { font: noto, needsSanitize: false }
    return { font: await getFont(stdId), needsSanitize: true }
  }

  const byPage = new Map<number, Annotation[]>()
  for (const a of annotations) {
    if (!byPage.has(a.pageIdx)) byPage.set(a.pageIdx, [])
    byPage.get(a.pageIdx)!.push(a)
  }

  const pdfPages = pdfDoc.getPages()
  const sigCache = new Map<string, Awaited<ReturnType<typeof pdfDoc.embedPng>>>()

  for (const [pageIdx, list] of byPage) {
    const pdfPage = pdfPages[pageIdx]
    const info = pages[pageIdx]
    if (!pdfPage || !info) continue

    for (const a of list) {
      try {
      if (a.type === 'text') {
        if (!a.data) continue
        const family = normalizeFamily(a.family)
        const lines = parseHtmlToLines(a.data)
        const fontSize = a.fontSize
        const lineHeight = fontSize * 1.2
        // PDF top-Y of the box (PDF origin is bottom-left, so flip)
        const topPdfY = info.pdfHeight - a.y
        const padX = 4
        const color = parseHexColor(a.color)
        for (let li = 0; li < lines.length; li++) {
          const line = lines[li]
          if (!line.length) continue
          const baselineY =
            topPdfY - (li + 1) * lineHeight + (lineHeight - fontSize) / 2 + fontSize * 0.15
          let x = a.x + padX
          for (const run of line) {
            if (!run.text) continue
            const stdId = pdfFontIdFor(family, run.bold, run.italic)
            const { font, needsSanitize } = await pickFontFor(run.text, stdId)
            const text = needsSanitize ? sanitize(run.text) : run.text
            if (!text) continue
            pdfPage.drawText(text, {
              x, y: baselineY, size: fontSize, font, color,
            })
            const width = font.widthOfTextAtSize(text, fontSize)
            if (run.underline) {
              const yLine = baselineY - fontSize * 0.12
              pdfPage.drawLine({
                start: { x, y: yLine },
                end: { x: x + width, y: yLine },
                thickness: Math.max(0.4, fontSize * 0.06),
                color,
              })
            }
            x += width
          }
        }
      } else if (a.type === 'signature') {
        let img = sigCache.get(a.data)
        if (!img) {
          img = await pdfDoc.embedPng(dataUrlToBytes(a.data))
          sigCache.set(a.data, img)
        }
        pdfPage.drawImage(img, {
          x: a.x,
          y: info.pdfHeight - (a.y + a.h),
          width: a.w,
          height: a.h,
        })
      } else if (a.type === 'drawing') {
        // Flip Y to match PDF (origin bottom-left), keep points in local coords.
        const flipped: Array<[number, number]> = a.points.map(([px, py]) => [px, a.h - py])
        const d = pointsToSmoothPath(flipped)
        pdfPage.drawSvgPath(d, {
          x: a.x,
          y: info.pdfHeight - (a.y + a.h),
          borderColor: parseHexColor(a.color),
          borderWidth: a.strokeWidth,
          borderOpacity: a.opacity,
          borderLineCap: 1, // round
        })
      } else if (a.type === 'image') {
        // pdf-lib supports PNG and JPG natively; GIF/WebP have to round-trip
        // through a canvas to PNG before embedding.
        let img
        if (a.mime === 'image/jpeg') {
          img = await pdfDoc.embedJpg(dataUrlToBytes(a.data))
        } else if (a.mime === 'image/png') {
          img = await pdfDoc.embedPng(dataUrlToBytes(a.data))
        } else {
          // Re-encode to PNG via the browser's canvas.
          const png = await reencodeToPng(a.data)
          img = await pdfDoc.embedPng(png)
        }
        pdfPage.drawImage(img, {
          x: a.x,
          y: info.pdfHeight - (a.y + a.h),
          width: a.w,
          height: a.h,
        })
      } else if (a.type === 'textEdit') {
        // Cover the original glyphs with a white rectangle, then draw the
        // user's replacement on top in the matched fallback font. Same path
        // as text annotations above, modulo the cover step + alignment.
        if (!a.data) continue
        const family = normalizeFamily(a.family)
        const fontSize = a.fontSize
        const topPdfY = info.pdfHeight - a.y
        // Cover the original glyphs at their FIXED bbox (origX/Y/W/H when
        // set, else the editor bbox). The cover's location does NOT follow
        // the editor's current x/y — that way a user can drag the textEdit
        // somewhere else on the page and the source stays masked.
        const coverX = a.origX ?? a.x
        const coverY = a.origY ?? a.y
        const coverW = a.origW ?? a.w
        const coverH = a.origH ?? a.h
        pdfPage.drawRectangle({
          x: coverX,
          y: info.pdfHeight - (coverY + coverH),
          width: coverW,
          height: coverH,
          color: parseHexColor(a.cover ?? '#ffffff'),
        })
        const lines = parseHtmlToLines(a.data)
        // line-height matches the screen-side editor: tighter than the
        // text-annotation 1.2 to land glyphs visually close to the original.
        const lineHeight = fontSize * 1.0
        const padX = a.align && a.align !== 'left' ? 0 : 4
        const align = a.align ?? 'left'
        const color = parseHexColor(a.color)
        for (let li = 0; li < lines.length; li++) {
          const line = lines[li]
          if (!line.length) continue
          const baselineY =
            topPdfY - (li + 1) * lineHeight + (lineHeight - fontSize) / 2 + fontSize * 0.15
          // Pre-measure the line so we can right-align / center the entire
          // run cluster within the cover rect. Resolve fonts once per run
          // and reuse below.
          const resolved = await Promise.all(line.map(async (run) => {
            if (!run.text) return null
            const stdId = pdfFontIdFor(family, run.bold, run.italic)
            const picked = await pickFontFor(run.text, stdId)
            const text = picked.needsSanitize ? sanitize(run.text) : run.text
            if (!text) return null
            return { ...run, text, font: picked.font }
          }))
          const drawables = resolved.filter((r): r is NonNullable<typeof r> => r !== null)
          const lineWidth = drawables.reduce(
            (sum, r) => sum + r.font.widthOfTextAtSize(r.text, fontSize), 0,
          )
          let x = a.x + padX
          if (align === 'right') x = a.x + a.w - padX - lineWidth
          else if (align === 'center') x = a.x + (a.w - lineWidth) / 2
          for (const r of drawables) {
            pdfPage.drawText(r.text, {
              x, y: baselineY, size: fontSize, font: r.font, color,
            })
            x += r.font.widthOfTextAtSize(r.text, fontSize)
          }
        }
      } else {
        // If a new annotation type is added to the union, this fails the build.
        assertNever(a)
      }
      } catch (err) {
        // One bad annotation should not torpedo the whole download. pdf-lib
        // can throw "Expected instance of PDFDict, but got instance of
        // undefined" on edge-case page resource trees, malformed embedded
        // images, etc. Log + skip; the rest of the document still saves.
        console.warn('Skipping annotation that failed to write:', a.type, err)
      }
    }
  }

  // Reference family info for tree-shaking warning suppression
  void FONT_FAMILIES

  // Some malformed (or aggressively-compressed) source PDFs reject the
  // default `useObjectStreams: true` save with "expected PDFDict, got
  // undefined". The non-streamed save path tolerates the same documents.
  try {
    return await pdfDoc.save()
  } catch (err) {
    if (err instanceof Error && /PDFDict|undefined/i.test(err.message)) {
      return await pdfDoc.save({ useObjectStreams: false })
    }
    throw err
  }
}

// Parse contentEditable HTML into lines of styled text runs. Handles
// <br>, <div>, <p> as line breaks; <b>/<strong>, <i>/<em>, <u> as styles.
// Exported for unit tests.
export function parseHtmlToLines(html: string): Run[][] {
  const lines: Run[][] = []
  let current: Run[] = []

  function pushLine() {
    lines.push(current)
    current = []
  }

  const root = document.createElement('div')
  root.innerHTML = html

  const isBoldStyle = (el: HTMLElement) => {
    const w = el.style.fontWeight
    return w === 'bold' || w === '700' || w === '800' || w === '900'
  }
  const isItalicStyle = (el: HTMLElement) => el.style.fontStyle === 'italic'
  const isUnderlineStyle = (el: HTMLElement) => /underline/i.test(el.style.textDecoration)

  function walk(node: Node, style: Omit<Run, 'text'>) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || ''
      if (text) current.push({ text, ...style })
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const el = node as HTMLElement
    const tag = el.tagName

    if (tag === 'BR') { pushLine(); return }

    const isBlock = tag === 'DIV' || tag === 'P'
    if (isBlock && current.length > 0) pushLine()

    const next: Omit<Run, 'text'> = { ...style }
    if (tag === 'B' || tag === 'STRONG' || isBoldStyle(el))    next.bold = true
    if (tag === 'I' || tag === 'EM'     || isItalicStyle(el))  next.italic = true
    if (tag === 'U' || isUnderlineStyle(el))                   next.underline = true

    for (const child of Array.from(el.childNodes)) walk(child, next)

    if (isBlock && current.length > 0) pushLine()
  }

  for (const child of Array.from(root.childNodes)) {
    walk(child, { bold: false, italic: false, underline: false })
  }
  if (current.length > 0) pushLine()
  if (lines.length === 0) lines.push([])
  return lines
}

// pdf-lib's standard fonts (Helvetica/Times/Courier) only encode WinAnsi
// (Latin-1 + a few extras). Anything outside this range is replaced with `?`
// by `sanitize` below — fine for English/German/French but mangles Russian,
// Vietnamese, CJK, etc. `pickFontFor` consults this helper to decide whether
// to use a standard font (with sanitize) or the bundled Noto Sans (Unicode).
function isWinAnsiOnly(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c >= 0x20 && c <= 0x7e) continue   // ASCII printable
    if (c >= 0xa0 && c <= 0xff) continue   // Latin-1 supplement (accented)
    if (c === 0x09) continue               // tab
    return false
  }
  return true
}

function sanitize(s: string): string {
  return s.replace(/[^\x20-\x7E\xA0-\xFF]/g, '?')
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const b64 = dataUrl.split(',')[1]
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

function parseHexColor(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return rgb(0, 0, 0)
  const n = parseInt(m[1], 16)
  return rgb(((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255)
}

// Decode any browser-supported image and re-export as PNG bytes via canvas.
// Used for GIF / WebP / anything pdf-lib can't embed directly.
async function reencodeToPng(dataUrl: string): Promise<Uint8Array> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image()
    i.onload = () => resolve(i)
    i.onerror = () => reject(new Error('Could not decode image for re-encode'))
    i.src = dataUrl
  })
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth || 1
  canvas.height = img.naturalHeight || 1
  canvas.getContext('2d')!.drawImage(img, 0, 0)
  return dataUrlToBytes(canvas.toDataURL('image/png'))
}
