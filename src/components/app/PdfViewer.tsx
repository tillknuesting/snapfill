import { useCallback, useEffect, useState, type FormEvent } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import { AlertTriangle, Loader2, LockKeyhole } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { usePdfStore } from '@/store/usePdfStore'
import { useT } from '@/utils/useT'
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

interface PasswordRequest {
  reason: number
  submit: (password: string) => void
}

export function PdfViewer({ textFamily, textSize, textColor, snapEnabled, onPagesLoaded }: PdfViewerProps) {
  const t = useT()
  const pdfBytes = usePdfStore((s) => s.pdfBytes)
  const fileName = usePdfStore((s) => s.fileName)
  const setPages = usePdfStore((s) => s.setPages)
  const zoom = usePdfStore((s) => s.zoom)
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [pages, setLocalPages] = useState<PDFPageProxy[]>([])
  const [pageCount, setPageCount] = useState(0)
  const [baseWidth, setBaseWidth] = useState<number>(900)
  const [pageInfos, setPageInfos] = useState<PageInfo[]>([])
  // Surfaced when pdfjs.getDocument rejects (corrupt file, password-protected
  // PDF we can't decrypt, non-PDF dropped through). Without this the user
  // would stare at the loading spinner forever.
  const [loadError, setLoadError] = useState<{ key?: string; message?: string } | null>(null)
  const [passwordRequest, setPasswordRequest] = useState<PasswordRequest | null>(null)
  const [passwordValue, setPasswordValue] = useState('')
  const closePdf = usePdfStore((s) => s.closePdf)
  const containerWidth = baseWidth * zoom

  useEffect(() => {
    // Clear old document state immediately so a stale rail/viewer doesn't
    // flash while the new PDF is parsing.
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      setDoc(null)
      setLocalPages([])
      setPageCount(0)
      setPageInfos([])
      setLoadError(null)
      setPasswordRequest(null)
      setPasswordValue('')
      onPagesLoaded?.([])
    })
    if (!pdfBytes) return () => { cancelled = true }
    const data = pdfBytes.slice()
    const task = pdfjsLib.getDocument({ data })
    task.onPassword = (submit: (password: string) => void, reason: number) => {
      if (cancelled) return
      setPasswordValue('')
      setPasswordRequest({ reason, submit })
    }
    task.promise.then(async (d) => {
      if (cancelled) return
      setPasswordRequest(null)
      setPasswordValue('')
      setDoc(d)
      setPageCount(d.numPages)
      const loaded: PDFPageProxy[] = []
      for (let start = 1; start <= d.numPages && !cancelled;) {
        const batchSize = loaded.length === 0 ? 1 : 4
        const nums = Array.from(
          { length: Math.min(batchSize, d.numPages - start + 1) },
          (_, i) => start + i,
        )
        const batch = await Promise.all(nums.map((n) => d.getPage(n)))
        if (cancelled) return
        loaded.push(...batch)
        start += nums.length
        setLocalPages([...loaded])
        if (loaded.length < d.numPages) {
          await new Promise<void>((resolve) => window.setTimeout(resolve, 0))
        }
      }
      if (!cancelled) onPagesLoaded?.(loaded)
    }).catch((err) => {
      if (cancelled) return
      console.error('PDF load failed', err)
      // Common pdfjs error names map to user-facing messages.
      const e = err as { name?: string; message?: string }
      const message = e?.name === 'PasswordException'
        ? { key: 'pdf.error.password' }
        : e?.name === 'InvalidPDFException'
        ? { key: 'pdf.error.invalid' }
        : (e?.message ? { message: e.message } : { key: 'pdf.error.generic' })
      setLoadError(message)
    })
    return () => {
      cancelled = true
      try { void task.destroy() } catch { /* noop */ }
    }
  }, [pdfBytes, onPagesLoaded])

  const submitPassword = useCallback((event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!passwordRequest || !passwordValue) return
    const submit = passwordRequest.submit
    setPasswordRequest(null)
    submit(passwordValue)
    setPasswordValue('')
  }, [passwordRequest, passwordValue])

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
    if (pageCount === 0) return
    const complete = Array.from(
      { length: pageCount },
      (_, idx) => pageInfos[idx]?.pageIdx === idx,
    ).every(Boolean)
    if (complete) {
      setPages(pageInfos.slice(0, pageCount))
    }
  }, [pageInfos, pageCount, setPages])

  const passwordDialog = (
    <Dialog open={!!passwordRequest} onOpenChange={(open) => {
      if (!open && passwordRequest) closePdf()
    }}>
      <DialogContent showCloseButton={false} className="max-w-sm">
        <form onSubmit={submitPassword} className="space-y-4">
          <DialogHeader>
            <div className="mb-1 flex justify-center sm:justify-start">
              <div className="flex size-10 items-center justify-center rounded-full bg-muted">
                <LockKeyhole className="size-5 text-muted-foreground" aria-hidden="true" />
              </div>
            </div>
            <DialogTitle>{t('pdf.password.title')}</DialogTitle>
            <DialogDescription>
              {passwordRequest?.reason === pdfjsLib.PasswordResponses.INCORRECT_PASSWORD
                ? t('pdf.password.incorrect')
                : t('pdf.password.description')}
            </DialogDescription>
          </DialogHeader>
          {fileName && (
            <div className="truncate rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
              {fileName}
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="pdf-password">{t('pdf.password.label')}</Label>
            <Input
              id="pdf-password"
              type="password"
              value={passwordValue}
              onChange={(event) => setPasswordValue(event.target.value)}
              autoFocus
              autoComplete="current-password"
            />
          </div>
          <DialogFooter className="sm:justify-between">
            <Button type="button" variant="outline" onClick={closePdf}>
              {t('pdf.password.cancel')}
            </Button>
            <Button type="submit" disabled={!passwordValue}>
              {t('pdf.password.unlock')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )

  if (loadError) {
    // Render a recoverable error state instead of leaving the loading
    // spinner up forever. The "Close this PDF" button clears pdfBytes so
    // the empty state comes back and the user can pick another file.
    return (
      <div
        className="flex h-full items-center justify-center"
        role="alert"
        aria-live="assertive"
      >
        <div className="flex flex-col items-center gap-3 px-6 text-center">
          <AlertTriangle className="size-8 text-destructive" aria-hidden="true" />
          <div>
            <div className="text-sm font-medium">{t('pdf.error.title')}</div>
            {fileName && (
              <div className="mt-1 max-w-xs truncate text-xs text-muted-foreground">
                {fileName}
              </div>
            )}
            <div className="mx-auto mt-3 max-w-sm text-sm text-muted-foreground">
              {loadError.key ? t(loadError.key) : loadError.message}
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={closePdf}>
            {t('pdf.close')}
          </Button>
        </div>
        {passwordDialog}
      </div>
    )
  }
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
            <div className="text-sm font-medium">{t('pdf.loading')}</div>
            {fileName && (
              <div className="mt-1 max-w-xs truncate text-xs text-muted-foreground">
                {fileName}
              </div>
            )}
          </div>
        </div>
        {passwordDialog}
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
