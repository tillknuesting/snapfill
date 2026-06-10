import { useRef, useState, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  AlignLeft, ArrowDownToLine, ArrowUpToLine, Calendar, ChevronDown, Download, Eraser, FileUp, Files,
  Hash, HelpCircle, Image as ImageIcon, ListOrdered, Loader2, MousePointer2, Pencil, PenLine,
  RectangleHorizontal, Stamp, TextCursorInput, Type, Undo2, User, ZoomIn, ZoomOut,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'
import { Toggle } from '@/components/ui/toggle'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { PenControls, PEN_COLORS } from './FloatingToolbar'
import { ThemeToggle } from './ThemeToggle'
import { LanguagePicker } from './LanguagePicker'
import { useT } from '@/utils/useT'
import { formatPercent } from '@/utils/i18n'
import { usePdfStore } from '@/store/usePdfStore'
import { FAMILY_OPTIONS, normalizeFamily } from '@/utils/fonts'
import { formatDate } from '@/utils/dateFormats'
import {
  fileToDataUrl, probeImageDimensions, validateImageFile,
} from '@/utils/imageValidation'
import type { CompressionLevel, FontFamily } from '@/types'
import { cn } from '@/lib/utils'

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const cmd = isMac ? '⌘' : 'Ctrl'

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="ms-2 rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
      {children}
    </kbd>
  )
}

interface ToolbarBtnProps {
  icon: ReactNode
  label: string
  shortcut?: string
  active?: boolean
  disabled?: boolean
  primary?: boolean        // when true the button is always filled (e.g. Open / Download)
  onClick?: () => void
  // The active label appears as a chip beside the icon, otherwise icon-only.
  showLabelWhen?: 'always' | 'active'
}

function ToolbarBtn({
  icon, label, shortcut, active, disabled, primary, onClick, showLabelWhen = 'active',
}: ToolbarBtnProps) {
  const showLabel = showLabelWhen === 'always' || (showLabelWhen === 'active' && active)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={active || primary ? 'default' : 'ghost'}
          size="sm"
          disabled={disabled}
          onClick={onClick}
          aria-label={label}
          aria-pressed={active}
          className={cn(
            // Touch-friendlier hit area; reverts to compact on ≥sm.
            'h-10 sm:h-8',
            // Don't let buttons collapse on mobile when toolbar overflows
            // horizontally — the parent uses overflow-x-auto on small screens.
            'shrink-0',
            active && 'shadow-md ring-2 ring-primary/30',
          )}
        >
          {icon}
          {showLabel && <span>{label}</span>}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="flex items-center">
        <span>{label}</span>
        {shortcut && <Kbd>{shortcut}</Kbd>}
      </TooltipContent>
    </Tooltip>
  )
}

interface ToolbarProps {
  onOpenFile: (file: File) => void
  onMergePdf: (file: File, where: 'start' | 'end') => Promise<void>
  onOpenSignature: () => void
  onOpenProfile: () => void
  onOpenHelp: () => void
  onOpenPages: () => void
  onDownload: (opts?: { compress?: boolean; level?: CompressionLevel }) => void
  hasMultiplePages: boolean
  textFamily: FontFamily
  setTextFamily: (id: FontFamily) => void
  textSize: number
  setTextSize: (n: number) => void
  textColor: string
  setTextColor: (c: string) => void
  snapEnabled: boolean
  setSnapEnabled: (v: boolean) => void
  sigModalOpen: boolean
  profileDialogOpen: boolean
}

export function Toolbar(props: ToolbarProps) {
  const t = useT()
  const fileRef = useRef<HTMLInputElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const mergeInputRef = useRef<HTMLInputElement>(null)
  // Where the next picked PDF should land relative to the current document.
  // Set by clicking one of the popover entries; consumed by the file-input
  // onChange handler.
  const [mergeWhere, setMergeWhere] = useState<'start' | 'end' | null>(null)
  const [mergePopoverOpen, setMergePopoverOpen] = useState(false)
  const [merging, setMerging] = useState(false)
  // Download split-button state. compressOnDownload persists for the
  // session — the user picks once and subsequent downloads honour it.
  const [downloadOptsOpen, setDownloadOptsOpen] = useState(false)
  const [compressOnDownload, setCompressOnDownload] = useState(false)
  const [compressLevel, setCompressLevel] = useState<CompressionLevel>('mid')
  const pdfBytes = usePdfStore((s) => s.pdfBytes)
  const mode = usePdfStore((s) => s.mode)
  const setMode = usePdfStore((s) => s.setMode)
  const undoAnnotation = usePdfStore((s) => s.undoAnnotation)
  const clearAnnotations = usePdfStore((s) => s.clearAnnotations)
  const hasAnnotations = usePdfStore((s) => s.annotations.length > 0)
  const selectedText = usePdfStore(useShallow((s) => {
    const selected = s.selectedId ? s.annotations.find((a) => a.id === s.selectedId) : null
    return {
      id: selected?.type === 'text' ? selected.id : null,
      family: selected?.type === 'text' ? selected.family : null,
      fontSize: selected?.type === 'text' ? selected.fontSize : null,
      color: selected?.type === 'text' ? selected.color : null,
    }
  }))
  const updateAnnotation = usePdfStore((s) => s.updateAnnotation)
  const pushHistory = usePdfStore((s) => s.pushHistory)
  const zoom = usePdfStore((s) => s.zoom)
  const setZoom = usePdfStore((s) => s.setZoom)
  const setPendingTextValue = usePdfStore((s) => s.setPendingTextValue)
  const setPendingDateMs = usePdfStore((s) => s.setPendingDateMs)
  const setPendingImage = usePdfStore((s) => s.setPendingImage)
  const penColor = usePdfStore((s) => s.penColor)
  const penOpacity = usePdfStore((s) => s.penOpacity)
  const penWidth = usePdfStore((s) => s.penWidth)
  const setPenColor = usePdfStore((s) => s.setPenColor)
  const setPenOpacity = usePdfStore((s) => s.setPenOpacity)
  const setPenWidth = usePdfStore((s) => s.setPenWidth)
  const watermark = usePdfStore((s) => s.watermark)
  const setWatermark = usePdfStore((s) => s.setWatermark)
  const pageNumbers = usePdfStore((s) => s.pageNumbers)
  const setPageNumbers = usePdfStore((s) => s.setPageNumbers)
  const lang = usePdfStore((s) => s.lang)

  async function handleImagePicker(file: File) {
    const v = validateImageFile(file)
    if (!v.ok) { alert(t(v.reasonKey, v.vars)); return }
    try {
      const dataUrl = await fileToDataUrl(file)
      const dims = await probeImageDimensions(dataUrl)
      // Bound decoded-bitmap memory. JPEG compresses ~10×, so a 10 MB JPEG
      // can decode to a 100 MB raw bitmap. Cap each side at 5000 px and the
      // total pixel count at 20 MP — still generous for a printed page (a
      // 300 DPI letter-sized scan is ~8.4 MP).
      const MAX_SIDE = 5000
      const MAX_PIXELS = 20_000_000
      if (dims.width > MAX_SIDE || dims.height > MAX_SIDE) {
        alert(t('img.err.too_large_side', { width: dims.width, height: dims.height, max: MAX_SIDE }))
        return
      }
      if (dims.width * dims.height > MAX_PIXELS) {
        alert(t('img.err.too_large_pixels', { pixels: dims.width * dims.height, max: MAX_PIXELS / 1_000_000 }))
        return
      }
      setPendingImage({ dataUrl, mime: v.mime, width: dims.width, height: dims.height })
      setMode('image')
    } catch (err) {
      alert(t('err.read_image', { message: (err as Error).message }))
    }
  }

  const hasPdf = !!pdfBytes
  // Show the text-styling controls only when they're contextually useful.
  const showTextControls = hasPdf && (mode === 'text' || selectedText.id !== null)

  const familyValue = selectedText.family ? normalizeFamily(selectedText.family) : props.textFamily
  const sizeValue = selectedText.fontSize ?? props.textSize
  // Show the swatch on the toolbar trigger using the selected annotation's
  // colour when one is selected (so the user sees what they're editing),
  // otherwise the global default that next-typed text will use.
  const colorValue = selectedText.color ?? props.textColor

  function handleFamilyChange(id: FontFamily) {
    if (selectedText.id) {
      updateAnnotation(selectedText.id, { family: id })
      pushHistory()
    }
    else props.setTextFamily(id)
  }
  function handleSizeChange(n: number) {
    const clamped = Math.max(6, Math.min(72, n))
    if (selectedText.id) {
      updateAnnotation(selectedText.id, { fontSize: clamped })
      pushHistory()
    }
    else props.setTextSize(clamped)
  }
  function handleColorChange(c: string) {
    if (selectedText.id) {
      updateAnnotation(selectedText.id, { color: c })
      pushHistory()
    }
    else props.setTextColor(c)
  }

  function renderWatermarkControls() {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 rounded border border-border/70 bg-muted/20 p-2 text-sm font-medium">
          <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={watermark.enabled}
              disabled={!hasPdf}
              onChange={(e) => setWatermark({ enabled: e.target.checked })}
              className="size-4 shrink-0 cursor-pointer accent-primary"
            />
            <span>{t('wm.enabled')}</span>
          </label>
          <span
            aria-hidden="true"
            className={cn(
              'shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold leading-none',
              watermark.enabled
                ? 'border-primary/30 bg-primary/10 text-primary'
                : 'border-border bg-background text-muted-foreground',
            )}
          >
            {watermark.enabled ? t('wm.status_on') : t('wm.status_off')}
          </span>
        </div>
        <label className="block space-y-1.5 text-sm">
          <span className="text-xs font-medium text-muted-foreground">{t('wm.text')}</span>
          <Input
            value={watermark.text}
            disabled={!hasPdf}
            maxLength={80}
            placeholder={t('wm.placeholder')}
            onChange={(e) => setWatermark({ text: e.currentTarget.value })}
            onFocus={(e) => e.currentTarget.select()}
          />
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block space-y-1.5 text-sm">
            <span className="text-xs font-medium text-muted-foreground">{t('wm.size')}</span>
            <Input
              type="number"
              min={12}
              max={160}
              value={watermark.fontSize}
              disabled={!hasPdf}
              onChange={(e) => setWatermark({ fontSize: Number(e.currentTarget.value) || 72 })}
              className="font-mono"
            />
          </label>
          <label className="block space-y-1.5 text-sm">
            <span className="text-xs font-medium text-muted-foreground">{t('wm.color')}</span>
            <div className="flex h-9 items-center gap-1.5">
              {['#0a1f3d', '#64748b', '#991b1b', '#1d4ed8'].map((c) => (
                <button
                  key={c}
                  type="button"
                  disabled={!hasPdf}
                  aria-label={`${t('wm.color')} ${c}`}
                  onClick={() => setWatermark({ color: c })}
                  className={cn(
                    'size-6 rounded-full border-2 disabled:opacity-50',
                    watermark.color === c ? 'border-primary ring-2 ring-primary/20' : 'border-border',
                  )}
                  style={{ background: c }}
                />
              ))}
            </div>
          </label>
        </div>
        <label className="block space-y-1.5 text-sm">
          <span className="flex items-center justify-between text-xs font-medium text-muted-foreground">
            <span>{t('wm.opacity')}</span>
            <span className="font-mono tabular-nums">{formatPercent(lang, watermark.opacity)}</span>
          </span>
          <input
            type="range"
            min={5}
            max={60}
            value={Math.round(watermark.opacity * 100)}
            disabled={!hasPdf}
            onChange={(e) => setWatermark({ opacity: Number(e.currentTarget.value) / 100 })}
            className="w-full accent-primary"
          />
        </label>
        <label className="block space-y-1.5 text-sm">
          <span className="flex items-center justify-between text-xs font-medium text-muted-foreground">
            <span>{t('wm.rotation')}</span>
            <span className="font-mono tabular-nums">{watermark.rotation}°</span>
          </span>
          <input
            type="range"
            min={-90}
            max={90}
            step={5}
            value={watermark.rotation}
            disabled={!hasPdf}
            onChange={(e) => setWatermark({ rotation: Number(e.currentTarget.value) })}
            className="w-full accent-primary"
          />
        </label>
      </div>
    )
  }

  function renderPageNumberControls() {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 rounded border border-border/70 bg-muted/20 p-2 text-sm font-medium">
          <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={pageNumbers.enabled}
              disabled={!hasPdf}
              onChange={(e) => setPageNumbers({ enabled: e.target.checked })}
              className="size-4 shrink-0 cursor-pointer accent-primary"
            />
            <span>{t('pn.enabled')}</span>
          </label>
          <span
            aria-hidden="true"
            className={cn(
              'shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold leading-none',
              pageNumbers.enabled
                ? 'border-primary/30 bg-primary/10 text-primary'
                : 'border-border bg-background text-muted-foreground',
            )}
          >
            {pageNumbers.enabled ? t('pn.status_on') : t('pn.status_off')}
          </span>
        </div>
        <label className="block space-y-1.5 text-sm">
          <span className="text-xs font-medium text-muted-foreground">{t('pn.format')}</span>
          <Select
            value={pageNumbers.format}
            onValueChange={(v) => setPageNumbers({ format: v as typeof pageNumbers.format })}
          >
            <SelectTrigger className="w-full" size="sm" disabled={!hasPdf} aria-label={t('pn.format_aria')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="page-of-total">{t('pn.format_page_total')}</SelectItem>
              <SelectItem value="page">{t('pn.format_page')}</SelectItem>
              <SelectItem value="number">1</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <label className="block space-y-1.5 text-sm">
          <span className="text-xs font-medium text-muted-foreground">{t('pn.position')}</span>
          <Select
            value={pageNumbers.position}
            onValueChange={(v) => setPageNumbers({ position: v as typeof pageNumbers.position })}
          >
            <SelectTrigger className="w-full" size="sm" disabled={!hasPdf} aria-label={t('pn.position_aria')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="bottom-center">{t('pn.bottom_center')}</SelectItem>
              <SelectItem value="bottom-right">{t('pn.bottom_right')}</SelectItem>
              <SelectItem value="bottom-left">{t('pn.bottom_left')}</SelectItem>
              <SelectItem value="top-center">{t('pn.top_center')}</SelectItem>
              <SelectItem value="top-right">{t('pn.top_right')}</SelectItem>
              <SelectItem value="top-left">{t('pn.top_left')}</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <div className="grid grid-cols-3 gap-2">
          <label className="block space-y-1.5 text-sm">
            <span className="text-xs font-medium text-muted-foreground">{t('pn.start')}</span>
            <Input
              type="number"
              min={0}
              max={9999}
              value={pageNumbers.startAt}
              disabled={!hasPdf}
              onChange={(e) => setPageNumbers({ startAt: Number(e.currentTarget.value) || 0 })}
              className="font-mono"
            />
          </label>
          <label className="block space-y-1.5 text-sm">
            <span className="text-xs font-medium text-muted-foreground">{t('pn.size')}</span>
            <Input
              type="number"
              min={6}
              max={48}
              value={pageNumbers.fontSize}
              disabled={!hasPdf}
              onChange={(e) => setPageNumbers({ fontSize: Number(e.currentTarget.value) || 10 })}
              className="font-mono"
            />
          </label>
          <label className="block space-y-1.5 text-sm">
            <span className="text-xs font-medium text-muted-foreground">{t('pn.margin')}</span>
            <Input
              type="number"
              min={8}
              max={144}
              value={pageNumbers.margin}
              disabled={!hasPdf}
              onChange={(e) => setPageNumbers({ margin: Number(e.currentTarget.value) || 28 })}
              className="font-mono"
            />
          </label>
        </div>
        <label className="block space-y-1.5 text-sm">
          <span className="text-xs font-medium text-muted-foreground">{t('pn.color')}</span>
          <div className="flex h-9 items-center gap-1.5">
            {['#0a1f3d', '#64748b', '#111827', '#1d4ed8'].map((c) => (
              <button
                key={c}
                type="button"
                disabled={!hasPdf}
                aria-label={t('pn.color_value', { color: c })}
                onClick={() => setPageNumbers({ color: c })}
                className={cn(
                  'size-6 rounded-full border-2 disabled:opacity-50',
                  pageNumbers.color === c ? 'border-primary ring-2 ring-primary/20' : 'border-border',
                )}
                style={{ background: c }}
              />
            ))}
          </div>
        </label>
      </div>
    )
  }

  function renderTextControls(mobile: boolean) {
    if (!showTextControls) return null
    return (
      <div className={cn(
        mobile
          ? 'fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-40 border-t bg-background/95 px-2 py-2 shadow-lg backdrop-blur sm:hidden'
          : 'contents',
      )}>
        <div className={cn(mobile ? 'flex items-center gap-2 overflow-x-auto [scrollbar-width:none]' : 'contents')}>
          {!mobile && <Separator orientation="vertical" className="mx-1 h-6 shrink-0" />}
          <Tooltip>
            <TooltipTrigger asChild>
              <div>
                <Select value={familyValue} onValueChange={(v: string) => handleFamilyChange(v as FontFamily)}>
                  <SelectTrigger size="sm" className={cn('shrink-0', mobile ? 'w-[132px]' : 'w-[140px]')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FAMILY_OPTIONS.map((o) => (
                      <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t('tb.font_family')}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Input
                type="number"
                min={6}
                max={72}
                value={sizeValue}
                onChange={(e) => handleSizeChange(parseInt(e.currentTarget.value, 10) || 14)}
                className={cn('h-10 w-16 shrink-0 font-mono sm:h-8', mobile && 'h-9 w-14')}
                aria-label={t('tb.font_size')}
              />
            </TooltipTrigger>
            <TooltipContent side="bottom">{t('tb.font_size')}</TooltipContent>
          </Tooltip>
          <Popover>
            <Tooltip>
              <TooltipTrigger asChild>
                <PopoverTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={t('tb.text_color')}
                    className={cn('h-10 shrink-0 sm:h-8', mobile && 'h-9 w-9 px-0')}
                  >
                    <span
                      className="size-3.5 rounded-full border"
                      style={{ background: colorValue }}
                    />
                  </Button>
                </PopoverTrigger>
              </TooltipTrigger>
              <TooltipContent side="bottom">{t('tb.text_color')}</TooltipContent>
            </Tooltip>
            <PopoverContent className="w-auto p-2">
              <div className="mb-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t('tb.text_color')}
              </div>
              <div className="flex items-center gap-1.5">
                {PEN_COLORS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => handleColorChange(c.value)}
                    title={t(c.labelKey)}
                    aria-label={t(c.labelKey)}
                    className={cn(
                      'size-6 rounded-full border-2',
                      colorValue === c.value
                        ? 'border-primary ring-2 ring-primary/20'
                        : 'border-border',
                    )}
                    style={{ background: c.value }}
                  />
                ))}
                <label
                  title={t('tb.custom_color')}
                  className={cn(
                    'relative size-6 cursor-pointer rounded-full border-2',
                    PEN_COLORS.some((c) => c.value === colorValue)
                      ? 'border-border'
                      : 'border-primary ring-2 ring-primary/20',
                  )}
                  style={{
                    background: 'conic-gradient(from 0deg, #f43f5e, #f59e0b, #84cc16, #06b6d4, #6366f1, #d946ef, #f43f5e)',
                  }}
                >
                  <input
                    type="color"
                    value={colorValue}
                    onChange={(e) => handleColorChange(e.target.value)}
                    aria-label={t('tb.custom_color')}
                    className="absolute inset-0 size-full cursor-pointer opacity-0"
                  />
                </label>
              </div>
            </PopoverContent>
          </Popover>
          <Tooltip>
            <TooltipTrigger asChild>
              <Toggle
                size="sm"
                pressed={props.snapEnabled}
                onPressedChange={props.setSnapEnabled}
                aria-label={props.snapEnabled ? t('tb.snap_on') : t('tb.snap_off')}
                aria-pressed={props.snapEnabled}
                className={cn(
                  'h-10 shrink-0 sm:h-8',
                  mobile && 'h-9 px-2',
                  props.snapEnabled
                    ? 'bg-primary text-primary-foreground shadow-md ring-2 ring-primary/30 hover:bg-primary/90 hover:text-primary-foreground data-[state=on]:bg-primary data-[state=on]:text-primary-foreground'
                    : 'border border-dashed border-muted-foreground/40 text-muted-foreground',
                )}
              >
                <AlignLeft
                  className={cn('size-4', props.snapEnabled && 'size-5')}
                  strokeWidth={props.snapEnabled ? 2.5 : 2}
                />
                <span>{t('tb.snap')}</span>
              </Toggle>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t('tb.snap_to_lines')}</TooltipContent>
          </Tooltip>
        </div>
      </div>
    )
  }

  return (
    <header
      className={cn(
        'frosted flex items-center gap-1.5 border-b py-2',
        // Phones use the same controls as desktop; horizontal scrolling keeps
        // every action reachable without a separate duplicate toolbar.
        'overflow-x-auto px-3 [scrollbar-width:thin]',
        'sm:flex-wrap sm:overflow-x-visible',
      )}
    >
      <input
        ref={fileRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) props.onOpenFile(f)
          e.currentTarget.value = ''
        }}
      />
      <ToolbarBtn
        icon={<FileUp className="size-4" />}
        label={t('tb.open')}
        primary
        showLabelWhen="always"
        onClick={() => fileRef.current?.click()}
      />

      {/* Merge: append or prepend another PDF onto the current one. */}
      <input
        ref={mergeInputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0]
          e.currentTarget.value = ''
          if (!f || !mergeWhere) return
          setMerging(true)
          try {
            await props.onMergePdf(f, mergeWhere)
          } finally {
            setMerging(false)
            setMergeWhere(null)
          }
        }}
      />
      <Popover open={mergePopoverOpen} onOpenChange={setMergePopoverOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                disabled={!hasPdf || merging}
                aria-label={t('tb.merge_pdf')}
                className="h-10 shrink-0 sm:h-8"
              >
                {merging
                  ? <Loader2 className="size-4 animate-spin" />
                  : <Files className="size-4" />}
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t('tb.merge_pdf')}</TooltipContent>
        </Tooltip>
        <PopoverContent className="w-48 p-1" align="start">
          <button
            type="button"
            onClick={() => {
              setMergePopoverOpen(false)
              setMergeWhere('start')
              mergeInputRef.current?.click()
            }}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
          >
            <ArrowUpToLine className="size-4 shrink-0" />
            <span>{t('tb.merge_at_start')}</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setMergePopoverOpen(false)
              setMergeWhere('end')
              mergeInputRef.current?.click()
            }}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent"
          >
            <ArrowDownToLine className="size-4 shrink-0" />
            <span>{t('tb.merge_at_end')}</span>
          </button>
        </PopoverContent>
      </Popover>
      <ToolbarBtn
        icon={<ListOrdered className="size-4" />}
        label={t('tb.pages')}
        disabled={!hasPdf || !props.hasMultiplePages}
        onClick={props.onOpenPages}
      />

      <Separator orientation="vertical" className="mx-1 h-6 shrink-0" />

      {/* Insertion cluster */}
      <ToolbarBtn
        icon={<Type className={cn('size-4', mode === 'text' && 'size-5')} strokeWidth={mode === 'text' ? 2.5 : 2} />}
        label={t('tb.add_text')}
        shortcut="T"
        active={mode === 'text'}
        disabled={!hasPdf}
        onClick={() => setMode(mode === 'text' ? 'idle' : 'text')}
      />
      <ToolbarBtn
        icon={<TextCursorInput className={cn('size-4', mode === 'edit' && 'size-5')} strokeWidth={mode === 'edit' ? 2.5 : 2} />}
        label={t('tb.edit_text')}
        shortcut="E"
        active={mode === 'edit'}
        disabled={!hasPdf}
        onClick={() => setMode(mode === 'edit' ? 'idle' : 'edit')}
      />
      <ToolbarBtn
        icon={<RectangleHorizontal className={cn('size-4', mode === 'redact' && 'size-5')} strokeWidth={mode === 'redact' ? 2.5 : 2} />}
        label={t('tb.redact')}
        shortcut="R"
        active={mode === 'redact'}
        disabled={!hasPdf}
        onClick={() => setMode(mode === 'redact' ? 'idle' : 'redact')}
      />
      <ToolbarBtn
        icon={<PenLine
          className={cn('size-4', (mode === 'signature' || props.sigModalOpen) && 'size-5')}
          strokeWidth={(mode === 'signature' || props.sigModalOpen) ? 2.5 : 2}
        />}
        label={t('tb.add_signature')}
        active={mode === 'signature' || props.sigModalOpen}
        disabled={!hasPdf}
        onClick={() => mode === 'signature' ? setMode('idle') : props.onOpenSignature()}
      />

      <input
        ref={imageInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void handleImagePicker(f)
          e.currentTarget.value = ''
        }}
      />
      <ToolbarBtn
        icon={<ImageIcon className={cn('size-4', mode === 'image' && 'size-5')} strokeWidth={mode === 'image' ? 2.5 : 2} />}
        label={t('tb.add_image')}
        active={mode === 'image'}
        disabled={!hasPdf}
        onClick={() => {
          if (mode === 'image') { setMode('idle'); return }
          imageInputRef.current?.click()
        }}
      />
      <Popover>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                variant={watermark.enabled ? 'default' : 'ghost'}
                size="sm"
                disabled={!hasPdf}
                aria-label={t('tb.watermark')}
                aria-pressed={watermark.enabled}
                className={cn(
                  'h-10 shrink-0 sm:h-8',
                  watermark.enabled && 'shadow-md ring-2 ring-primary/30',
                )}
              >
                <Stamp className={cn('size-4', watermark.enabled && 'size-5')} />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t('tb.watermark')}</TooltipContent>
        </Tooltip>
        <PopoverContent className="w-72 p-3" align="start">
          {renderWatermarkControls()}
        </PopoverContent>
      </Popover>
      <Popover>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                variant={pageNumbers.enabled ? 'default' : 'ghost'}
                size="sm"
                disabled={!hasPdf}
                aria-label={t('pn.label')}
                aria-pressed={pageNumbers.enabled}
                className={cn(
                  'h-10 shrink-0 sm:h-8',
                  pageNumbers.enabled && 'shadow-md ring-2 ring-primary/30',
                )}
              >
                <Hash className={cn('size-4', pageNumbers.enabled && 'size-5')} />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t('pn.label')}</TooltipContent>
        </Tooltip>
        <PopoverContent className="w-72 p-3" align="start">
          {renderPageNumberControls()}
        </PopoverContent>
      </Popover>
      <ToolbarBtn
        icon={<Pencil className={cn('size-4', mode === 'draw' && 'size-5')} strokeWidth={mode === 'draw' ? 2.5 : 2} />}
        label={t('tb.draw')}
        shortcut="D"
        active={mode === 'draw'}
        disabled={!hasPdf}
        onClick={() => setMode(mode === 'draw' ? 'idle' : 'draw')}
      />
      {/* Pen settings (color/opacity/width) — only contextually useful in
          draw mode, so hide otherwise. Mirrors how showTextControls gates
          the font-family/size cluster below. */}
      {mode === 'draw' && (
        <Popover>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" disabled={!hasPdf} aria-label={t('tb.pen_settings')} className="h-10 shrink-0 sm:h-8">
                  <span
                    className="size-3.5 rounded-full border"
                    style={{ background: penColor, opacity: penOpacity }}
                  />
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t('tb.pen_settings')}</TooltipContent>
          </Tooltip>
          <PopoverContent className="w-56 space-y-3">
            <PenControls
              value={{ color: penColor, opacity: penOpacity, width: penWidth }}
              onChange={(p) => {
                if (p.color !== undefined) setPenColor(p.color)
                if (p.opacity !== undefined) setPenOpacity(p.opacity)
                if (p.width !== undefined) setPenWidth(p.width)
              }}
            />
          </PopoverContent>
        </Popover>
      )}
      <ToolbarBtn
        icon={<MousePointer2 className={cn('size-4', mode === 'select' && 'size-5')} strokeWidth={mode === 'select' ? 2.5 : 2} />}
        label={t('tb.select')}
        shortcut="S"
        active={mode === 'select'}
        disabled={!hasPdf}
        onClick={() => setMode(mode === 'select' ? 'idle' : 'select')}
      />

      <Separator orientation="vertical" className="mx-1 h-6 shrink-0" />

      {/* Quick-fill cluster */}
      <ToolbarBtn
        icon={<Calendar className="size-4" />}
        label={t('tb.insert_date')}
        shortcut="I"
        disabled={!hasPdf}
        onClick={() => {
          const now = Date.now()
          setPendingTextValue(formatDate(now, undefined))
          setPendingDateMs(now)
          setMode('text')
        }}
      />
      <ToolbarBtn
        icon={<User className={cn('size-4', props.profileDialogOpen && 'size-5')} strokeWidth={props.profileDialogOpen ? 2.5 : 2} />}
        label={t('tb.profile')}
        shortcut="P"
        active={props.profileDialogOpen}
        onClick={props.onOpenProfile}
      />

      {renderTextControls(false)}

      <Separator orientation="vertical" className="mx-1 h-6 shrink-0" />

      {/* History cluster */}
      <ToolbarBtn
        icon={<Undo2 className="size-4" />}
        label={t('tb.undo')}
        shortcut={`${cmd}+Z`}
        disabled={!hasPdf || !hasAnnotations}
        onClick={undoAnnotation}
      />
      <ToolbarBtn
        icon={<Eraser className="size-4" />}
        label={t('tb.clear_all')}
        disabled={!hasPdf || !hasAnnotations}
        onClick={() => {
          if (confirm(t('confirm.clear_annotations'))) clearAnnotations()
        }}
      />

      {/* Spacer pushes Zoom/Lang/Theme/Download to the right on ≥sm.
          Hidden on mobile because the toolbar scrolls horizontally there. */}
      <div className="hidden flex-1 sm:block" />

      {/* Zoom cluster */}
      <div className="flex shrink-0 items-center gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              disabled={!hasPdf || zoom <= 0.25}
              onClick={() => setZoom(zoom - 0.25)}
              aria-label={t('tb.zoom_out')}
              className="h-10 shrink-0 sm:h-8"
            >
              <ZoomOut className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t('tb.zoom_out')}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              disabled={!hasPdf}
              onClick={() => setZoom(1)}
              className="h-10 min-w-12 shrink-0 rounded px-2 font-mono text-xs tabular-nums text-muted-foreground hover:text-foreground disabled:opacity-50 sm:h-8"
            >
              {formatPercent(lang, zoom)}
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t('tb.reset_zoom')}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              disabled={!hasPdf || zoom >= 4}
              onClick={() => setZoom(zoom + 0.25)}
              aria-label={t('tb.zoom_in')}
              className="h-10 shrink-0 sm:h-8"
            >
              <ZoomIn className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom">{t('tb.zoom_in')}</TooltipContent>
        </Tooltip>
      </div>

      <Separator orientation="vertical" className="mx-1 h-6 shrink-0" />

      <LanguagePicker />
      <ThemeToggle />
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            aria-label={t('tb.help')}
            onClick={props.onOpenHelp}
            className="h-10 shrink-0 sm:h-8"
          >
            <HelpCircle className="size-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t('tb.help')}</TooltipContent>
      </Tooltip>

      {/* Download split-button: clicking the main label downloads with
          current settings; the chevron opens a popover with the "Make
          smaller" toggle. The toggle persists across downloads in this
          session via local component state — there's no need to round-trip
          through the store. */}
      <div className="flex shrink-0 items-center">
        <Button
          variant="default"
          size="sm"
          disabled={!hasPdf}
          onClick={() => props.onDownload({ compress: compressOnDownload, level: compressLevel })}
          aria-label={t('tb.download')}
          className="h-10 rounded-r-none px-3 sm:h-8"
        >
          <Download className="size-4" />
          <span className="ms-1.5">{t('tb.download')}</span>
        </Button>
        <Popover open={downloadOptsOpen} onOpenChange={setDownloadOptsOpen}>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button
                  variant="default"
                  size="sm"
                  disabled={!hasPdf}
                  aria-label={t('tb.download_options')}
                  className="h-10 rounded-l-none border-l border-primary-foreground/20 px-1.5 sm:h-8"
                >
                  <ChevronDown className="size-4" />
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent side="bottom">{t('tb.download_options')}</TooltipContent>
          </Tooltip>
          <PopoverContent className="w-72 space-y-3 p-3" align="end">
            <label className="flex cursor-pointer items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={compressOnDownload}
                onChange={(e) => setCompressOnDownload(e.target.checked)}
                className="mt-1 size-4 shrink-0 cursor-pointer accent-primary"
              />
              <span>
                <span className="font-medium">{t('tb.compress_pdf')}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {t('tb.compress_hint')}
                </span>
              </span>
            </label>
            <div className={cn('space-y-1.5', !compressOnDownload && 'pointer-events-none opacity-40')}>
              <div className="text-xs font-medium">{t('tb.compress_level')}</div>
              <Select
                value={compressLevel}
                onValueChange={(v) => setCompressLevel(v as CompressionLevel)}
              >
                <SelectTrigger
                  size="sm"
                  className="w-full"
                  disabled={!compressOnDownload}
                  aria-label={t('tb.compress_level')}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">
                    <span className="font-medium">{t('tb.compress_low')}</span>
                    <span className="ms-2 text-xs text-muted-foreground">200 DPI</span>
                  </SelectItem>
                  <SelectItem value="mid">
                    <span className="font-medium">{t('tb.compress_mid')}</span>
                    <span className="ms-2 text-xs text-muted-foreground">150 DPI</span>
                  </SelectItem>
                  <SelectItem value="high">
                    <span className="font-medium">{t('tb.compress_high')}</span>
                    <span className="ms-2 text-xs text-muted-foreground">96 DPI</span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </header>
  )
}
