import { useEffect, useMemo, useRef, useState } from 'react'
import type { PDFPageProxy, RenderTask } from 'pdfjs-dist'
import { GripVertical } from 'lucide-react'
import { cn } from '@/lib/utils'

interface PdfThumbnailRailProps {
  pages: PDFPageProxy[]
  // Called when the user drops a page into a new position. The handler
  // receives a permutation array where `newOrder[newIdx] = oldIdx`.
  onReorder?: (newOrder: number[]) => void
}

const THUMB_WIDTH = 96  // CSS px

/**
 * Right-side strip of small page previews. Each one lazy-renders via
 * IntersectionObserver and scrolls the corresponding PdfPage into view on
 * click. The "active" highlight tracks whichever PdfPage is most in view in
 * the main scroll container. Thumbnails are drag-sortable: the user can
 * reorder pages of the open document by dragging a thumb between others.
 */
export function PdfThumbnailRail({ pages, onReorder }: PdfThumbnailRailProps) {
  const [activeIdx, setActiveIdx] = useState(0)
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null)
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
    const obs = new IntersectionObserver(
      () => {
        let best = -1
        let bestArea = -1
        document.querySelectorAll<HTMLElement>('[data-page-idx]').forEach((el) => {
          const r = el.getBoundingClientRect()
          const top = Math.max(0, r.top)
          const bottom = Math.min(window.innerHeight, r.bottom)
          const visible = Math.max(0, bottom - top)
          if (visible > bestArea) {
            bestArea = visible
            best = parseInt(el.dataset.pageIdx ?? '0', 10)
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
    return () => { clearInterval(armTimer); obs.disconnect() }
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
    onReorder(order)
  }

  if (pages.length <= 1) return null
  return (
    <aside
      className="frosted hidden w-[128px] shrink-0 overflow-y-auto border-l py-3 lg:block"
      aria-label="Page thumbnails"
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
            onDragStart={() => setDraggingIdx(idx)}
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
}

function Thumb({
  page, pageIdx, active, isDragging, showDropAbove, showDropBelow,
  draggable, onDragStart, onDragEnter, onDragOver, onDrop, onDragEnd,
}: ThumbProps) {
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

  function jumpTo() {
    const target = document.querySelector<HTMLElement>(`[data-page-idx="${pageIdx}"]`)
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' })
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
      <button
        type="button"
        onClick={jumpTo}
        aria-label={`Go to page ${pageIdx + 1}`}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'block rounded-md border bg-white shadow transition-all hover:scale-[1.03]',
          active ? 'ring-2 ring-primary shadow-lg shadow-primary/20' : 'hover:border-primary/50',
        )}
        style={{ width: dims?.width ?? THUMB_WIDTH, height: dims?.height ?? THUMB_WIDTH * 1.4 }}
      >
        <canvas ref={canvasRef} className="block rounded-md" />
      </button>
      <span
        className={cn(
          'flex items-center gap-1 font-mono text-[10px] tabular-nums',
          active ? 'text-primary' : 'text-muted-foreground',
        )}
        aria-hidden="true"
      >
        {draggable && (
          <GripVertical
            className="size-3 cursor-grab opacity-40 transition-opacity group-hover:opacity-80 active:cursor-grabbing"
            aria-hidden="true"
          />
        )}
        {pageIdx + 1}
      </span>
    </li>
  )
}
