import { useCallback, useEffect, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import { Loader2 } from 'lucide-react'
import { usePdfStore } from '@/store/usePdfStore'
import { PdfPage } from './PdfPage'
import type { FontFamily, PageInfo } from '@/types'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc

interface PdfViewerProps {
  textFamily: FontFamily
  textSize: number
  textColor: string
  snapEnabled: boolean
  // Bubble the loaded pages to the parent so a sibling thumbnail rail can
  // render previews without re-loading the document.
  onPagesLoaded?: (pages: PDFPageProxy[]) => void
}

export function PdfViewer({ textFamily, textSize, textColor, snapEnabled, onPagesLoaded }: PdfViewerProps) {
  const pdfBytes = usePdfStore((s) => s.pdfBytes)
  const fileName = usePdfStore((s) => s.fileName)
  const setPages = usePdfStore((s) => s.setPages)
  const zoom = usePdfStore((s) => s.zoom)
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [pages, setLocalPages] = useState<PDFPageProxy[]>([])
  const [baseWidth, setBaseWidth] = useState<number>(900)
  const [pageInfos, setPageInfos] = useState<PageInfo[]>([])
  const containerWidth = baseWidth * zoom

  useEffect(() => {
    // Clear old document state immediately so a stale rail/viewer doesn't
    // flash while the new PDF is parsing.
    setDoc(null)
    setLocalPages([])
    onPagesLoaded?.([])
    if (!pdfBytes) return
    let cancelled = false
    const data = pdfBytes.slice()
    const task = pdfjsLib.getDocument({ data })
    task.promise.then(async (d) => {
      if (cancelled) return
      setDoc(d)
      // Fan out the page-proxy fetches so a 100-page document doesn't
      // serialise 100 round-trips before any page can render. Each call is
      // cheap on its own; pdfjs's worker handles them in parallel.
      const ps = await Promise.all(
        Array.from({ length: d.numPages }, (_, i) => d.getPage(i + 1)),
      )
      if (!cancelled) {
        setLocalPages(ps)
        onPagesLoaded?.(ps)
      }
    }).catch((err) => {
      console.error('PDF load failed', err)
    })
    return () => { cancelled = true }
  }, [pdfBytes, onPagesLoaded])

  useEffect(() => {
    function update() {
      const main = document.getElementById('pdf-main')
      if (main) setBaseWidth(Math.min(900, main.clientWidth - 48))
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [doc])

  const handlePageInfo = useCallback((info: PageInfo) => {
    setPageInfos((prev) => {
      const next = [...prev]
      next[info.pageIdx] = info
      return next
    })
  }, [])

  useEffect(() => {
    if (pageInfos.length === pages.length && pages.length > 0) {
      setPages(pageInfos)
    }
  }, [pageInfos, pages.length, setPages])

  if (!doc || pages.length === 0) {
    // Big PDFs (50MB+) take a moment to parse; show a centred spinner with
    // the filename so the user knows we haven't crashed.
    return (
      <div
        className="flex h-full items-center justify-center"
        role="status"
        aria-live="polite"
      >
        <div className="flex flex-col items-center gap-3 px-6 text-center">
          <Loader2 className="size-8 animate-spin text-primary" aria-hidden="true" />
          <div>
            <div className="text-sm font-medium">Loading PDF…</div>
            {fileName && (
              <div className="mt-1 max-w-xs truncate text-xs text-muted-foreground">
                {fileName}
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-4 p-6">
      {pages.map((p, idx) => (
        <PdfPage
          key={idx}
          page={p}
          pageIdx={idx}
          cssWidth={containerWidth}
          textFamily={textFamily}
          textSize={textSize}
          textColor={textColor}
          snapEnabled={snapEnabled}
          onPageInfo={handlePageInfo}
        />
      ))}
    </div>
  )
}
