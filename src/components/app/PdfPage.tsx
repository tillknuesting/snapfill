import { useEffect, useMemo, useRef, useState } from 'react'
import type { PDFPageProxy, PageViewport, RenderTask } from 'pdfjs-dist'
import { Loader2 } from 'lucide-react'
import { usePdfStore } from '@/store/usePdfStore'
import type { Annotation as AnnotType, FontFamily, PageInfo, TextAnnotation, TextEditAnnotation } from '@/types'
import { Annotation } from './Annotation'
import { FONT_FAMILIES } from '@/utils/fonts'
import { detectFormRows, findRowAt, refineRowsWithText, type FormRow } from '@/utils/detectFormRows'
import { pointsToSmoothPath, strokeToDrawingAnnotation } from '@/utils/drawing'
import { cn } from '@/lib/utils'

// Edit mode reads pdf.js text positions to overlay clickable targets per run.
// pdf.js reports a font family hint per text item; map it to one of our
// bundled font families. The resolution is intentionally coarse — see the
// research note in the README: even commercial SDKs accept "approximate" font
// matching when the embedded font isn't available for the new glyphs.
function pickFontFamily(reported: string): FontFamily {
  const s = reported.toLowerCase()
  if (s.includes('mono') || s.includes('courier') || s.includes('consolas') || s.includes('typewriter')) return 'courier'
  if (s.includes('serif') && !s.includes('sans')) return 'times'
  return 'helvetica'
}

// Run grouping + alignment heuristics — extracted to src/utils/textRuns
// so they can be unit-tested without booting pdf.js.
import { detectAlignment, groupParagraphs, groupTextRuns, type TextRun } from '@/utils/textRuns'

// pdf.js exposes a font hint per run via `tc.styles[fontName].fontFamily`.
// For PDFs that embed faces named like "Times-Bold" or "Arial,BoldItalic",
// the hint commonly preserves the suffix; this lets us pick up the original
// styling and wrap the editor's data with <b>/<i> so it round-trips through
// the same parseHtmlToLines path that text annotations already use.
function detectFontStyle(fontName: string, fontFamily: string): { bold: boolean; italic: boolean } {
  const s = (fontName + ' ' + fontFamily).toLowerCase()
  return {
    bold: /bold|black|heavy|extra-?bold|semi-?bold/.test(s),
    italic: /italic|oblique|slant/.test(s),
  }
}

// Sample the rendered text colour by reading a grid of pixels *inside* the
// run's bbox and picking the darkest — for typical dark-on-light forms this
// lands on a glyph pixel. Returns a hex string, or null when the bbox looks
// empty (lightest sample still close to white = the canvas hasn't painted
// glyphs there yet).
function sampleTextColor(
  canvas: HTMLCanvasElement | null,
  cssX: number,
  cssY: number,
  cssW: number,
  cssH: number,
): string | null {
  if (!canvas || cssW < 4 || cssH < 4) return null
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  const dpr = canvas.width / canvas.clientWidth
  const samples: Array<[number, number, number]> = []
  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 4; j++) {
      const px = cssX + (cssW * (i + 1)) / 7
      const py = cssY + (cssH * (j + 1)) / 5
      if (px < 0 || py < 0 || px >= canvas.clientWidth || py >= canvas.clientHeight) continue
      try {
        const data = ctx.getImageData(Math.round(px * dpr), Math.round(py * dpr), 1, 1).data
        samples.push([data[0], data[1], data[2]])
      } catch { /* tainted or out of range */ }
    }
  }
  if (samples.length === 0) return null
  // Darkest pixel wins — for the dark-on-light case that's a glyph stroke.
  let best = samples[0]
  let bestBrightness = best[0] + best[1] + best[2]
  for (const s of samples) {
    const b = s[0] + s[1] + s[2]
    if (b < bestBrightness) { best = s; bestBrightness = b }
  }
  // If even the darkest is near-white, the bbox covers blank space (e.g.
  // pdf.js reported a degenerate run) — defer to the caller's default.
  if (bestBrightness > 660) return null
  const hx = (n: number) => n.toString(16).padStart(2, '0')
  return `#${hx(best[0])}${hx(best[1])}${hx(best[2])}`
}

// Sample a few pixels just *outside* the run's bbox to detect the page
// background colour. Returns a hex string, or null when the canvas isn't
// readable (e.g. CORS-tainted, not painted yet). Tries above, below, and
// to the right; the median R/G/B wins to dampen anti-aliased edge pixels.
function samplePageBackground(
  canvas: HTMLCanvasElement | null,
  cssX: number,
  cssY: number,
  cssW: number,
  cssH: number,
): string | null {
  if (!canvas) return null
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  const dpr = canvas.width / canvas.clientWidth
  const probes: Array<[number, number]> = [
    [cssX + cssW / 2, cssY - 3],            // above center
    [cssX + cssW / 2, cssY + cssH + 3],     // below center
    [cssX + cssW + 4, cssY + cssH / 2],     // right
    [cssX - 4,        cssY + cssH / 2],     // left
  ]
  const samples: Array<[number, number, number]> = []
  for (const [px, py] of probes) {
    if (px < 0 || py < 0 || px >= canvas.clientWidth || py >= canvas.clientHeight) continue
    try {
      const data = ctx.getImageData(Math.round(px * dpr), Math.round(py * dpr), 1, 1).data
      samples.push([data[0], data[1], data[2]])
    } catch { /* canvas tainted or out of range */ }
  }
  if (samples.length === 0) return null
  const med = (i: 0 | 1 | 2) => {
    const xs = samples.map((s) => s[i]).sort((a, b) => a - b)
    return xs[Math.floor(xs.length / 2)]
  }
  const r = med(0), g = med(1), b = med(2)
  const hx = (n: number) => n.toString(16).padStart(2, '0')
  return `#${hx(r)}${hx(g)}${hx(b)}`
}

interface PdfPageProps {
  page: PDFPageProxy
  pageIdx: number
  cssWidth: number
  textFamily: FontFamily
  textSize: number
  textColor: string
  snapEnabled: boolean
  onPageInfo: (info: PageInfo) => void
}

// Toggle the snap-debug overlay via `?snap=debug` in the URL. Read once at
// module load so the rest of the component code stays a plain boolean.
const SNAP_DEBUG = typeof window !== 'undefined'
  && new URLSearchParams(window.location.search).get('snap') === 'debug'

function formRowOverlapFraction(a: FormRow, b: FormRow): number {
  const ix = Math.max(0, Math.min(a.xEnd, b.xEnd) - Math.max(a.xStart, b.xStart))
  const iy = Math.max(0, Math.min(a.topY + a.height, b.topY + b.height) - Math.max(a.topY, b.topY))
  const inter = ix * iy
  if (inter === 0) return 0
  const minArea = Math.min((a.xEnd - a.xStart) * a.height, (b.xEnd - b.xStart) * b.height)
  return minArea > 0 ? inter / minArea : 0
}

interface FormFieldDef {
  id: string
  fieldName: string
  fieldType: 'Tx' | 'Btn'
  multiLine: boolean
  checkBox: boolean
  initialValue: string | boolean
  left: number
  top: number
  width: number
  height: number
}

export function PdfPage({
  page, pageIdx, cssWidth,
  textFamily, textSize, textColor,
  snapEnabled,
  onPageInfo,
}: PdfPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [viewport, setViewport] = useState<PageViewport | null>(null)
  const [pdfWidth, setPdfWidth] = useState(0)
  const [pdfHeight, setPdfHeight] = useState(0)
  const [formFields, setFormFields] = useState<FormFieldDef[]>([])
  const [formRows, setFormRows] = useState<FormRow[]>([])
  const [hoverRow, setHoverRow] = useState<FormRow | null>(null)
  const [textRuns, setTextRuns] = useState<TextRun[]>([])

  // Narrow subscriptions — actions are stable references in zustand, so
  // selecting them individually doesn't trigger spurious re-renders.
  const mode = usePdfStore((s) => s.mode)
  const annotations = usePdfStore((s) => s.annotations)
  const pendingSignature = usePdfStore((s) => s.pendingSignature)
  const pendingTextValue = usePdfStore((s) => s.pendingTextValue)
  const pendingDateMs = usePdfStore((s) => s.pendingDateMs)
  const pendingImage = usePdfStore((s) => s.pendingImage)
  const penColor = usePdfStore((s) => s.penColor)
  const penOpacity = usePdfStore((s) => s.penOpacity)
  const penWidth = usePdfStore((s) => s.penWidth)
  const addAnnotation = usePdfStore((s) => s.addAnnotation)
  const setMode = usePdfStore((s) => s.setMode)
  const setSelectedId = usePdfStore((s) => s.setSelectedId)
  const setFormField = usePdfStore((s) => s.setFormField)
  const setPendingTextValue = usePdfStore((s) => s.setPendingTextValue)
  const setPendingDateMs = usePdfStore((s) => s.setPendingDateMs)
  const setPendingImage = usePdfStore((s) => s.setPendingImage)

  // In-progress pen stroke as raw CSS px points; null when not drawing.
  // Two-tier storage: a ref accumulates raw points at full pointer rate; we
  // commit to React state once per animation frame to keep renders cheap.
  const strokeRef = useRef<Array<[number, number]> | null>(null)
  const rafRef = useRef<number | null>(null)
  const [currentStroke, setCurrentStroke] = useState<Array<[number, number]> | null>(null)

  // Lazy rendering: only paint the canvas when the wrapper enters the
  // viewport (or its rootMargin halo). Big PDFs no longer pay 100×
  // page.render() up-front.
  const wrapperRef = useRef<HTMLDivElement>(null)
  const [isVisible, setIsVisible] = useState(false)
  // Flips to true after page.render()'s promise resolves. Drives the
  // per-page spinner overlay so users see something on a 50MB PDF instead
  // of a blank rectangle while pdf.js paints each canvas.
  const [painted, setPainted] = useState(false)

  // Metadata effect — viewport / page info / form fields / form rows. Cheap
  // (no canvas paint), runs once per page on mount or when cssWidth changes.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const baseViewport = page.getViewport({ scale: 1 })
      const scale = cssWidth / baseViewport.width
      const vp = page.getViewport({ scale })
      if (cancelled) return
      setViewport(vp)
      setPdfWidth(baseViewport.width)
      setPdfHeight(baseViewport.height)
      // Gate `onPageInfo` on `cancelled` too — without it a stale viewport
      // (after a rapid cssWidth change or PDF switch) would overwrite the
      // parent's pages array.
      if (cancelled) return
      onPageInfo({
        pageIdx,
        cssWidth: vp.width,
        cssHeight: vp.height,
        pdfWidth: baseViewport.width,
        pdfHeight: baseViewport.height,
      })

      // Acroform widget annotations serve double duty:
      //   1. As live <input>/<textarea> overlays so the user can fill the
      //      form directly (formFields).
      //   2. As snap targets in Add Text mode for forms whose fields are
      //      *only* widgets (no drawn rectangles or rules on the canvas).
      //      Many PDFs ship like this — the visible "field" is really just
      //      a widget annotation. Without this branch the detector returns
      //      zero cells and snap appears broken to the user.
      let widgetRows: FormRow[] = []
      try {
        const annots = await page.getAnnotations()
        if (cancelled) return
        const fields: FormFieldDef[] = []
        for (const a of annots) {
          if (a.subtype !== 'Widget' || !a.fieldName) continue
          const [x1, y1, x2, y2] = a.rect
          const [vx1, vy1] = vp.convertToViewportPoint(x1, y1)
          const [vx2, vy2] = vp.convertToViewportPoint(x2, y2)
          const left = Math.min(vx1, vx2)
          const top = Math.min(vy1, vy2)
          const width = Math.abs(vx2 - vx1)
          const height = Math.abs(vy2 - vy1)
          if (a.fieldType === 'Tx') {
            fields.push({
              id: a.id, fieldName: a.fieldName, fieldType: 'Tx',
              multiLine: !!a.multiLine, checkBox: false,
              initialValue: a.fieldValue ?? '',
              left, top, width, height,
            })
            // Skip checkbox-shaped (very small) widgets and zero-area ones.
            const xStart = Math.min(x1, x2)
            const xEnd = Math.max(x1, x2)
            const topYpdf = baseViewport.height - Math.max(y1, y2)
            const heightPdf = Math.abs(y2 - y1)
            const widthPdf = xEnd - xStart
            if (widthPdf >= 20 && heightPdf >= 9) {
              widgetRows.push({ topY: topYpdf, height: heightPdf, xStart, xEnd })
            }
          } else if (a.fieldType === 'Btn' && a.checkBox) {
            fields.push({
              id: a.id, fieldName: a.fieldName, fieldType: 'Btn',
              multiLine: false, checkBox: true,
              initialValue: !!a.fieldValue && a.fieldValue !== 'Off',
              left, top, width, height,
            })
          }
        }
        if (!cancelled) setFormFields(fields)
      } catch { /* malformed annotations — skip */ }

      try {
        const detected = await detectFormRows(page, baseViewport.height)
        // Widget rects are authoritative — the form author drew them as
        // input fields. The detector's line-pair rows often span an entire
        // band (label row + field row), so when a widget falls inside a
        // detected row, prefer the widget and drop the detected row. The
        // I-9's "City | State | Zip | SSN" cluster is a clean example: four
        // narrow widget rects sit inside one wide detector row band, and
        // without this priority you'd snap to one big rectangle covering
        // labels + fields instead of the four field boxes.
        const combined: FormRow[] = [...widgetRows]
        for (const d of detected) {
          if (combined.some((c) => formRowOverlapFraction(c, d) > 0.5)) continue
          combined.push(d)
        }
        // Re-sort smallest-first so findRowAt prefers the tighter cell.
        combined.sort((a, b) => (a.height * (a.xEnd - a.xStart)) - (b.height * (b.xEnd - b.xStart)))
        if (!cancelled) setFormRows(combined)
      } catch (err) {
        console.warn('Form-row detection failed:', err)
      }

      // Edit mode reads text positions from pdf.js. Cheap: a single
      // getTextContent() call per page, results memoised in state.
      try {
        const tc = await page.getTextContent()
        if (cancelled) return
        const runs: TextRun[] = []
        for (const item of tc.items) {
          if (!('str' in item) || !item.str) continue
          const tr = item.transform
          // Baseline in viewport (top-left origin) — convertToViewportPoint flips Y.
          const [vx, vy] = baseViewport.convertToViewportPoint(tr[4], tr[5])
          // Font size from the text matrix is the authoritative rendered
          // size in user space; pdf.js's `item.height` is the rendered glyph
          // bbox height, which can include diacritics / descenders and
          // overshoot the typeset size by a few percent.
          const fontSize = Math.hypot(tr[1], tr[3]) || item.height || 12
          // Bbox height takes the larger of the two — that way the click
          // target covers the whole rendered glyph including any extras.
          const h = Math.max(item.height || 0, fontSize)
          const w = item.width || fontSize * (item.str.length * 0.5)
          if (w < 4 || h < 4) continue   // ignore degenerate runs (e.g. \0)
          const familyHint = tc.styles[item.fontName]?.fontFamily ?? ''
          const family = pickFontFamily(familyHint)
          // pdf.js's text-content style hint coarses everything to
          // "sans-serif" / "serif", losing weight + slant. The full Font
          // object lives on `page.commonObjs` once fonts have loaded — read
          // its `bold` / `italic` flags directly.
          let resolvedBold = false
          let resolvedItalic = false
          try {
            const fnt = page.commonObjs.has(item.fontName)
              ? page.commonObjs.get(item.fontName)
              : null
            if (fnt && typeof fnt === 'object') {
              const f = fnt as { bold?: boolean; italic?: boolean; name?: string }
              resolvedBold = !!f.bold
              resolvedItalic = !!f.italic
              // Some fonts only encode style in the name; layer the heuristic.
              const heur = detectFontStyle(f.name ?? '', familyHint)
              resolvedBold = resolvedBold || heur.bold
              resolvedItalic = resolvedItalic || heur.italic
            } else {
              const heur = detectFontStyle(item.fontName, familyHint)
              resolvedBold = heur.bold
              resolvedItalic = heur.italic
            }
          } catch { /* font not yet resolved */ }
          const bold = resolvedBold
          const italic = resolvedItalic
          runs.push({
            str: item.str, x: vx, y: vy - h, w, h,
            fontName: item.fontName, family, fontSize,
            bold, italic,
          })
        }
        if (!cancelled) {
          // Pipeline: per-line same-font merge → paragraph cluster merge →
          // alignment detection. Each pass narrows the structure further.
          const horizontal = groupTextRuns(runs)
          const paragraphs = groupParagraphs(horizontal)
          const aligned = detectAlignment(paragraphs)
          setTextRuns(aligned)
        }
      } catch (err) {
        console.warn('Text-content fetch failed:', err)
      }
    })()
    return () => { cancelled = true }
  }, [page, pageIdx, cssWidth, onPageInfo])

  // Visibility effect — IntersectionObserver. Once visible, stay visible:
  // the canvas is cheap to keep around relative to the cost of re-rendering
  // it on each scroll-back. (If memory becomes an issue with very long PDFs
  // we can re-introduce eviction.)
  useEffect(() => {
    if (!wrapperRef.current || isVisible) return
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) if (e.isIntersecting) { setIsVisible(true); break }
      },
      // Pre-render pages within ~one viewport-height of the user's scroll
      // position so they're ready by the time they're actually on screen.
      { rootMargin: '500px 0px' },
    )
    obs.observe(wrapperRef.current)
    return () => obs.disconnect()
  }, [isVisible])

  // Canvas paint effect — runs only when visible.
  useEffect(() => {
    if (!isVisible || !viewport || !canvasRef.current) return
    let cancelled = false
    let task: RenderTask | null = null
    setPainted(false)
    ;(async () => {
      const canvas = canvasRef.current
      if (!canvas || cancelled) return
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.floor(viewport.width * dpr)
      canvas.height = Math.floor(viewport.height * dpr)
      canvas.style.width = viewport.width + 'px'
      canvas.style.height = viewport.height + 'px'
      const ctx = canvas.getContext('2d')!
      ctx.scale(dpr, dpr)
      task = page.render({ canvasContext: ctx, viewport, canvas })
      try {
        await task.promise
        if (!cancelled) setPainted(true)
      } catch { /* cancelled */ }
    })()
    return () => {
      cancelled = true
      try { task?.cancel() } catch { /* noop */ }
    }
  }, [isVisible, viewport, page])

  // Scale: CSS pixels per PDF point. The annotation coords are in PDF points,
  // so they stay pinned to the same spot when the window resizes.
  const scale = pdfWidth > 0 ? (viewport?.width ?? cssWidth) / pdfWidth : 1
  const pageAnnots = useMemo(
    () => annotations.filter((a) => a.pageIdx === pageIdx),
    [annotations, pageIdx],
  )

  // The detector returns each cell as the full band between two horizontal
  // rules; on forms like the IRS 1040 that band contains a small printed
  // label at the top ("Your first name and initial") and the actual writing
  // strip below it. Refine each row by pushing topY past any label-shaped
  // text runs sitting in its upper half so snap targets match the fillable
  // area, not the label.
  const snapRows = useMemo(
    () => refineRowsWithText(formRows, textRuns),
    [formRows, textRuns],
  )

  function handleOverlayClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget) return
    if (mode === 'idle') return
    if (mode === 'select') { setSelectedId(null); return }

    const rect = e.currentTarget.getBoundingClientRect()
    // Convert click to PDF points
    const xPdf = (e.clientX - rect.left) / scale
    const yPdf = (e.clientY - rect.top) / scale

    if (mode === 'text') {
      const snap = snapEnabled ? findRowAt(snapRows, xPdf, yPdf) : null
      let x: number, y: number, w: number, h: number, fs: number
      if (snap) {
        x = snap.xStart
        y = snap.topY
        w = snap.xEnd - snap.xStart
        h = snap.height
        // For ordinary single-line cells (≲ 28 pt tall), font ≈ 72% of cell
        // height fits comfortably with ~14% padding above and below — typical
        // for printed forms with 14–22 pt line spacing. For taller widgets
        // (multi-line text fields), default to a normal 11 pt body size so
        // the user can fit several lines, instead of a 36 pt cartoon caption.
        fs = snap.height > 28
          ? 11
          : Math.max(8, Math.min(20, snap.height * 0.72))
      } else {
        x = xPdf
        y = yPdf
        w = 200 / scale
        fs = Math.max(6, Math.min(72, textSize))
        h = Math.round(fs * 1.6)
      }
      const a: TextAnnotation = {
        id: crypto.randomUUID(),
        type: 'text',
        pageIdx,
        x, y, w, h,
        data: pendingTextValue ?? '',
        fontSize: fs,
        family: textFamily,
        color: textColor,
        ...(pendingDateMs != null ? { dateMs: pendingDateMs } : {}),
      }
      addAnnotation(a)
      setPendingTextValue(null)
      setPendingDateMs(null)
      setMode('idle')
      setTimeout(() => {
        const ed = document.querySelector<HTMLDivElement>(`[data-id="${a.id}"] [contenteditable]`)
        ed?.focus()
      }, 0)
    } else if (mode === 'signature') {
      if (!pendingSignature) return
      const img = new Image()
      img.onload = () => {
        const cssW = 180
        const cssH = cssW * (img.height / img.width)
        const wPdf = cssW / scale
        const hPdf = cssH / scale
        const a: AnnotType = {
          id: crypto.randomUUID(),
          type: 'signature',
          pageIdx,
          x: xPdf - wPdf / 2,
          y: yPdf - hPdf / 2,
          w: wPdf,
          h: hPdf,
          data: pendingSignature,
        }
        addAnnotation(a)
        setMode('select')
        setSelectedId(a.id)
      }
      img.src = pendingSignature
    } else if (mode === 'image') {
      if (!pendingImage) return
      const aspect = pendingImage.height / pendingImage.width
      // Default size: ~200 PDF pt wide, capped to half the page width so
      // photos don't dominate the page on small forms.
      const wPdf = Math.min(200, pdfWidth * 0.5)
      const hPdf = wPdf * aspect
      const a: AnnotType = {
        id: crypto.randomUUID(),
        type: 'image',
        pageIdx,
        x: xPdf - wPdf / 2,
        y: yPdf - hPdf / 2,
        w: wPdf,
        h: hPdf,
        data: pendingImage.dataUrl,
        mime: pendingImage.mime,
      }
      addAnnotation(a)
      setPendingImage(null)
      setMode('select')
      setSelectedId(a.id)
    }
  }

  return (
    <div
      ref={wrapperRef}
      data-page-idx={pageIdx}
      className="relative bg-white shadow-lg"
      style={{ width: viewport?.width, height: viewport?.height, lineHeight: 0 }}
    >
      <canvas ref={canvasRef} className="block" />
      {/* Per-page loading overlay — visible until page.render() resolves.
          Big PDFs (50MB+) take a moment per canvas; without this the user
          sees a blank rectangle and assumes the app stalled. */}
      {viewport && !painted && (
        <div
          className="pointer-events-none absolute inset-0 flex items-center justify-center bg-white/40"
          aria-hidden="true"
        >
          <Loader2 className="size-6 animate-spin text-muted-foreground/60" />
        </div>
      )}
      <div
        onClick={handleOverlayClick}
        onPointerDown={(e) => {
          if (mode !== 'draw') return
          if (e.target !== e.currentTarget) return
          e.preventDefault();
          (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId)
          const rect = e.currentTarget.getBoundingClientRect()
          strokeRef.current = [[e.clientX - rect.left, e.clientY - rect.top]]
          setCurrentStroke(strokeRef.current)
        }}
        onPointerMove={(e) => {
          if (mode === 'draw' && strokeRef.current) {
            const rect = e.currentTarget.getBoundingClientRect()
            strokeRef.current.push([e.clientX - rect.left, e.clientY - rect.top])
            // Coalesce at most one render per animation frame.
            if (rafRef.current === null) {
              rafRef.current = requestAnimationFrame(() => {
                rafRef.current = null
                if (strokeRef.current) setCurrentStroke([...strokeRef.current])
              })
            }
            return
          }
          if (mode !== 'text' || !snapEnabled || snapRows.length === 0) {
            if (hoverRow) setHoverRow(null)
            return
          }
          const rect = e.currentTarget.getBoundingClientRect()
          const xPdf = (e.clientX - rect.left) / scale
          const yPdf = (e.clientY - rect.top) / scale
          const r = findRowAt(snapRows, xPdf, yPdf)
          if (r !== hoverRow) setHoverRow(r)
        }}
        onPointerUp={() => {
          if (mode === 'draw' && strokeRef.current) {
            if (rafRef.current !== null) {
              cancelAnimationFrame(rafRef.current)
              rafRef.current = null
            }
            const a = strokeToDrawingAnnotation(
              strokeRef.current, scale, pageIdx, penColor, penOpacity, penWidth,
            )
            if (a) addAnnotation(a)
            strokeRef.current = null
            setCurrentStroke(null)
          }
        }}
        onPointerCancel={() => {
          if (rafRef.current !== null) {
            cancelAnimationFrame(rafRef.current)
            rafRef.current = null
          }
          strokeRef.current = null
          if (currentStroke) setCurrentStroke(null)
        }}
        onMouseLeave={() => setHoverRow(null)}
        className={cn(
          'absolute inset-0',
          (mode === 'text' || mode === 'signature' || mode === 'draw') ? 'cursor-crosshair' : 'cursor-default',
        )}
        style={{ lineHeight: 'normal' }}
      >
        {/* Snap debug overlay — every detected cell, color-cycled per row */}
        {SNAP_DEBUG && snapRows.length > 0 && (
          <div className="pointer-events-none absolute inset-0">
            {snapRows.map((r, i) => (
              <div
                key={i}
                className="absolute border"
                style={{
                  left: r.xStart * scale,
                  top: r.topY * scale,
                  width: (r.xEnd - r.xStart) * scale,
                  height: r.height * scale,
                  // Cycle hues so adjacent rows are distinguishable.
                  borderColor: `hsl(${(i * 47) % 360} 80% 50% / 0.85)`,
                  background: `hsl(${(i * 47) % 360} 80% 50% / 0.10)`,
                }}
              />
            ))}
            <div
              data-testid="snap-cell-count"
              className="absolute right-1 top-1 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] text-white"
            >
              {snapRows.length} cells
            </div>
          </div>
        )}

        {/* Snap preview while hovering in Add text mode */}
        {hoverRow && mode === 'text' && (
          <div
            className="pointer-events-none absolute rounded-sm border border-primary/60 bg-primary/10"
            style={{
              left: hoverRow.xStart * scale,
              top: hoverRow.topY * scale,
              width: (hoverRow.xEnd - hoverRow.xStart) * scale,
              height: hoverRow.height * scale,
            }}
          />
        )}

        {/* In-progress pen stroke */}
        {currentStroke && currentStroke.length > 0 && viewport && (
          <svg
            className="pointer-events-none absolute inset-0"
            width={viewport.width}
            height={viewport.height}
          >
            <path
              d={pointsToSmoothPath(currentStroke)}
              stroke={penColor}
              strokeWidth={penWidth * scale}
              strokeOpacity={penOpacity}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
        {/* Edit-text mode — click-target per text run. Filter out runs that
            already have a textEdit annotation overlapping them so the user
            doesn't accidentally stack edits on the same word. */}
        {viewport && mode === 'edit' && textRuns.map((run, i) => {
          const alreadyEdited = pageAnnots.some(
            (a) => a.type === 'textEdit'
              && Math.abs(a.x - run.x) < 2 && Math.abs(a.y - run.y) < 2,
          )
          if (alreadyEdited) return null
          return (
            <button
              key={i}
              type="button"
              tabIndex={-1}
              data-testid="edit-target"
              // Native tooltip surfaces the original text so the user knows
              // what they're about to overwrite without having to click first.
              title={run.str}
              className="absolute cursor-text rounded-[2px] bg-primary/0 outline-1 outline-transparent transition-colors hover:bg-primary/15 hover:outline hover:outline-primary"
              style={{
                left: run.x * scale,
                top: run.y * scale,
                width: run.w * scale,
                height: run.h * scale,
              }}
              onClick={(e) => {
                e.stopPropagation()
                // Sample the page colours under the run before we add the
                // annotation; both travel into the annotation so the export
                // and screen render use the same values.
                const cover = samplePageBackground(
                  canvasRef.current,
                  run.x * scale, run.y * scale,
                  run.w * scale, run.h * scale,
                ) ?? '#ffffff'
                const sampledColor = sampleTextColor(
                  canvasRef.current,
                  run.x * scale, run.y * scale,
                  run.w * scale, run.h * scale,
                )
                // Preserve the original font's bold / italic styling by
                // wrapping the replacement with the same HTML tags the rich-
                // text branch already understands. parseHtmlToLines in
                // buildPdf round-trips these into pdf-lib's Helvetica-Bold /
                // Italic fonts on export.
                //
                // For multi-line targets the grouper has already joined the
                // lines with <br> in `_multiLineHtml`; reuse that verbatim
                // rather than re-escaping the linebreaks-included str.
                let data = run._multiLineHtml ?? run.str
                  .replace(/&/g, '&amp;')
                  .replace(/</g, '&lt;')
                  .replace(/>/g, '&gt;')
                if (run.italic) data = `<i>${data}</i>`
                if (run.bold) data = `<b>${data}</b>`
                const a: TextEditAnnotation = {
                  id: crypto.randomUUID(),
                  type: 'textEdit',
                  pageIdx,
                  x: run.x, y: run.y, w: run.w, h: run.h,
                  // Cover bbox is fixed to the original glyph location so the
                  // user can drag the editor away without exposing the source.
                  origX: run.x, origY: run.y, origW: run.w, origH: run.h,
                  data,
                  fontSize: run.fontSize,
                  family: run.family,
                  // Falls back to the default ink colour when sampling fails
                  // (degenerate run, transparent background, etc.).
                  color: sampledColor ?? '#0a1f3d',
                  cover,
                  ...(run.align && run.align !== 'left' ? { align: run.align } : {}),
                  originalFontName: run.fontName,
                }
                addAnnotation(a)
                setMode('idle')
                // Default behaviour is "select all" so typing replaces the
                // whole run. Hold Alt while clicking to instead drop the
                // caret at the click point — useful when you want to tweak
                // a single character ("$1234.56" → "$9234.56") without
                // re-typing the rest. Works in Chrome / Safari via
                // caretRangeFromPoint and Firefox via caretPositionFromPoint.
                const altClick = e.altKey
                const clickX = e.clientX
                const clickY = e.clientY
                setTimeout(() => {
                  const ed = document.querySelector<HTMLDivElement>(
                    `[data-id="${a.id}"] [contenteditable]`,
                  )
                  if (!ed) return
                  ed.focus()
                  const sel = window.getSelection()
                  if (!sel) return
                  let range: Range | null = null
                  if (altClick) {
                    type CaretRangeFromPoint = (x: number, y: number) => Range | null
                    type CaretPositionFromPoint = (x: number, y: number) => { offsetNode: Node; offset: number } | null
                    const cwr = (document as unknown as { caretRangeFromPoint?: CaretRangeFromPoint }).caretRangeFromPoint
                    if (cwr) {
                      range = cwr.call(document, clickX, clickY)
                    } else {
                      const cpfp = (document as unknown as { caretPositionFromPoint?: CaretPositionFromPoint }).caretPositionFromPoint
                      if (cpfp) {
                        const pos = cpfp.call(document, clickX, clickY)
                        if (pos) {
                          range = document.createRange()
                          range.setStart(pos.offsetNode, pos.offset)
                          range.collapse(true)
                        }
                      }
                    }
                  }
                  if (!range) {
                    range = document.createRange()
                    range.selectNodeContents(ed)
                  }
                  sel.removeAllRanges()
                  sel.addRange(range)
                }, 0)
              }}
            />
          )
        })}

        {viewport && formFields.map((f) => (
          <FormField
            key={f.id}
            field={f}
            // Outside of plain idle mode (filling the form), widgets defer to
            // whatever the user has chosen — selecting an annotation, snapping
            // a text box, drawing, etc. Stays visible but doesn't capture
            // clicks meant for the overlay below.
            disabled={mode !== 'idle'}
            onChange={(v) => setFormField(f.fieldName, v)}
          />
        ))}

        {viewport && pageAnnots.map((a) => (
          <Annotation
            key={a.id}
            annotation={a}
            page={{
              pageIdx,
              cssWidth: viewport.width,
              cssHeight: viewport.height,
              pdfWidth,
              pdfHeight,
            }}
            scale={scale}
          />
        ))}
      </div>
    </div>
  )
}

function FormField({
  field, disabled, onChange,
}: {
  field: FormFieldDef
  disabled: boolean
  onChange: (v: string | boolean) => void
}) {
  const f = FONT_FAMILIES.helvetica
  const style = {
    left: field.left, top: field.top, width: field.width, height: field.height,
  } as React.CSSProperties
  const fontStyle = {
    fontFamily: f.css,
    fontSize: Math.min(field.height * 0.7, 14),
    // The PDF canvas is always white; force a dark text color so the input
    // doesn't inherit the app's dark-mode foreground (near-white) and become
    // invisible on the page.
    color: '#0a1f3d',
  } as React.CSSProperties
  const wrapStyle = { ...style, background: 'rgba(37,99,235,0.08)', borderColor: 'rgba(37,99,235,0.4)' }

  if (field.checkBox) {
    return (
      <div className={cn('absolute border', disabled && 'pointer-events-none opacity-50')} style={wrapStyle}>
        <input
          type="checkbox"
          defaultChecked={field.initialValue as boolean}
          onChange={(e) => onChange(e.target.checked)}
          className="h-full w-full"
        />
      </div>
    )
  }
  if (field.multiLine) {
    return (
      <div className={cn('absolute border', disabled && 'pointer-events-none opacity-50')} style={wrapStyle}>
        <textarea
          defaultValue={field.initialValue as string}
          onChange={(e) => onChange(e.target.value)}
          className="h-full w-full border-none bg-transparent p-1 outline-none"
          style={fontStyle}
        />
      </div>
    )
  }
  return (
    <div className={cn('absolute border', disabled && 'pointer-events-none opacity-50')} style={wrapStyle}>
      <input
        type="text"
        defaultValue={field.initialValue as string}
        onChange={(e) => onChange(e.target.value)}
        className="h-full w-full border-none bg-transparent px-1 outline-none"
        style={fontStyle}
      />
    </div>
  )
}
