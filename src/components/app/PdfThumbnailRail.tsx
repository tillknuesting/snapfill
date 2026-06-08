import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { PDFPageProxy, RenderTask } from 'pdfjs-dist'
import { ArrowDown, ArrowUp, GripVertical, RotateCcw, RotateCw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useT } from '@/utils/useT'

type RotateDirection = 'cw' | 'ccw'

interface PdfThumbnailRailProps {
  pages: PDFPageProxy[]
  // Called when the user drops a page into a new position. The handler
  // receives a permutation array where `newOrder[newIdx] = oldIdx`.
  onReorder?: (newOrder: number[]) => void
  onRotatePage?: (pageIdx: number, direction: RotateDirection) => void
  onDeletePage?: (pageIdx: number) => void
}

const THUMB_WIDTH = 96  // CSS px
const DIALOG_THUMB_WIDTH = 72

/**
 * Right-side strip of small page previews. Each one lazy-renders via
 * IntersectionObserver and scrolls the corresponding PdfPage into view on
 * click. The "active" highlight tracks whichever PdfPage is most in view in
 * the main scroll container. Thumbnails are drag-sortable: the user can
 * reorder pages of the open document by dragging a thumb between others.
 */
export function PdfThumbnailRail({ pages, onReorder, onRotatePage, onDeletePage }: PdfThumbnailRailProps) {
  const t = useT()
  const [activeIdx, setActiveIdx] = useState(0)
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null)
  const [revealedActionIdx, setRevealedActionIdx] = useState<number | null>(null)
  const [pendingDeleteIdx, setPendingDeleteIdx] = useState<number | null>(null)
  const visibleAreasRef = useRef<Map<number, number>>(new Map())
  // dropIdx is the *gap* index — 0 means "before page 0", N means "after the
  // last page". Indices in between mean "between page (dropIdx - 1) and page
  // dropIdx". We compute it from the dragover position relative to each
  // thumb's vertical midpoint.
  const [dropIdx, setDropIdx] = useState<number | null>(null)

  // Observe all rendered PdfPage wrappers — they have `data-page-idx="N"`.
  // The page with the largest visible area becomes the highlighted one.
  // We deliberately exclude `activeIdx` from the deps (using the functional
  // setState form below) so the observer is created once per pages array,
  // not torn down + rearmed every time the user scrolls between pages.
  useEffect(() => {
    if (pages.length === 0) return
    const visibleAreas = visibleAreasRef.current
    visibleAreas.clear()
    const obs = new IntersectionObserver(
      (entries) => {
        const areas = visibleAreas
        for (const entry of entries) {
          const el = entry.target as HTMLElement
          const idx = Number(el.dataset.pageIdx)
          if (!Number.isFinite(idx)) continue
          if (!entry.isIntersecting) {
            areas.delete(idx)
            continue
          }
          areas.set(idx, entry.intersectionRect.width * entry.intersectionRect.height)
        }
        let best = -1
        let bestArea = -1
        areas.forEach((area, idx) => {
          if (area > bestArea) {
            bestArea = area
            best = idx
          }
        })
        if (best >= 0) setActiveIdx((prev) => (prev === best ? prev : best))
      },
      { threshold: [0, 0.25, 0.5, 0.75, 1] },
    )
    const armTimer = setInterval(() => {
      const els = document.querySelectorAll('[data-page-idx]')
      if (els.length > 0) {
        els.forEach((el) => obs.observe(el))
        clearInterval(armTimer)
      }
    }, 50)
    return () => {
      clearInterval(armTimer)
      obs.disconnect()
      visibleAreas.clear()
    }
  }, [pages.length])

  function commitDrop() {
    if (draggingIdx == null || dropIdx == null || !onReorder) return
    // Convert (sourceIdx, gapIdx) into a permutation. Pull the source out of
    // the order, then splice it back in at the gap. If the gap is below the
    // source's old position, the gap index shifts by -1 to account for the
    // earlier removal.
    const src = draggingIdx
    let dst = dropIdx
    if (dst > src) dst -= 1
    if (dst === src) return
    const order = Array.from({ length: pages.length }, (_, i) => i)
    const [moved] = order.splice(src, 1)
    order.splice(dst, 0, moved)
    setRevealedActionIdx(null)
    onReorder(order)
  }

  if (pages.length <= 1) return null
  return (
    <>
      <aside
        className="frosted hidden w-[128px] shrink-0 overflow-y-auto border-l py-3 lg:block"
        aria-label={t('pages.thumbnails')}
      >
        <ul
          className="flex flex-col items-center gap-3 px-2"
          onDragOver={(e) => {
            // Allow drops on the gap *after* the last thumb too. Compute the
            // closest gap: scan thumbs and pick the one whose midpoint is
            // furthest above the cursor, then snap to the gap below it.
            if (draggingIdx == null) return
            e.preventDefault()
          }}
        >
          {pages.map((p, idx) => (
            <Thumb
              key={idx}
              page={p}
              pageIdx={idx}
              active={idx === activeIdx}
              isDragging={idx === draggingIdx}
              // Show a top-edge indicator when dropIdx points at this thumb's
              // top, and a bottom-edge indicator on the last thumb when dropIdx
              // is at the very end.
              showDropAbove={dropIdx === idx && draggingIdx !== idx && draggingIdx !== idx - 1}
              showDropBelow={
                idx === pages.length - 1 && dropIdx === pages.length &&
                draggingIdx !== idx
              }
              draggable={!!onReorder}
              actionsRevealed={idx === revealedActionIdx}
              onRotatePage={onRotatePage}
              onRequestDelete={onDeletePage ? () => setPendingDeleteIdx(idx) : undefined}
              onRevealActions={() => setRevealedActionIdx(idx)}
              onClearActions={() => {
                setRevealedActionIdx((cur) => (cur === idx ? null : cur))
              }}
              onDragStart={() => {
                setRevealedActionIdx(null)
                setDraggingIdx(idx)
              }}
              onDragEnter={() => {
                if (draggingIdx == null) return
                // Hovering over thumb `idx` means "move source past me"
                // (if source was above) or "move source to my slot" (if
                // source was below). This is more intuitive than the
                // midpoint-of-target gap rule, which on a 2-page doc made
                // dropping on thumb 1's top half a no-op even though the
                // user clearly meant "swap them". Same rule scales to any
                // list size: dragging a thumb onto another always reorders.
                const next = draggingIdx < idx ? idx + 1 : idx
                setDropIdx(next)
              }}
              onDragOver={(e) => {
                if (draggingIdx == null) return
                e.preventDefault()
                const next = draggingIdx < idx ? idx + 1 : idx
                setDropIdx((cur) => (cur === next ? cur : next))
              }}
              onDrop={(e) => {
                e.preventDefault()
                commitDrop()
                setDraggingIdx(null)
                setDropIdx(null)
              }}
              onDragEnd={() => {
                setDraggingIdx(null)
                setDropIdx(null)
              }}
            />
          ))}
        </ul>
      </aside>
      <DeletePageConfirmDialog
        pageIdx={pendingDeleteIdx}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteIdx(null)
        }}
        onConfirm={(pageIdx) => {
          setPendingDeleteIdx(null)
          onDeletePage?.(pageIdx)
        }}
      />
    </>
  )
}

interface PdfPagesDialogProps {
  pages: PDFPageProxy[]
  open: boolean
  onOpenChange: (open: boolean) => void
  onReorder?: (newOrder: number[]) => void
  onRotatePage?: (pageIdx: number, direction: RotateDirection) => void
  onDeletePage?: (pageIdx: number) => void
}

export function PdfPagesDialog({ pages, open, onOpenChange, onReorder, onRotatePage, onDeletePage }: PdfPagesDialogProps) {
  const t = useT()
  const [pendingOrder, setPendingOrder] = useState<number[]>([])
  const [pendingDeleteIdx, setPendingDeleteIdx] = useState<number | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      setPendingOrder(Array.from({ length: pages.length }, (_, i) => i))
    })
    return () => { cancelled = true }
  }, [open, pages.length])

  if (pages.length <= 1) return null

  const order = pendingOrder.length === pages.length
    ? pendingOrder
    : Array.from({ length: pages.length }, (_, i) => i)
  const changed = order.some((oldIdx, newIdx) => oldIdx !== newIdx)

  function move(rowIdx: number, delta: -1 | 1) {
    setPendingOrder((cur) => {
      const next = cur.length === pages.length
        ? [...cur]
        : Array.from({ length: pages.length }, (_, i) => i)
      const swapIdx = rowIdx + delta
      if (swapIdx < 0 || swapIdx >= next.length) return next
      ;[next[rowIdx], next[swapIdx]] = [next[swapIdx], next[rowIdx]]
      return next
    })
  }

  function jumpTo(pageIdx: number) {
    const target = document.querySelector<HTMLElement>(`[data-page-idx="${pageIdx}"]`)
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    onOpenChange(false)
  }

  function applyOrder() {
    if (changed && onReorder) onReorder(order)
    onOpenChange(false)
  }

  function rotate(oldIdx: number, direction: RotateDirection) {
    onRotatePage?.(oldIdx, direction)
  }

  function deletePage(oldIdx: number) {
    setPendingDeleteIdx(oldIdx)
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          className="bottom-0 left-0 top-auto max-h-[85vh] max-w-none translate-x-0 translate-y-0 rounded-b-none border-x-0 border-b-0 p-0 sm:left-[50%] sm:top-[50%] sm:max-w-lg sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-lg sm:border sm:p-0"
        >
          <div className="grid max-h-[85vh] grid-rows-[auto_minmax(0,1fr)_auto]">
            <DialogHeader className="px-4 pb-2 pt-4 text-left">
              <DialogTitle>{t('pages.title')}</DialogTitle>
              <DialogDescription>{t('pages.description')}</DialogDescription>
            </DialogHeader>
            <div className="min-h-0 overflow-y-auto px-4 pb-4">
              <ol className="space-y-2">
                {order.map((oldIdx, rowIdx) => (
                  <li
                    key={oldIdx}
                    className="flex items-center gap-2 rounded-md border bg-card p-2"
                  >
                    <button
                      type="button"
                      onClick={() => jumpTo(oldIdx)}
                      aria-label={`${t('pages.view_page')} ${oldIdx + 1}`}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      <PageDialogPreview page={pages[oldIdx]} />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">
                          {t('pages.page')} {oldIdx + 1}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {rowIdx + 1} / {pages.length}
                        </span>
                      </span>
                    </button>
                    <div className="flex shrink-0 gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={`${t('pages.rotate_ccw')} ${oldIdx + 1}`}
                        onClick={() => rotate(oldIdx, 'ccw')}
                        className="h-9 w-9 p-0"
                      >
                        <RotateCcw className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={`${t('pages.rotate_cw')} ${oldIdx + 1}`}
                        onClick={() => rotate(oldIdx, 'cw')}
                        className="h-9 w-9 p-0"
                      >
                        <RotateCw className="size-4" />
                      </Button>
                      {onDeletePage && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          aria-label={`${t('pages.delete')} ${oldIdx + 1}`}
                          onClick={() => deletePage(oldIdx)}
                          className="h-9 w-9 p-0 text-destructive hover:text-destructive"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={rowIdx === 0}
                        aria-label={`${t('pages.move_up')} ${oldIdx + 1}`}
                        onClick={() => move(rowIdx, -1)}
                        className="h-9 w-9 p-0"
                      >
                        <ArrowUp className="size-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={rowIdx === order.length - 1}
                        aria-label={`${t('pages.move_down')} ${oldIdx + 1}`}
                        onClick={() => move(rowIdx, 1)}
                        className="h-9 w-9 p-0"
                      >
                        <ArrowDown className="size-4" />
                      </Button>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
            <DialogFooter className="border-t px-4 py-3 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t('pages.close')}
              </Button>
              <Button type="button" disabled={!changed} onClick={applyOrder}>
                {t('pages.apply')}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
      <DeletePageConfirmDialog
        pageIdx={pendingDeleteIdx}
        onOpenChange={(nextOpen) => {
          if (!nextOpen) setPendingDeleteIdx(null)
        }}
        onConfirm={(pageIdx) => {
          setPendingDeleteIdx(null)
          onOpenChange(false)
          onDeletePage?.(pageIdx)
        }}
      />
    </>
  )
}

interface ThumbProps {
  page: PDFPageProxy
  pageIdx: number
  active: boolean
  isDragging: boolean
  showDropAbove: boolean
  showDropBelow: boolean
  draggable: boolean
  onDragStart: () => void
  onDragEnter: (e: React.DragEvent<HTMLLIElement>) => void
  onDragOver: (e: React.DragEvent<HTMLLIElement>) => void
  onDrop: (e: React.DragEvent<HTMLLIElement>) => void
  onDragEnd: () => void
  actionsRevealed: boolean
  onRotatePage?: (pageIdx: number, direction: RotateDirection) => void
  onRequestDelete?: () => void
  onRevealActions: () => void
  onClearActions: () => void
}

function PageDialogPreview({ page }: { page: PDFPageProxy }) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isVisible, setIsVisible] = useState(false)
  const dims = useMemo(() => {
    const baseVp = page.getViewport({ scale: 1 })
    const scale = DIALOG_THUMB_WIDTH / baseVp.width
    const vp = page.getViewport({ scale })
    return { width: vp.width, height: vp.height }
  }, [page])

  useEffect(() => {
    if (!wrapperRef.current || isVisible) return
    const obs = new IntersectionObserver(
      (entries) => { for (const e of entries) if (e.isIntersecting) { setIsVisible(true); break } },
      { rootMargin: '200px 0px' },
    )
    obs.observe(wrapperRef.current)
    return () => obs.disconnect()
  }, [isVisible])

  useEffect(() => {
    if (!isVisible || !canvasRef.current) return
    let cancelled = false
    let task: RenderTask | null = null
    ;(async () => {
      const canvas = canvasRef.current
      if (!canvas || cancelled) return
      const dpr = window.devicePixelRatio || 1
      const baseVp = page.getViewport({ scale: 1 })
      const vp = page.getViewport({ scale: DIALOG_THUMB_WIDTH / baseVp.width })
      canvas.width = Math.floor(vp.width * dpr)
      canvas.height = Math.floor(vp.height * dpr)
      canvas.style.width = vp.width + 'px'
      canvas.style.height = vp.height + 'px'
      const ctx = canvas.getContext('2d')!
      ctx.scale(dpr, dpr)
      task = page.render({ canvasContext: ctx, viewport: vp, canvas })
      try { await task.promise } catch { /* cancelled */ }
    })()
    return () => {
      cancelled = true
      try { task?.cancel() } catch { /* noop */ }
    }
  }, [isVisible, page])

  return (
    <span
      ref={wrapperRef}
      className="block shrink-0 rounded border bg-white shadow-sm"
      style={{ width: dims.width, height: dims.height }}
      aria-hidden="true"
    >
      <canvas ref={canvasRef} className="block rounded" />
    </span>
  )
}

function Thumb({
  page, pageIdx, active, isDragging, showDropAbove, showDropBelow,
  draggable, onDragStart, onDragEnter, onDragOver, onDrop, onDragEnd,
  actionsRevealed, onRotatePage, onRequestDelete, onRevealActions, onClearActions,
}: ThumbProps) {
  const t = useT()
  const wrapperRef = useRef<HTMLLIElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [isVisible, setIsVisible] = useState(false)

  // Compute viewport dims synchronously — they're a pure function of `page`
  // and the THUMB_WIDTH constant, so useMemo is the right primitive (no
  // setState-in-effect cascade). Used to size the placeholder so the rail
  // doesn't reflow when the canvas finally paints.
  const dims = useMemo(() => {
    const baseVp = page.getViewport({ scale: 1 })
    const scale = THUMB_WIDTH / baseVp.width
    const vp = page.getViewport({ scale })
    return { width: vp.width, height: vp.height }
  }, [page])

  useEffect(() => {
    if (!wrapperRef.current || isVisible) return
    const obs = new IntersectionObserver(
      (entries) => { for (const e of entries) if (e.isIntersecting) { setIsVisible(true); break } },
      // Pre-render thumbnails within one rail-height of the viewport.
      { rootMargin: '300px 0px' },
    )
    obs.observe(wrapperRef.current)
    return () => obs.disconnect()
  }, [isVisible])

  useEffect(() => {
    if (!isVisible || !canvasRef.current || !dims) return
    let cancelled = false
    let task: RenderTask | null = null
    ;(async () => {
      const canvas = canvasRef.current
      if (!canvas || cancelled) return
      const dpr = window.devicePixelRatio || 1
      const baseVp = page.getViewport({ scale: 1 })
      const vp = page.getViewport({ scale: THUMB_WIDTH / baseVp.width })
      canvas.width = Math.floor(vp.width * dpr)
      canvas.height = Math.floor(vp.height * dpr)
      canvas.style.width = vp.width + 'px'
      canvas.style.height = vp.height + 'px'
      const ctx = canvas.getContext('2d')!
      ctx.scale(dpr, dpr)
      task = page.render({ canvasContext: ctx, viewport: vp, canvas })
      try { await task.promise } catch { /* cancelled */ }
    })()
    return () => {
      cancelled = true
      try { task?.cancel() } catch { /* noop */ }
    }
  }, [isVisible, page, dims])

  const hasActions = !!(onRotatePage || onRequestDelete)

  function jumpTo() {
    onClearActions()
    const target = document.querySelector<HTMLElement>(`[data-page-idx="${pageIdx}"]`)
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  function handleViewPageClick(e: React.MouseEvent<HTMLButtonElement>) {
    const pointerType = (e.nativeEvent as MouseEvent & { pointerType?: string }).pointerType
    const touchOnlyDevice =
      typeof navigator !== 'undefined' &&
      navigator.maxTouchPoints > 0 &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(hover: none)').matches
    if (hasActions && !actionsRevealed && (pointerType === 'touch' || touchOnlyDevice)) {
      e.preventDefault()
      e.stopPropagation()
      onRevealActions()
      return
    }
    jumpTo()
  }

  function revealActionsOnTouch(e: React.PointerEvent<HTMLDivElement>) {
    if (!hasActions || actionsRevealed || e.pointerType === 'mouse') return
    e.preventDefault()
    e.stopPropagation()
    onRevealActions()
  }

  return (
    <li
      ref={wrapperRef}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className={cn(
        'group relative flex w-full flex-col items-center gap-1 transition-opacity',
        isDragging && 'opacity-40',
      )}
    >
      {/* Drop indicators: thin primary-coloured line above (and on the last
          thumb, below). Sits at the gap between thumbs to telegraph where
          the dropped page will land. */}
      {showDropAbove && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -top-2 left-1 right-1 h-0.5 rounded bg-primary"
        />
      )}
      {showDropBelow && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-2 left-1 right-1 h-0.5 rounded bg-primary"
        />
      )}
      <div
        className="relative"
        onPointerDownCapture={revealActionsOnTouch}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClearActions()
        }}
        style={{ width: dims?.width ?? THUMB_WIDTH, height: dims?.height ?? THUMB_WIDTH * 1.4 }}
      >
        <button
          type="button"
          onClick={handleViewPageClick}
          aria-label={`${t('pages.view_page')} ${pageIdx + 1}`}
          aria-current={active ? 'page' : undefined}
          className={cn(
            'block h-full w-full overflow-hidden rounded-md border bg-white shadow transition-colors',
            active ? 'ring-2 ring-primary shadow-lg shadow-primary/20' : 'hover:border-primary/50',
          )}
        >
          <canvas ref={canvasRef} className="block rounded-md" />
        </button>
        <div className="pointer-events-none absolute inset-0 rounded-md">
          <span
            className={cn(
              'absolute bottom-1 left-1 flex h-5 min-w-5 items-center gap-0.5 rounded border bg-background/95 px-1 font-mono text-[10px] tabular-nums shadow-sm backdrop-blur',
              active ? 'border-primary text-primary' : 'border-border text-muted-foreground',
            )}
            aria-hidden="true"
          >
            {draggable && (
              <GripVertical
                className="size-3 cursor-grab opacity-60 active:cursor-grabbing"
                aria-hidden="true"
              />
            )}
            {pageIdx + 1}
          </span>
          {(onRotatePage || onRequestDelete) && (
            <div
              data-testid="page-thumbnail-actions"
              data-page-actions-idx={pageIdx}
              data-actions-revealed={actionsRevealed ? 'true' : 'false'}
              className={cn(
                'pointer-events-none absolute right-1 top-1 flex items-center gap-0.5 rounded-md border bg-background/95 p-0.5 opacity-0 shadow-sm backdrop-blur transition-opacity',
                'group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100',
                actionsRevealed && 'pointer-events-auto opacity-100',
              )}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onDragStart={(e) => e.stopPropagation()}
            >
              {onRotatePage && (
                <>
                  <ThumbnailAction
                    label={`${t('pages.rotate_ccw')} ${pageIdx + 1}`}
                    onClick={() => {
                      onClearActions()
                      onRotatePage(pageIdx, 'ccw')
                    }}
                  >
                    <RotateCcw className="size-3.5" />
                  </ThumbnailAction>
                  <ThumbnailAction
                    label={`${t('pages.rotate_cw')} ${pageIdx + 1}`}
                    onClick={() => {
                      onClearActions()
                      onRotatePage(pageIdx, 'cw')
                    }}
                  >
                    <RotateCw className="size-3.5" />
                  </ThumbnailAction>
                </>
              )}
              {onRequestDelete && (
                <ThumbnailAction
                  label={`${t('pages.delete')} ${pageIdx + 1}`}
                  onClick={() => {
                    onClearActions()
                    onRequestDelete()
                  }}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </ThumbnailAction>
              )}
            </div>
          )}
        </div>
      </div>
    </li>
  )
}

function ThumbnailAction({
  label,
  onClick,
  className,
  children,
}: {
  label: string
  onClick: () => void
  className?: string
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={label}
          title={label}
          draggable={false}
          onClick={(e) => {
            e.stopPropagation()
            onClick()
          }}
          className={cn('bg-background/80 p-0 hover:bg-accent', className)}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="left">{label}</TooltipContent>
    </Tooltip>
  )
}

function DeletePageConfirmDialog({
  pageIdx,
  onOpenChange,
  onConfirm,
}: {
  pageIdx: number | null
  onOpenChange: (open: boolean) => void
  onConfirm: (pageIdx: number) => void
}) {
  const t = useT()
  const open = pageIdx != null
  const pageNumber = pageIdx == null ? '' : String(pageIdx + 1)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="max-w-sm gap-0 overflow-hidden p-0">
        <div className="flex items-start gap-3 border-b px-4 py-4">
          <span
            className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md bg-destructive/10 text-destructive"
            aria-hidden="true"
          >
            <Trash2 className="size-4" />
          </span>
          <DialogHeader className="gap-1 text-left">
            <DialogTitle>{t('pages.delete_title').replace('{page}', pageNumber)}</DialogTitle>
            <DialogDescription>{t('pages.delete_confirm')}</DialogDescription>
          </DialogHeader>
        </div>
        <DialogFooter className="px-4 py-3 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" autoFocus onClick={() => onOpenChange(false)}>
            {t('pages.delete_cancel')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              if (pageIdx == null) return
              onConfirm(pageIdx)
            }}
          >
            {t('pages.delete_action')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
