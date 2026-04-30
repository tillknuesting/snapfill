import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { usePdfStore } from '@/store/usePdfStore'
import { FONT_FAMILIES, normalizeFamily } from '@/utils/fonts'
import { formatDate } from '@/utils/dateFormats'
import { pointsToSmoothPath } from '@/utils/drawing'
import { assertNever } from '@/utils/assertNever'
import type {
  Annotation as AnnotType, DrawingAnnotation, ImageAnnotation, PageInfo, TextAnnotation, TextEditAnnotation,
} from '@/types'
import { cn } from '@/lib/utils'
import { FloatingToolbar } from './FloatingToolbar'

interface AnnotationProps {
  annotation: AnnotType
  page: PageInfo  // CSS dimensions — used for clamping during drag
  scale: number   // CSS pixels per PDF point
}

const CORNERS = ['tl', 'tr', 'bl', 'br'] as const
type Corner = (typeof CORNERS)[number]

function AnnotationImpl({ annotation, page, scale }: AnnotationProps) {
  // Narrow subscriptions: each annotation only re-renders when something it
  // actually depends on changes. Actions are stable refs.
  const mode = usePdfStore((s) => s.mode)
  const selectedId = usePdfStore((s) => s.selectedId)
  const setSelectedId = usePdfStore((s) => s.setSelectedId)
  const updateAnnotation = usePdfStore((s) => s.updateAnnotation)
  const removeAnnotation = usePdfStore((s) => s.removeAnnotation)
  const pushHistory = usePdfStore((s) => s.pushHistory)
  const isSelected = selectedId === annotation.id
  const wrapRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<HTMLDivElement>(null)
  // Track what HTML we've last written into the contentEditable so the sync
  // effect can tell apart externally-set values from in-flight typing.
  // Must start empty: the editor div starts empty until our effect writes to it.
  const lastHtmlRef = useRef<string>('')
  // True while the contentEditable for *this* annotation is "active". Lets us
  // expose drag/resize affordances on the active text box only — others stay
  // frozen until the user enters Select mode.
  //
  // We deliberately do NOT clear this on the editor's `blur`: opening the
  // date-format Radix Select moves DOM focus into a portal (a sibling of
  // <body>, not a descendant of the wrapper), which would unmount the toolbar
  // mid-click and break the dropdown. Instead we treat the box as active until
  // the user clicks somewhere truly outside it — outside the wrapper *and*
  // outside any Radix popper portal. That keeps the toolbar mounted while the
  // user is interacting with it.
  const [editorFocused, setEditorFocused] = useState(false)

  useEffect(() => {
    if (!editorFocused) return
    function onDown(e: PointerEvent) {
      const t = e.target as Node | null
      if (!t) return
      if (wrapRef.current?.contains(t)) return
      // Clicks landing inside any Radix-rendered floating content (Select
      // listbox / SelectItem option, Popover, Tooltip, etc.) belong to the
      // toolbar conceptually even though they live in a portal sibling of
      // <body>. Match by the popper-content-wrapper data attribute *and* by
      // ARIA roles, since Radix Select doesn't always use the popper wrapper.
      if (t instanceof Element && t.closest(
        '[data-radix-popper-content-wrapper],[role="listbox"],[role="option"],[role="menu"],[role="menuitem"],[role="dialog"]',
      )) return
      setEditorFocused(false)
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [editorFocused])

  // Memoised SVG path for drawing annotations (cheap pass-through for others).
  const pathD = useMemo(
    () => (annotation.type === 'drawing' ? pointsToSmoothPath(annotation.points) : ''),
    [annotation],
  )

  // Sync external HTML changes (undo/clear/etc) into the contentEditable
  // without disturbing the cursor during typing. Only runs when data actually
  // changes — *not* on every render — to keep the cursor stable.
  // `text` and `textEdit` share a single rendering branch — both are
  // contenteditable HTML runs. The auto-grow + sync-from-external effects
  // apply to either; gate on the union rather than the literal 'text'.
  const isTextLike = annotation.type === 'text' || annotation.type === 'textEdit'
  const externalHtml = isTextLike ? annotation.data : ''
  useLayoutEffect(() => {
    if (!isTextLike) return
    const el = editorRef.current
    if (!el) return
    if (lastHtmlRef.current !== externalHtml) {
      el.innerHTML = externalHtml
      lastHtmlRef.current = externalHtml
    }
  }, [isTextLike, externalHtml])

  // Auto-grow the box to fit content. Re-runs whenever the things that affect
  // measured size change (text, font, scale). NOT on every render — that
  // would loop because we call updateAnnotation here.
  const annotData = isTextLike ? annotation.data : ''
  const annotFontSize = isTextLike ? annotation.fontSize : 0
  const annotFamily = isTextLike ? annotation.family : ''
  useLayoutEffect(() => {
    if (!isTextLike) return
    const ed = editorRef.current
    if (!ed) return
    const cssPad = 8
    const newCssW = Math.max(40, ed.scrollWidth + cssPad)
    const newCssH = Math.max(annotation.fontSize * scale + 4, ed.scrollHeight)
    const newPdfW = newCssW / scale
    const newPdfH = newCssH / scale
    if (Math.abs(newPdfW - annotation.w) > 0.5 || Math.abs(newPdfH - annotation.h) > 0.5) {
      updateAnnotation(annotation.id, { w: newPdfW, h: newPdfH })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [annotData, annotFontSize, annotFamily, scale])

  const cssLeft = annotation.x * scale
  const cssTop = annotation.y * scale
  const cssWidth = annotation.w * scale
  const cssHeight = annotation.h * scale

  function startDrag(e: React.PointerEvent) {
    if (e.target instanceof HTMLElement && e.target.classList.contains('resize-handle')) return
    if (e.target instanceof HTMLElement && e.target.closest('.floating-toolbar')) return

    const isTextActive = isTextLike && editorFocused
    const isEditModeOnTextEdit = mode === 'edit' && annotation.type === 'textEdit'
    const clickedEditor = e.target === editorRef.current

    // Pure focus-only modes: idle (any text-like) and edit-mode (non-textEdit).
    // No drag — these just focus the editor on a non-editor click.
    if (mode !== 'select' && !isTextActive && !isEditModeOnTextEdit) {
      if (mode === 'idle' && isTextLike && editorRef.current && !clickedEditor) {
        e.preventDefault()
        editorRef.current.focus()
      }
      return
    }
    // While a focused editor is active, clicks INSIDE the editor type instead
    // of dragging — only the dashed border / handles around it move the box.
    if (isTextActive && clickedEditor) return
    e.preventDefault()
    if (mode === 'select') setSelectedId(annotation.id)
    const startX = e.clientX
    const startY = e.clientY
    const origPdfX = annotation.x
    const origPdfY = annotation.y
    // In edit mode on textEdit, a click anywhere on the wrapper (including
    // the editor) starts a drag-OR-focus gesture: if the pointer moves
    // beyond a small threshold, it's a drag; otherwise on pointerup we
    // focus the editor. That way the user can both drag the floating edit
    // around AND click into it to type, without switching modes.
    const DRAG_THRESHOLD_PX = 4
    let moved = false
    function move(ev: PointerEvent) {
      const dx = ev.clientX - startX
      const dy = ev.clientY - startY
      if (!moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return
      moved = true
      const dxPdf = dx / scale
      const dyPdf = dy / scale
      const maxX = page.cssWidth / scale - annotation.w
      const maxY = page.cssHeight / scale - annotation.h
      const cx = Math.max(0, Math.min(maxX, origPdfX + dxPdf))
      const cy = Math.max(0, Math.min(maxY, origPdfY + dyPdf))
      updateAnnotation(annotation.id, { x: cx, y: cy })
    }
    function up() {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      if (moved) {
        // Push history once at the END of the gesture so a single ⌘Z reverts
        // the whole drag, not the last sub-pixel update.
        pushHistory()
      } else if (isEditModeOnTextEdit && editorRef.current && !editorFocused) {
        // No movement = click. Focus the editor for typing.
        editorRef.current.focus()
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  function startResize(e: React.PointerEvent, corner: Corner) {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startY = e.clientY
    const rx = corner.includes('r') ? 1 : -1
    const ry = corner.includes('b') ? 1 : -1
    const anchorRight = corner.includes('l')
    const anchorBottom = corner.includes('t')

    if (annotation.type === 'signature' || annotation.type === 'drawing' || annotation.type === 'image') {
      const a = annotation
      const aspect = a.h / a.w
      const origPoints = a.type === 'drawing' ? a.points : null
      const origStroke = a.type === 'drawing' ? a.strokeWidth : 0
      let resized = false
      function move(ev: PointerEvent) {
        resized = true
        const dx = (ev.clientX - startX) / scale
        const dy = (ev.clientY - startY) / scale
        const outward = (dx * rx + dy * ry) / 2
        const newW = Math.max(20, a.w + outward)
        const newH = newW * aspect
        const nx = anchorRight ? a.x + a.w - newW : a.x
        const ny = anchorBottom ? a.y + a.h - newH : a.y
        if (a.type === 'drawing' && origPoints) {
          const f = newW / a.w
          updateAnnotation(a.id, {
            w: newW, h: newH, x: nx, y: ny,
            points: origPoints.map(([px, py]) => [px * f, py * f] as [number, number]),
            strokeWidth: origStroke * f,
          })
        } else {
          updateAnnotation(a.id, { w: newW, h: newH, x: nx, y: ny })
        }
      }
      function up() {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        if (resized) pushHistory()
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    } else {
      const a = annotation as TextAnnotation | TextEditAnnotation
      const origFs = a.fontSize
      const origX = a.x, origY = a.y, origW = a.w, origH = a.h
      let resized = false
      function move(ev: PointerEvent) {
        const dx = (ev.clientX - startX) / scale
        const dy = (ev.clientY - startY) / scale
        const outward = dx * rx + dy * ry
        const newFs = Math.max(4, Math.min(72, Math.round((origFs + outward / 4) * 10) / 10))
        if (newFs === a.fontSize) return
        resized = true
        const sc = newFs / origFs
        const newW = origW * sc
        const newH = origH * sc
        updateAnnotation(a.id, {
          fontSize: newFs,
          x: anchorRight ? origX + origW - newW : origX,
          y: anchorBottom ? origY + origH - newH : origY,
        })
      }
      function up() {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        if (resized) pushHistory()
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    }
  }

  if (annotation.type === 'text' || annotation.type === 'textEdit') {
    const a = annotation
    const isEdit = a.type === 'textEdit'
    const aTE = a as TextEditAnnotation
    // textEdit annotations may carry a separate "original glyph" bbox
    // (origX/Y/W/H). When present, we render the cover at THAT fixed
    // location so the user can drag the editor away without exposing the
    // source text. Older edits without these fields fall back to the
    // editor bbox itself acting as the cover.
    const hasFixedCover = isEdit && aTE.origX !== undefined && aTE.origY !== undefined
    const family = FONT_FAMILIES[normalizeFamily(a.family)]
    const hasMoved = isEdit && hasFixedCover && (
      Math.abs((aTE.origX ?? a.x) - a.x) > 0.1 ||
      Math.abs((aTE.origY ?? a.y) - a.y) > 0.1
    )
    return (
      <>
        {/* Persistent cover for the original glyphs — sticks at origBbox
            even if the wrapper has been dragged elsewhere. */}
        {hasFixedCover && (
          <div
            aria-hidden="true"
            data-testid="text-edit-cover"
            className="pointer-events-none absolute"
            style={{
              left: (aTE.origX ?? 0) * scale,
              top: (aTE.origY ?? 0) * scale,
              width: (aTE.origW ?? 0) * scale,
              height: (aTE.origH ?? 0) * scale,
              background: aTE.cover ?? '#ffffff',
            }}
          />
        )}
      <div
        ref={wrapRef}
        data-id={a.id}
        onPointerDown={startDrag}
        className={cn(
          'anim-fade-in absolute min-h-[18px] min-w-[24px] border border-dashed border-transparent',
          mode === 'select' && 'cursor-move hover:border-primary',
          (isSelected || editorFocused) && 'border-primary cursor-move',
          // Inert in any mode where the user is *placing* something new —
          // EXCEPT for textEdit annotations during edit mode, which we keep
          // clickable so they can be re-edited in place.
          (mode === 'text' || mode === 'signature' || mode === 'draw' ||
            (mode === 'edit' && !isEdit)) && 'pointer-events-none',
          // In edit mode, give textEdit annotations a yellow ring so the
          // user can spot their existing edits among the click-targets and
          // know they're re-editable. Hidden while the annotation is
          // explicitly Selected (cyan border takes over there).
          isEdit && mode === 'edit' && !isSelected && 'cursor-grab ring-1 ring-amber-400/70 hover:ring-amber-500 active:cursor-grabbing',
        )}
        // The wrapper itself only needs a background when there's no
        // separate fixed cover — the legacy code path. With hasFixedCover
        // the wrapper stays transparent so it doesn't drag a white box
        // around while the user moves it.
        style={{
          left: cssLeft, top: cssTop, width: cssWidth, height: cssHeight,
          ...(isEdit && !hasFixedCover ? { background: aTE.cover ?? '#ffffff' } : {}),
          // Wrapper that's been dragged away from its original gets a soft
          // border so the user can see where the floating edit currently is.
          ...(hasMoved ? { boxShadow: '0 1px 4px rgba(0,0,0,0.12)' } : {}),
        }}
      >
        <div
          ref={editorRef}
          contentEditable={mode !== 'select'}
          suppressContentEditableWarning
          onInput={() => {
            const html = editorRef.current!.innerHTML
            lastHtmlRef.current = html
            // Once the user edits the value, the date semantics no longer
            // apply — drop dateMs/dateLocale so the format picker disappears.
            const patch: Partial<TextAnnotation> = { data: html }
            if (a.type === 'text' && a.dateMs !== undefined) {
              patch.dateMs = undefined
              patch.dateLocale = undefined
            }
            updateAnnotation(a.id, patch)
          }}
          onPointerDown={(e) => {
            // The wrapper drives gestures in: select (drag), and edit-mode
            // on textEdit annotations (drag-or-focus). In every other mode
            // the editor itself owns the pointerdown — for typing-mode focus
            // and to keep idle-mode click-to-focus working.
            const wrapperDrives =
              mode === 'select' ||
              (mode === 'edit' && annotation.type === 'textEdit')
            if (!wrapperDrives) e.stopPropagation()
          }}
          onFocus={() => setEditorFocused(true)}
          onPaste={(e) => {
            // Strip paste to plain text. Otherwise pasted HTML (e.g.
            // `<img onerror=...>`) would round-trip through innerHTML and
            // execute. We only need text in form-fill use cases.
            e.preventDefault()
            const text = e.clipboardData.getData('text/plain')
            document.execCommand('insertText', false, text)
          }}
          onDrop={(e) => {
            // Drag-and-drop is the *other* default channel for HTML to land
            // in a contentEditable. Without this preventDefault the browser
            // would insert the dragged source's text/html verbatim, then
            // onInput would round-trip it through innerHTML and any
            // <img onerror=...> / <svg onload=...> payload would execute.
            e.preventDefault()
            const text = e.dataTransfer.getData('text/plain')
            if (text) document.execCommand('insertText', false, text)
          }}
          onDragOver={(e) => e.preventDefault()}
          onKeyDown={(e) => {
            // Standard B/I/U keyboard shortcuts work via execCommand by default.
            // Make sure Enter inserts a <br> (single-line-ish) instead of a new <div>.
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              document.execCommand('insertLineBreak')
            }
          }}
          className={cn(
            'h-full w-full whitespace-pre border-none bg-transparent outline-none',
            // text edits stay tight to the cover rect so the original glyph
            // stays fully covered; plain text annotations get the existing
            // small padding so the dashed border doesn't crowd the text.
            isEdit ? 'p-0' : 'p-[2px_4px]',
            mode === 'select' && 'pointer-events-none',
          )}
          style={{
            fontSize: a.fontSize * scale,
            fontFamily: family.css,
            color: a.color,
            // line-height: 1 for edits visually aligns the new text closer
            // to the original glyph baseline; the looser 1.2 stays for
            // free-text annotations where there's no baseline to match.
            lineHeight: isEdit ? 1 : 1.2,
            ...(isEdit && (a as TextEditAnnotation).align
              ? { textAlign: (a as TextEditAnnotation).align }
              : {}),
          }}
        />
        <DeleteButton onClick={() => removeAnnotation(a.id)} visible={isSelected || editorFocused} />
        <Handles onResize={startResize} visible={isSelected || editorFocused} />
        {isSelected && (
          <FloatingToolbar
            anchorLeft={0}
            anchorTop={-40}
            onDelete={() => removeAnnotation(a.id)}
            date={a.type === 'text' && a.dateMs !== undefined ? {
              locale: a.dateLocale,
              onChange: (newLocale) => {
                const formatted = formatDate(a.dateMs!, newLocale)
                updateAnnotation(a.id, { dateLocale: newLocale, data: formatted })
              },
            } : undefined}
          />
        )}
        {/*
         * Compact date-format picker — visible while the editor is focused
         * on a date annotation (idle mode, just-placed). No Delete or B/I/U
         * to avoid the cluttered "edit dialog" feel the user previously
         * disliked; only the format select.
         */}
        {!isSelected && editorFocused && a.type === 'text' && a.dateMs !== undefined && (
          <FloatingToolbar
            anchorLeft={0}
            anchorTop={-40}
            date={{
              locale: a.dateLocale,
              onChange: (newLocale) => {
                const formatted = formatDate(a.dateMs!, newLocale)
                updateAnnotation(a.id, { dateLocale: newLocale, data: formatted })
              },
            }}
          />
        )}
      </div>
      </>
    )
  }

  if (annotation.type === 'drawing') {
    const a = annotation as DrawingAnnotation
    return (
      <div
        ref={wrapRef}
        data-id={a.id}
        onPointerDown={startDrag}
        className={cn(
          'anim-fade-in absolute border border-dashed border-transparent',
          mode === 'select' && 'cursor-move hover:border-primary',
          isSelected && 'border-primary',
          (mode === 'text' || mode === 'signature' || mode === 'draw' || mode === 'edit') && 'pointer-events-none',
        )}
        style={{ left: cssLeft, top: cssTop, width: cssWidth, height: cssHeight }}
      >
        <svg
          width="100%"
          height="100%"
          viewBox={`0 0 ${a.w} ${a.h}`}
          preserveAspectRatio="none"
          className="pointer-events-none block"
        >
          <path
            d={pathD}
            stroke={a.color}
            strokeWidth={a.strokeWidth}
            strokeOpacity={a.opacity}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <DeleteButton onClick={() => removeAnnotation(a.id)} visible={isSelected} />
        <Handles onResize={startResize} visible={isSelected} />
        {isSelected && (
          <FloatingToolbar
            anchorLeft={0}
            anchorTop={-40}
            onDelete={() => removeAnnotation(a.id)}
            pen={{
              color: a.color,
              opacity: a.opacity,
              width: a.strokeWidth,
              onChange: (patch) => updateAnnotation(a.id, patch),
            }}
          />
        )}
      </div>
    )
  }

  if (annotation.type === 'image') {
    const a = annotation as ImageAnnotation
    return (
      <div
        ref={wrapRef}
        data-id={a.id}
        onPointerDown={startDrag}
        className={cn(
          'anim-fade-in absolute border border-dashed border-transparent',
          mode === 'select' && 'cursor-move hover:border-primary',
          isSelected && 'border-primary',
          mode !== 'select' && 'pointer-events-none',
        )}
        style={{ left: cssLeft, top: cssTop, width: cssWidth, height: cssHeight }}
      >
        <img
          src={a.data}
          alt=""
          draggable={false}
          className="pointer-events-none block h-full w-full object-fill"
        />
        <DeleteButton onClick={() => removeAnnotation(a.id)} visible={isSelected} />
        <Handles onResize={startResize} visible={isSelected} />
        {isSelected && (
          <FloatingToolbar
            anchorLeft={0}
            anchorTop={-40}
            onDelete={() => removeAnnotation(a.id)}
          />
        )}
        {isSelected && (
          <span
            className="pointer-events-none absolute -bottom-5 left-0 rounded bg-card/95 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground shadow"
            aria-hidden="true"
          >
            session-only
          </span>
        )}
      </div>
    )
  }

  if (annotation.type === 'signature') {
    // TS narrows automatically; the `if` block keeps the explicit branching
    // consistent and lets the `assertNever` below catch any future variant.
    const a = annotation
    return (
      <div
        ref={wrapRef}
        data-id={a.id}
        onPointerDown={startDrag}
        className={cn(
          'anim-fade-in absolute border border-dashed border-transparent',
          mode === 'select' && 'cursor-move hover:border-primary',
          isSelected && 'border-primary',
          mode !== 'select' && 'pointer-events-none',
        )}
        style={{ left: cssLeft, top: cssTop, width: cssWidth, height: cssHeight }}
      >
        <img src={a.data} alt="" className="pointer-events-none block h-full w-full" draggable={false} />
        <DeleteButton onClick={() => removeAnnotation(a.id)} visible={isSelected} />
        <Handles onResize={startResize} visible={isSelected} />
        {isSelected && (
          <FloatingToolbar
            anchorLeft={0}
            anchorTop={-40}
            onDelete={() => removeAnnotation(a.id)}
          />
        )}
      </div>
    )
  }

  // Compile-time exhaustiveness check — adding a new `Annotation.type`
  // value will fail the type check here until it's handled above.
  return assertNever(annotation)
}

// Skip re-rendering an annotation when its props haven't changed. Combined
// with the narrowed store subscriptions above, updating one annotation in a
// page of 50 only re-renders that one.
export const Annotation = memo(AnnotationImpl)

function DeleteButton({ onClick, visible }: { onClick: () => void; visible: boolean }) {
  return (
    <button
      type="button"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => { e.stopPropagation(); onClick() }}
      className={cn(
        'absolute -right-2.5 -top-2.5 size-5 items-center justify-center rounded-full',
        'bg-destructive text-destructive-foreground shadow',
        visible ? 'flex' : 'hidden',
      )}
      aria-label="Delete"
    >
      <X className="size-3" />
    </button>
  )
}

function Handles({
  onResize,
  visible,
}: {
  onResize: (e: React.PointerEvent, corner: Corner) => void
  visible: boolean
}) {
  return (
    <>
      {CORNERS.map((c) => (
        <div
          key={c}
          onPointerDown={(e) => onResize(e, c)}
          className={cn(
            'resize-handle absolute z-10 size-3 rounded-full border-2 border-card bg-primary',
            visible ? 'block' : 'hidden',
            c === 'tl' && '-left-1.5 -top-1.5 cursor-nwse-resize',
            c === 'tr' && '-right-1.5 -top-1.5 cursor-nesw-resize',
            c === 'bl' && '-bottom-1.5 -left-1.5 cursor-nesw-resize',
            c === 'br' && '-bottom-1.5 -right-1.5 cursor-nwse-resize',
          )}
        />
      ))}
    </>
  )
}
