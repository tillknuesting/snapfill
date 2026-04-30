import { useCallback, useEffect, useRef, useState } from 'react'
import { Toolbar } from '@/components/app/Toolbar'
import { ModeBanner } from '@/components/app/ModeBanner'
import { ErrorBoundary } from '@/components/app/ErrorBoundary'
import { Onboarding } from '@/components/app/Onboarding'
import { isRTL } from '@/utils/i18n'
import { PdfViewer } from '@/components/app/PdfViewer'
import { PdfThumbnailRail } from '@/components/app/PdfThumbnailRail'
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
import type { PDFPageProxy } from 'pdfjs-dist'
import type { Annotation, FontFamily } from '@/types'

const AUTO_SAVE_DEBOUNCE_MS = 800

export default function App() {
  const {
    pdfBytes, fileName, recentId, mode, setMode, setPdf, loadFromRecent, mergeIntoPdf, reorderPages,
    annotations, pages, formFieldEdits,
    selectedId, setSelectedId, removeAnnotation, undo, redo,
    setPendingTextValue, setPendingDateMs,
  } = usePdfStore()

  const [textFamily, setTextFamily] = useState<FontFamily>('helvetica')
  const [textSize, setTextSize] = useState(14)
  const [textColor, setTextColor] = useState('#0a1f3d')
  const [snapEnabled, setSnapEnabled] = useState(true)
  const [sigModalOpen, setSigModalOpen] = useState(false)
  const [profileDialogOpen, setProfileDialogOpen] = useState(false)
  const [recentRefreshKey, setRecentRefreshKey] = useState(0)
  const [pdfPages, setPdfPages] = useState<PDFPageProxy[]>([])

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
    const buf = await file.arrayBuffer()
    const bytes = new Uint8Array(buf)
    const id = await addRecentFile(file.name, bytes)
    // Try loading saved annotations for this file (if it's a duplicate of one
    // we've seen before, we restore the user's previous edits).
    const saved = id ? await loadRecentFileFull(id) : null
    if (saved) {
      loadFromRecent(saved.bytes, saved.name, saved.id, saved.annotations, saved.formFieldEdits)
    } else {
      setPdf(bytes, file.name, id || null)
    }
    setRecentRefreshKey((k) => k + 1)
  }, [setPdf, loadFromRecent])

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
      alert('Could not merge PDF: ' + (err as Error).message)
    }
  }, [pdfBytes, recentId, mergeIntoPdf])

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
      alert('Could not reorder pages: ' + (err as Error).message)
    }
  }, [pdfBytes, recentId, reorderPages])

  const handleSwitchTo = useCallback(async (id: string) => {
    const rec = await loadRecentFileFull(id)
    if (!rec) return
    loadFromRecent(rec.bytes, rec.name, rec.id, rec.annotations, rec.formFieldEdits)
    setRecentRefreshKey((k) => k + 1)
  }, [loadFromRecent])

  const pickFile = useCallback(() => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/pdf'
    input.onchange = () => { if (input.files?.[0]) handleOpenFile(input.files[0]) }
    input.click()
  }, [handleOpenFile])

  // Auto-save: debounce annotation / form-field changes and persist to IDB.
  const lastSavedRef = useRef<{ id: string; ann: Annotation[]; ff: Map<string, string | boolean> } | null>(null)
  useEffect(() => {
    if (!recentId) return
    // Skip the initial call right after loadFromRecent (lastSavedRef matches).
    const last = lastSavedRef.current
    if (last && last.id === recentId && last.ann === annotations && last.ff === formFieldEdits) return
    const timer = setTimeout(() => {
      // Image annotations are deliberately session-only — strip before persist.
      // They live in memory and download fine, but they don't follow the PDF
      // across reloads or browser sessions.
      const persisted = annotations.filter((a) => a.type !== 'image')
      updateRecentFile(recentId, {
        annotations: persisted,
        formFieldEdits: Array.from(formFieldEdits.entries()),
      }).catch(() => {})
      lastSavedRef.current = { id: recentId, ann: annotations, ff: formFieldEdits }
    }, AUTO_SAVE_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [recentId, annotations, formFieldEdits])

  const handleDownload = useCallback(async (
    opts: { compress?: boolean; quality?: 'small' | 'balanced' | 'sharp' } = {},
  ) => {
    if (!pdfBytes) return
    const { compress = false, quality = 'balanced' } = opts
    // Lazy-load buildPdf and its heavy deps (pdf-lib + fontkit) — they're
    // only needed at download time, so they shouldn't be in the initial bundle.
    const { buildPdf } = await import('@/utils/buildPdf')

    function triggerDownload(out: Uint8Array) {
      const blob = new Blob([out as BlobPart], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName.replace(/\.pdf$/i, '') + '-filled.pdf' || 'filled.pdf'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    }

    // "Make PDF smaller": re-render each page off-screen at a target DPI
    // (independent of the user's zoom + devicePixelRatio) and embed as
    // JPEG. This trades selectable text + form-widget editability for a
    // predictable size reduction. The DPI presets:
    //   - small    — 96  DPI, JPEG q=0.6  (typical 8-12× shrink on scans)
    //   - balanced — 150 DPI, JPEG q=0.75 (good for printing/sharing)
    //   - sharp    — 200 DPI, JPEG q=0.85 (still smaller, near-lossless)
    // Pages render serially (not Promise.all) so a 100-page doc doesn't
    // OOM the browser.
    const QUALITY_PRESETS = {
      small:    { dpi: 96,  jpeg: 0.6 },
      balanced: { dpi: 150, jpeg: 0.75 },
      sharp:    { dpi: 200, jpeg: 0.85 },
    } as const
    if (compress) {
      if (pdfPages.length === 0) {
        alert('PDF is still loading; please wait and try again.')
        return
      }
      try {
        const preset = QUALITY_PRESETS[quality]
        const scale = preset.dpi / 72
        const pageImages: string[] = []
        for (const page of pdfPages) {
          const vp = page.getViewport({ scale })
          const canvas = document.createElement('canvas')
          canvas.width = Math.floor(vp.width)
          canvas.height = Math.floor(vp.height)
          const ctx = canvas.getContext('2d')
          if (!ctx) throw new Error('Could not allocate canvas context')
          await page.render({ canvasContext: ctx, viewport: vp, canvas }).promise
          pageImages.push(canvas.toDataURL('image/jpeg', preset.jpeg))
        }
        const out = await buildPdf({ pdfBytes, annotations, pages, formFieldEdits, pageImages })
        triggerDownload(out)
        return
      } catch (err) {
        console.error('compressed download failed', err)
        alert('Could not build compressed PDF: ' + (err as Error).message)
        return
      }
    }

    try {
      const out = await buildPdf({ pdfBytes, annotations, pages, formFieldEdits })
      triggerDownload(out)
    } catch (err) {
      console.warn('strict buildPdf failed, falling back to raster:', err)
      // Some real-world PDFs (encrypted-flagged government forms with
      // unusual cross-reference structures) defeat pdf-lib's parser. We
      // render each page from the canvases that pdf.js already painted
      // into the DOM and embed those as images in a fresh PDF. Annotations
      // are then drawn on top. Form-widget edits are dropped in this mode
      // — the user can still annotate, sign, and download.
      try {
        const pageImages: string[] = []
        for (let i = 0; i < pages.length; i++) {
          const c = document.querySelector<HTMLCanvasElement>(
            `[data-page-idx="${i}"] canvas`,
          )
          if (!c) throw new Error(`page ${i + 1} canvas not rendered`)
          pageImages.push(c.toDataURL('image/png'))
        }
        const out = await buildPdf({ pdfBytes, annotations, pages, formFieldEdits, pageImages })
        triggerDownload(out)
      } catch (err2) {
        console.error(err2)
        alert('Could not build PDF: ' + (err2 as Error).message)
      }
    }
  }, [pdfBytes, annotations, pages, formFieldEdits, fileName, pdfPages])

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
    <ErrorBoundary>
    <TooltipProvider>
      <Onboarding />
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
              onDownload={handleDownload}
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
                <EmptyState onFile={handleOpenFile} />
              )}
            </main>
            {pdfBytes && pdfPages.length > 1 && (
              <PdfThumbnailRail pages={pdfPages} onReorder={handleReorderPages} />
            )}
          </div>
        </div>
        <SignatureModal open={sigModalOpen} onOpenChange={setSigModalOpen} />
        <ProfileDialog open={profileDialogOpen} onOpenChange={setProfileDialogOpen} />
      </div>
    </TooltipProvider>
    </ErrorBoundary>
  )
}
