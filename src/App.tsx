import { useCallback, useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { Toolbar } from '@/components/app/Toolbar'
import { ModeBanner } from '@/components/app/ModeBanner'
import { ErrorBoundary } from '@/components/app/ErrorBoundary'
import { Onboarding } from '@/components/app/Onboarding'
import { isRTL } from '@/utils/i18n'
import { PdfViewer } from '@/components/app/PdfViewer'
import { PdfPagesDialog, PdfThumbnailRail } from '@/components/app/PdfThumbnailRail'
import { EmptyState } from '@/components/app/EmptyState'
import { SignatureModal } from '@/components/app/SignatureModal'
import { ProfileDialog } from '@/components/app/ProfileDialog'
import { RecentSidebar } from '@/components/app/RecentSidebar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { usePdfStore } from '@/store/usePdfStore'
import {
  addRecentFile, loadRecentFileFull, updateRecentFile,
} from '@/utils/recentFiles'
// `mergePdf` and `reorderPdfPages` both pull in pdf-lib (~700KB minified).
// They're only used when the user clicks Merge or drags a thumbnail, so
// import them dynamically below to keep the initial bundle small. Same
// pattern as `buildPdf` in handleDownload.
import { formatDate } from '@/utils/dateFormats'
import { useT } from '@/utils/useT'
import type { PDFPageProxy } from 'pdfjs-dist'
import type { Annotation, CompressionLevel, FontFamily, PageInfo, RedactionAnnotation } from '@/types'

const AUTO_SAVE_DEBOUNCE_MS = 800

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc

type CompressionPreset = {
  dpi: number
  jpeg: number
}

type CanvasOverlayPainter = (ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement) => void

const COMPRESSION_PRESETS: Record<CompressionLevel, CompressionPreset> = {
  // Low compression keeps more visual detail.
  low: { dpi: 200, jpeg: 0.85 },
  // Mid is the default sharing/printing compromise.
  mid: { dpi: 150, jpeg: 0.75 },
  // High compression aims for the smallest file.
  high: { dpi: 96, jpeg: 0.6 },
}

async function renderPdfPageToJpeg(
  page: PDFPageProxy,
  preset: CompressionPreset,
  paintOverlays?: CanvasOverlayPainter,
): Promise<string> {
  const scale = preset.dpi / 72
  const vp = page.getViewport({ scale })
  const canvas = document.createElement('canvas')
  canvas.width = Math.floor(vp.width)
  canvas.height = Math.floor(vp.height)
  try {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not allocate canvas context')
    await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise
    paintOverlays?.(ctx, canvas)
    return canvas.toDataURL('image/jpeg', preset.jpeg)
  } finally {
    // Release the backing store promptly on large multi-page documents.
    canvas.width = 0
    canvas.height = 0
  }
}

async function renderPdfBytesToJpegs(
  bytes: Uint8Array,
  expectedPageCount: number,
  preset: CompressionPreset,
): Promise<string[]> {
  const task = pdfjsLib.getDocument({ data: bytes.slice() })
  const doc = await task.promise
  try {
    if (doc.numPages !== expectedPageCount) {
      throw new Error(`Compressed render page-count mismatch: expected ${expectedPageCount}, got ${doc.numPages}`)
    }
    const pageImages: string[] = []
    for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
      const page = await doc.getPage(pageNo)
      pageImages.push(await renderPdfPageToJpeg(page, preset))
      try { page.cleanup() } catch { /* noop */ }
    }
    return pageImages
  } finally {
    await doc.destroy()
  }
}

async function renderLoadedPagesToJpegs(
  pages: PDFPageProxy[],
  expectedPageCount: number,
  preset: CompressionPreset,
  opts: { bakeLiveFormFields?: boolean } = {},
): Promise<string[]> {
  if (pages.length !== expectedPageCount) {
    throw new Error(`Compressed render page-count mismatch: expected ${expectedPageCount}, got ${pages.length}`)
  }
  const pageImages: string[] = []
  for (let pageIdx = 0; pageIdx < pages.length; pageIdx++) {
    const page = pages[pageIdx]
    pageImages.push(await renderPdfPageToJpeg(
      page,
      preset,
      opts.bakeLiveFormFields
        ? (ctx, canvas) => drawLiveFormFieldsOntoCanvas(ctx, canvas, pageIdx)
        : undefined,
    ))
  }
  return pageImages
}

function drawLiveFormFieldsOntoCanvas(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  pageIdx: number,
) {
  const pageEl = document.querySelector<HTMLElement>(`[data-page-idx="${pageIdx}"]`)
  if (!pageEl) return
  const pageRect = pageEl.getBoundingClientRect()
  if (pageRect.width <= 0 || pageRect.height <= 0) return
  const scaleX = canvas.width / pageRect.width
  const scaleY = canvas.height / pageRect.height
  const fields = pageEl.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-form-field-name]')
  if (fields.length === 0) return

  ctx.save()
  for (const el of Array.from(fields)) {
    const rect = el.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) continue
    const x = (rect.left - pageRect.left) * scaleX
    const y = (rect.top - pageRect.top) * scaleY
    const w = rect.width * scaleX
    const h = rect.height * scaleY

    if (el instanceof HTMLInputElement && el.type === 'checkbox') {
      if (!el.checked) continue
      const pad = Math.min(w, h) * 0.22
      ctx.strokeStyle = '#0a1f3d'
      ctx.lineWidth = Math.max(1.5, Math.min(w, h) * 0.12)
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      ctx.moveTo(x + pad, y + h * 0.52)
      ctx.lineTo(x + w * 0.42, y + h - pad)
      ctx.lineTo(x + w - pad, y + pad)
      ctx.stroke()
      continue
    }

    const value = el.value
    if (!value) continue
    const style = window.getComputedStyle(el)
    const cssFontSize = Number.parseFloat(style.fontSize) || Math.min(rect.height * 0.7, 14)
    const fontSize = Math.max(6, cssFontSize * scaleY)
    const lineHeight = fontSize * 1.2
    const padX = Math.max(2, Number.parseFloat(style.paddingLeft) * scaleX || 4 * scaleX)
    const padY = Math.max(1, Number.parseFloat(style.paddingTop) * scaleY || 2 * scaleY)

    ctx.save()
    ctx.beginPath()
    ctx.rect(x, y, w, h)
    ctx.clip()
    ctx.fillStyle = style.color || '#0a1f3d'
    ctx.font = `${style.fontStyle || 'normal'} ${style.fontWeight || '400'} ${fontSize}px ${style.fontFamily || 'Helvetica, Arial, sans-serif'}`
    ctx.textBaseline = el instanceof HTMLTextAreaElement ? 'top' : 'middle'
    const lines = value.split(/\r?\n/)
    if (el instanceof HTMLTextAreaElement) {
      lines.forEach((line, idx) => {
        ctx.fillText(line, x + padX, y + padY + idx * lineHeight)
      })
    } else {
      ctx.fillText(lines[0] ?? '', x + padX, y + h / 2)
    }
    ctx.restore()
  }
  ctx.restore()
}

function captureRenderedPageImagesWithFormFields(pages: PageInfo[]): string[] {
  const pageImages: string[] = []
  for (let i = 0; i < pages.length; i++) {
    const source = document.querySelector<HTMLCanvasElement>(`[data-page-idx="${i}"] canvas`)
    if (!source) throw new Error(`page ${i + 1} canvas not rendered`)
    const canvas = document.createElement('canvas')
    canvas.width = source.width
    canvas.height = source.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not allocate canvas context')
    ctx.drawImage(source, 0, 0)
    drawLiveFormFieldsOntoCanvas(ctx, canvas, i)
    pageImages.push(canvas.toDataURL('image/png'))
    canvas.width = 0
    canvas.height = 0
  }
  return pageImages
}

async function burnRedactionsIntoPageImages(
  pageImages: string[],
  pages: PageInfo[],
  redactions: RedactionAnnotation[],
  jpegQuality: number,
): Promise<string[]> {
  if (redactions.length === 0) return pageImages
  const byPage = new Map<number, RedactionAnnotation[]>()
  for (const r of redactions) {
    const list = byPage.get(r.pageIdx) ?? []
    list.push(r)
    byPage.set(r.pageIdx, list)
  }
  const out: string[] = []
  for (let pageIdx = 0; pageIdx < pageImages.length; pageIdx++) {
    const list = byPage.get(pageIdx)
    if (!list?.length) {
      out.push(pageImages[pageIdx])
      continue
    }
    const info = pages[pageIdx]
    if (!info) {
      out.push(pageImages[pageIdx])
      continue
    }
    const img = await loadImage(pageImages[pageIdx])
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth || img.width || 1
    canvas.height = img.naturalHeight || img.height || 1
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Could not allocate redaction canvas')
    ctx.drawImage(img, 0, 0)
    const sx = canvas.width / info.pdfWidth
    const sy = canvas.height / info.pdfHeight
    for (const r of list) {
      ctx.fillStyle = r.color || '#000000'
      ctx.fillRect(r.x * sx, r.y * sy, r.w * sx, r.h * sy)
    }
    out.push(canvas.toDataURL('image/jpeg', jpegQuality))
    canvas.width = 0
    canvas.height = 0
  }
  return out
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not decode page image for redaction'))
    img.src = dataUrl
  })
}

function runWhenIdle(fn: () => void) {
  const requestIdle = (window as Window & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
  }).requestIdleCallback
  if (requestIdle) {
    requestIdle(fn, { timeout: 1_000 })
    return
  }
  window.setTimeout(fn, 0)
}

function AutoSaveRecentFile() {
  const recentId = usePdfStore((s) => s.recentId)
  const annotations = usePdfStore((s) => s.annotations)
  const formFieldEdits = usePdfStore((s) => s.formFieldEdits)
  const watermark = usePdfStore((s) => s.watermark)
  const pageNumbers = usePdfStore((s) => s.pageNumbers)
  const lastSavedRef = useRef<{
    id: string
    ann: Annotation[]
    ff: Map<string, string | boolean>
    wm: typeof watermark
    pn: typeof pageNumbers
  } | null>(null)

  useEffect(() => {
    if (!recentId) return
    // Skip the initial call right after loadFromRecent (lastSavedRef matches).
    const last = lastSavedRef.current
    if (last && last.id === recentId && last.ann === annotations && last.ff === formFieldEdits && last.wm === watermark && last.pn === pageNumbers) return
    const timer = setTimeout(() => {
      // Image annotations are deliberately session-only — strip before persist.
      // They live in memory and download fine, but they don't follow the PDF
      // across reloads or browser sessions.
      const persisted = annotations.filter((a) => a.type !== 'image')
      updateRecentFile(recentId, {
        annotations: persisted,
        formFieldEdits: Array.from(formFieldEdits.entries()),
        watermark,
        pageNumbers,
      }).catch(() => {})
      lastSavedRef.current = { id: recentId, ann: annotations, ff: formFieldEdits, wm: watermark, pn: pageNumbers }
    }, AUTO_SAVE_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [recentId, annotations, formFieldEdits, watermark, pageNumbers])

  return null
}

export default function App() {
  const t = useT()
  const pdfBytes = usePdfStore((s) => s.pdfBytes)
  const recentId = usePdfStore((s) => s.recentId)
  const mode = usePdfStore((s) => s.mode)
  const selectedId = usePdfStore((s) => s.selectedId)
  const setMode = usePdfStore((s) => s.setMode)
  const setPdf = usePdfStore((s) => s.setPdf)
  const setRecentId = usePdfStore((s) => s.setRecentId)
  const loadFromRecent = usePdfStore((s) => s.loadFromRecent)
  const mergeIntoPdf = usePdfStore((s) => s.mergeIntoPdf)
  const reorderPages = usePdfStore((s) => s.reorderPages)
  const rotatePage = usePdfStore((s) => s.rotatePage)
  const deletePage = usePdfStore((s) => s.deletePage)
  const setSelectedId = usePdfStore((s) => s.setSelectedId)
  const removeAnnotation = usePdfStore((s) => s.removeAnnotation)
  const undo = usePdfStore((s) => s.undo)
  const redo = usePdfStore((s) => s.redo)
  const setPendingTextValue = usePdfStore((s) => s.setPendingTextValue)
  const setPendingDateMs = usePdfStore((s) => s.setPendingDateMs)

  const [textFamily, setTextFamily] = useState<FontFamily>('helvetica')
  const [textSize, setTextSize] = useState(14)
  const [textColor, setTextColor] = useState('#0a1f3d')
  const [snapEnabled, setSnapEnabled] = useState(true)
  const [sigModalOpen, setSigModalOpen] = useState(false)
  const [profileDialogOpen, setProfileDialogOpen] = useState(false)
  const [recentRefreshKey, setRecentRefreshKey] = useState(0)
  const [pdfPages, setPdfPages] = useState<PDFPageProxy[]>([])
  const [pagesDialogOpen, setPagesDialogOpen] = useState(false)
  const [tourReplayKey, setTourReplayKey] = useState(0)
  const openSeqRef = useRef(0)

  // Mirror the current UI language onto the <html> element so the browser's
  // own RTL handling kicks in for Arabic — text reading order, scrollbars,
  // form controls all flip without us having to maintain a parallel CSS
  // direction stack. The `lang` attribute also helps screen readers and
  // hyphenation pick the right pronunciation rules per language.
  const lang = usePdfStore((s) => s.lang)
  const setLang = usePdfStore((s) => s.setLang)
  useEffect(() => {
    const html = document.documentElement
    html.lang = lang
    html.dir = isRTL(lang) ? 'rtl' : 'ltr'
  }, [lang])

  // Cross-tab sync — if the user changes the language in another tab, the
  // browser fires a `storage` event in this one. Mirror it into our store
  // so both tabs converge without a reload.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== 'pdfhelper.lang' || !e.newValue) return
      setLang(e.newValue as typeof lang)
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [setLang, lang])

  const handleOpenFile = useCallback(async (file: File) => {
    const seq = ++openSeqRef.current
    const buf = await file.arrayBuffer()
    const bytes = new Uint8Array(buf)
    // Show the PDF immediately. Recent-file fingerprinting walks the full
    // byte array; run it after first paint so large scans don't feel stuck.
    setPdf(bytes, file.name, null)
    runWhenIdle(() => {
      void (async () => {
        const id = await addRecentFile(file.name, bytes)
        if (!id || seq !== openSeqRef.current) return
        // Try loading saved annotations for this file (if it's a duplicate of
        // one we've seen before, we restore previous edits). If the user has
        // already started editing, keep their current session and only attach
        // the recent ID so auto-save can continue from there.
        const saved = await loadRecentFileFull(id)
        if (seq !== openSeqRef.current) return
        const cur = usePdfStore.getState()
        const untouched =
          cur.pdfBytes === bytes &&
          cur.annotations.length === 0 &&
          cur.formFieldEdits.size === 0
        const hasSavedEdits = !!saved && (
          saved.annotations.length > 0 ||
          saved.formFieldEdits.length > 0 ||
          (saved.watermark.enabled && saved.watermark.text.trim().length > 0) ||
          saved.pageNumbers.enabled
        )
        if (hasSavedEdits && untouched) {
          loadFromRecent(saved.bytes, saved.name, saved.id, saved.annotations, saved.formFieldEdits, saved.watermark, saved.pageNumbers)
        } else if (cur.pdfBytes === bytes) {
          setRecentId(id)
        }
        setRecentRefreshKey((k) => k + 1)
      })()
    })
  }, [setPdf, setRecentId, loadFromRecent])

  const handleMergePdf = useCallback(async (file: File, where: 'start' | 'end') => {
    if (!pdfBytes) return
    try {
      const { mergePdf } = await import('@/utils/mergePdf')
      const insertBytes = new Uint8Array(await file.arrayBuffer())
      const { bytes, insertedCount } = await mergePdf(pdfBytes, insertBytes, where)
      mergeIntoPdf(bytes, where, insertedCount)
      // Persist the merged bytes to the recent-file IDB entry so reloading
      // doesn't snap back to the pre-merge document. Annotations get
      // auto-saved separately by the existing debounced effect; we patch
      // bytes + size here in one go.
      if (recentId) {
        await updateRecentFile(recentId, {
          bytes,
          size: bytes.byteLength,
          openedAt: Date.now(),
        })
      }
    } catch (err) {
      alert(t('err.merge_pdf', { message: (err as Error).message }))
    }
  }, [pdfBytes, recentId, mergeIntoPdf, t])

  const handleReorderPages = useCallback(async (newOrder: number[]) => {
    if (!pdfBytes) return
    try {
      const { reorderPdfPages } = await import('@/utils/reorderPages')
      const bytes = await reorderPdfPages(pdfBytes, newOrder)
      reorderPages(bytes, newOrder)
      if (recentId) {
        await updateRecentFile(recentId, {
          bytes,
          size: bytes.byteLength,
          openedAt: Date.now(),
        })
      }
    } catch (err) {
      alert(t('err.reorder_pages', { message: (err as Error).message }))
    }
  }, [pdfBytes, recentId, reorderPages, t])

  const handleRotatePage = useCallback(async (pageIdx: number, direction: 'cw' | 'ccw') => {
    if (!pdfBytes) return
    try {
      const { rotatePdfPage } = await import('@/utils/rotatePage')
      const bytes = await rotatePdfPage(pdfBytes, pageIdx, direction)
      rotatePage(bytes)
      if (recentId) {
        await updateRecentFile(recentId, {
          bytes,
          size: bytes.byteLength,
          openedAt: Date.now(),
        })
      }
    } catch (err) {
      alert(t('err.rotate_page', { message: (err as Error).message }))
    }
  }, [pdfBytes, recentId, rotatePage, t])

  const handleDeletePage = useCallback(async (pageIdx: number) => {
    if (!pdfBytes) return
    try {
      const { deletePdfPage } = await import('@/utils/deletePage')
      const bytes = await deletePdfPage(pdfBytes, pageIdx)
      deletePage(bytes, pageIdx)
      if (recentId) {
        await updateRecentFile(recentId, {
          bytes,
          size: bytes.byteLength,
          openedAt: Date.now(),
        })
      }
    } catch (err) {
      alert(t('err.delete_page', { message: (err as Error).message }))
    }
  }, [deletePage, pdfBytes, recentId, t])

  const handleSwitchTo = useCallback(async (id: string) => {
    const rec = await loadRecentFileFull(id)
    if (!rec) return
    loadFromRecent(rec.bytes, rec.name, rec.id, rec.annotations, rec.formFieldEdits, rec.watermark, rec.pageNumbers)
    setRecentRefreshKey((k) => k + 1)
  }, [loadFromRecent])

  const pickFile = useCallback(() => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/pdf'
    input.onchange = () => { if (input.files?.[0]) handleOpenFile(input.files[0]) }
    input.click()
  }, [handleOpenFile])

  const handleDownload = useCallback(async (
    opts: { compress?: boolean; level?: CompressionLevel } = {},
  ) => {
    const {
      pdfBytes: currentPdfBytes,
      annotations,
      pages,
      formFieldEdits,
      watermark,
      pageNumbers,
      fileName: currentFileName,
    } = usePdfStore.getState()
    if (!currentPdfBytes) return
    if (pages.length === 0) {
      alert(t('err.pdf_loading'))
      return
    }
    const { compress = false, level = 'mid' } = opts
    // Lazy-load buildPdf and its heavy deps (pdf-lib + fontkit) — they're
    // only needed at download time, so they shouldn't be in the initial bundle.
    const { buildPdf } = await import('@/utils/buildPdf')
    const redactions = annotations.filter((a): a is RedactionAnnotation => a.type === 'redaction')
    const annotationsWithoutRedactions = annotations.filter((a) => a.type !== 'redaction')

    if (redactions.length > 0) {
      const preset = compress ? COMPRESSION_PRESETS[level] : COMPRESSION_PRESETS.low
      try {
        // Redaction output is deliberately raster-flattened. A vector black
        // rectangle over source PDF text is only cosmetic; rasterising after
        // the edit pass removes the selectable source text from the saved PDF.
        const editedWithoutRedactions = await buildPdf({
          pdfBytes: currentPdfBytes,
          annotations: annotationsWithoutRedactions,
          pages,
          formFieldEdits,
          watermark,
          pageNumbers,
        })
        const pageImages = await renderPdfBytesToJpegs(editedWithoutRedactions, pages.length, preset)
        const redactedImages = await burnRedactionsIntoPageImages(pageImages, pages, redactions, preset.jpeg)
        const redacted = await buildPdf({
          pdfBytes: editedWithoutRedactions,
          annotations: [],
          pages,
          formFieldEdits: new Map(),
          pageImages: redactedImages,
        })
        triggerDownload(redacted)
        return
      } catch (err) {
        console.warn('redacted download failed, trying source-page raster fallback:', err)
        try {
          if (pdfPages.length === 0) throw new Error(t('err.pdf_loading'), { cause: err })
          const pageImages = await renderLoadedPagesToJpegs(pdfPages, pages.length, preset, {
            bakeLiveFormFields: true,
          })
          const editedFallback = await buildPdf({
            pdfBytes: currentPdfBytes,
            annotations: annotationsWithoutRedactions,
            pages,
            formFieldEdits: new Map(),
            watermark,
            pageNumbers,
            pageImages,
          })
          const editedImages = await renderPdfBytesToJpegs(editedFallback, pages.length, preset)
          const redactedImages = await burnRedactionsIntoPageImages(editedImages, pages, redactions, preset.jpeg)
          const redacted = await buildPdf({
            pdfBytes: editedFallback,
            annotations: [],
            pages,
            formFieldEdits: new Map(),
            pageImages: redactedImages,
          })
          triggerDownload(redacted)
          return
        } catch (fallbackErr) {
          console.error('redacted download failed', fallbackErr)
          alert(t('err.redacted_pdf', { message: (fallbackErr as Error).message }))
          return
        }
      }
    }

    if (compress) {
      if (pdfPages.length === 0) {
        alert(t('err.pdf_loading'))
        return
      }
      try {
        const preset = COMPRESSION_PRESETS[level]
        // First build the normal edited PDF, then rasterise that output.
        // This preserves annotations and filled AcroForm widgets before
        // converting the document into JPEG-backed pages.
        const edited = await buildPdf({ pdfBytes: currentPdfBytes, annotations, pages, formFieldEdits, watermark, pageNumbers })
        const pageImages = await renderPdfBytesToJpegs(edited, pages.length, preset)
        const compressed = await buildPdf({
          pdfBytes: edited,
          annotations: [],
          pages,
          formFieldEdits: new Map(),
          pageImages,
        })
        triggerDownload(compressed.byteLength < edited.byteLength ? compressed : edited)
        return
      } catch (err) {
        console.warn('edited compressed download failed, trying source-page raster fallback:', err)
        try {
          const preset = COMPRESSION_PRESETS[level]
          const pageImages = await renderLoadedPagesToJpegs(pdfPages, pages.length, preset, {
            bakeLiveFormFields: true,
          })
          const compressed = await buildPdf({
            pdfBytes: currentPdfBytes,
            annotations,
            pages,
            formFieldEdits: new Map(),
            watermark,
            pageNumbers,
            pageImages,
          })
          triggerDownload(compressed)
          return
        } catch (fallbackErr) {
          console.error('compressed download failed', fallbackErr)
          alert(t('err.compressed_pdf', { message: (fallbackErr as Error).message }))
          return
        }
      }
    }

    try {
      const out = await buildPdf({ pdfBytes: currentPdfBytes, annotations, pages, formFieldEdits, watermark, pageNumbers })
      triggerDownload(out)
    } catch (err) {
      console.warn('strict buildPdf failed, falling back to raster:', err)
      // Some real-world PDFs (encrypted-flagged government forms with
      // unusual cross-reference structures) defeat pdf-lib's parser. We
      // render each page from the canvases that pdf.js already painted
      // into the DOM, bake live form-field overlays into those images, and
      // embed them in a fresh PDF before drawing annotations on top.
      try {
        const pageImages = captureRenderedPageImagesWithFormFields(pages)
        const out = await buildPdf({
          pdfBytes: currentPdfBytes,
          annotations,
          pages,
          formFieldEdits: new Map(),
          watermark,
          pageNumbers,
          pageImages,
        })
        triggerDownload(out)
      } catch (err2) {
        console.error(err2)
        alert(t('err.build_pdf', { message: (err2 as Error).message }))
      }
    }
    function triggerDownload(out: Uint8Array) {
      const blob = new Blob([out as BlobPart], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const stem = currentFileName.replace(/\.pdf$/i, '') || 'filled'
      a.download = `${stem}-filled.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    }
  }, [pdfPages, t])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null
      const typing = t?.tagName === 'INPUT' || t?.tagName === 'TEXTAREA' || t?.isContentEditable
      // Cmd/Ctrl+Z / Cmd/Ctrl+Shift+Z — undo / redo through the history stack
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !typing) {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }
      // Cmd/Ctrl+Y as an alternate redo
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'y' && !typing) {
        e.preventDefault()
        redo()
        return
      }
      // Single-key mode shortcuts. Skip when typing or any modifier is held.
      if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const k = e.key.toLowerCase()
        if (k === 't') { e.preventDefault(); setMode(mode === 'text'   ? 'idle' : 'text');   return }
        if (k === 's') { e.preventDefault(); setMode(mode === 'select' ? 'idle' : 'select'); return }
        if (k === 'd') { e.preventDefault(); setMode(mode === 'draw'   ? 'idle' : 'draw');   return }
        if (k === 'e') { e.preventDefault(); setMode(mode === 'edit'   ? 'idle' : 'edit');   return }
        if (k === 'r') { e.preventDefault(); setMode(mode === 'redact' ? 'idle' : 'redact'); return }
        if (k === 'i') {
          e.preventDefault()
          const now = Date.now()
          setPendingTextValue(formatDate(now, undefined))
          setPendingDateMs(now)
          setMode('text')
          return
        }
        if (k === 'p') { e.preventDefault(); setProfileDialogOpen(true); return }
      }
      if (e.key === 'Escape' && !typing && mode !== 'idle') {
        setMode('idle')
      } else if (mode === 'select' && selectedId && !typing && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault()
        removeAnnotation(selectedId)
        setSelectedId(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode, selectedId, removeAnnotation, setMode, setSelectedId, undo, redo, setPendingTextValue, setPendingDateMs])

  return (
    <ErrorBoundary strings={{
      title: t('app.error.title'),
      body: t('app.error.body'),
      reload: t('app.error.reload'),
    }}>
    <TooltipProvider>
      <Onboarding replayKey={tourReplayKey} />
      <AutoSaveRecentFile />
      <div className="flex h-full">
        <RecentSidebar
          onPickFile={pickFile}
          onSwitchTo={handleSwitchTo}
          refreshKey={recentRefreshKey}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="sticky top-0 z-30">
            <Toolbar
              onOpenFile={handleOpenFile}
              onMergePdf={handleMergePdf}
              onOpenSignature={() => setSigModalOpen(true)}
              onOpenProfile={() => setProfileDialogOpen(true)}
              onOpenHelp={() => setTourReplayKey((k) => k + 1)}
              onOpenPages={() => setPagesDialogOpen(true)}
              onDownload={handleDownload}
              hasMultiplePages={pdfPages.length > 1}
              textFamily={textFamily}
              setTextFamily={setTextFamily}
              textSize={textSize}
              setTextSize={setTextSize}
              textColor={textColor}
              setTextColor={setTextColor}
              snapEnabled={snapEnabled}
              setSnapEnabled={setSnapEnabled}
              sigModalOpen={sigModalOpen}
              profileDialogOpen={profileDialogOpen}
            />
            <ModeBanner />
          </div>
          <div className="flex min-h-0 flex-1">
            <main id="pdf-main" className="flex-1 overflow-auto bg-muted/30">
              {pdfBytes ? (
                <PdfViewer
                  textFamily={textFamily}
                  textSize={textSize}
                  textColor={textColor}
                  snapEnabled={snapEnabled}
                  onPagesLoaded={setPdfPages}
                />
              ) : (
                <EmptyState onFile={handleOpenFile} onRecentFile={handleSwitchTo} />
              )}
            </main>
            {pdfBytes && pdfPages.length > 1 && (
              <PdfThumbnailRail
                pages={pdfPages}
                onReorder={handleReorderPages}
                onRotatePage={handleRotatePage}
                onDeletePage={handleDeletePage}
              />
            )}
          </div>
        </div>
        <SignatureModal open={sigModalOpen} onOpenChange={setSigModalOpen} />
        <ProfileDialog open={profileDialogOpen} onOpenChange={setProfileDialogOpen} />
        {pdfBytes && pdfPages.length > 1 && (
          <PdfPagesDialog
            pages={pdfPages}
            open={pagesDialogOpen}
            onOpenChange={setPagesDialogOpen}
            onReorder={handleReorderPages}
            onRotatePage={handleRotatePage}
            onDeletePage={handleDeletePage}
          />
        )}
      </div>
    </TooltipProvider>
    </ErrorBoundary>
  )
}
