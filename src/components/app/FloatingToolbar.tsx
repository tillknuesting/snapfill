import { useEffect, useState, type ComponentType, type RefObject } from 'react'
import { ArrowRight, Bold, Calendar, Eraser, Highlighter, Italic, Minus, Pencil, SquarePen, Trash2, Underline } from 'lucide-react'
import { Toggle } from '@/components/ui/toggle'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Slider } from '@/components/ui/slider'
import { DATE_FORMAT_OPTIONS, findDateFormatId } from '@/utils/dateFormats'
import { useT } from '@/utils/useT'
import { formatNumber, formatPercent } from '@/utils/i18n'
import { usePdfStore } from '@/store/usePdfStore'
import type { DrawingTool } from '@/types'

interface PenSettings {
  color: string
  opacity: number
  width: number
  tool?: DrawingTool
  onChange: (patch: { color?: string; opacity?: number; width?: number; tool?: DrawingTool }) => void
}

interface FloatingToolbarProps {
  anchorLeft: number
  anchorTop: number
  richText?: {
    editorRef: RefObject<HTMLDivElement | null>
    onCommandApplied: () => void
  }
  date?: {
    locale: string | undefined
    onChange: (locale: string | undefined) => void
  }
  pen?: PenSettings
  // Optional: omit to render a controls-only toolbar (e.g. the date picker
  // on a focused date annotation in idle mode, where deletion isn't
  // appropriate — the user is still typing-mode interacting with the box).
  onDelete?: () => void
}

export const PEN_COLORS = [
  { value: '#0a1f3d', labelKey: 'color.black' },
  { value: '#1d4ed8', labelKey: 'color.blue' },
  { value: '#dc2626', labelKey: 'color.red' },
  { value: '#16a34a', labelKey: 'color.green' },
  { value: '#facc15', labelKey: 'color.yellow' },
]

interface PenControlsProps {
  value: { color: string; opacity: number; width: number; tool?: DrawingTool }
  onChange: (patch: { color?: string; opacity?: number; width?: number; tool?: DrawingTool }) => void
  showTools?: boolean
  showPresets?: boolean
}

const DRAWING_TOOLS: Array<{
  id: DrawingTool
  labelKey: string
  icon: ComponentType<{ className?: string }>
  patch: { color?: string; opacity?: number; width?: number; tool: DrawingTool }
}> = [
  { id: 'pen', labelKey: 'draw.tool.pen', icon: Pencil, patch: { tool: 'pen', color: '#0a1f3d', opacity: 1, width: 2 } },
  { id: 'marker', labelKey: 'draw.tool.marker', icon: SquarePen, patch: { tool: 'marker', color: '#1d4ed8', opacity: 0.85, width: 4 } },
  { id: 'highlighter', labelKey: 'draw.tool.highlighter', icon: Highlighter, patch: { tool: 'highlighter', color: '#facc15', opacity: 0.35, width: 10 } },
  { id: 'line', labelKey: 'draw.tool.line', icon: Minus, patch: { tool: 'line' } },
  { id: 'arrow', labelKey: 'draw.tool.arrow', icon: ArrowRight, patch: { tool: 'arrow' } },
  { id: 'eraser', labelKey: 'draw.tool.eraser', icon: Eraser, patch: { tool: 'eraser' } },
]

const PEN_PRESETS = [
  { labelKey: 'draw.preset.pen', patch: { tool: 'pen' as const, color: '#0a1f3d', opacity: 1, width: 2 } },
  { labelKey: 'draw.preset.red_pen', patch: { tool: 'pen' as const, color: '#dc2626', opacity: 1, width: 2 } },
  { labelKey: 'draw.preset.marker', patch: { tool: 'marker' as const, color: '#1d4ed8', opacity: 0.85, width: 4 } },
  { labelKey: 'draw.preset.highlighter', patch: { tool: 'highlighter' as const, color: '#facc15', opacity: 0.35, width: 10 } },
]

export function PenControls({ value, onChange, showTools = false, showPresets = false }: PenControlsProps) {
  const t = useT()
  const lang = usePdfStore((s) => s.lang)
  const widthLabel = formatNumber(lang, value.width, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
  return (
    <>
      {showTools && value.tool && (
        <div>
          <div className="mb-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">{t('draw.tool')}</div>
          <div className="grid grid-cols-3 gap-1">
            {DRAWING_TOOLS.map(({ id, labelKey, icon: Icon, patch }) => (
              <Toggle
                key={id}
                size="sm"
                pressed={value.tool === id}
                onPressedChange={(pressed) => {
                  if (pressed) onChange(patch)
                }}
                aria-label={t(labelKey)}
                className="h-8 justify-start gap-1.5 px-2 text-xs"
              >
                <Icon className="size-3.5 shrink-0" />
                <span className="truncate">{t(labelKey)}</span>
              </Toggle>
            ))}
          </div>
        </div>
      )}
      {showPresets && (
        <div>
          <div className="mb-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">{t('draw.presets')}</div>
          <div className="grid grid-cols-2 gap-1">
            {PEN_PRESETS.map(({ labelKey, patch }) => (
              <Button
                key={labelKey}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onChange(patch)}
                className="h-8 justify-start gap-1.5 px-2 text-xs"
              >
                <span
                  className="size-3 rounded-full border"
                  style={{ background: patch.color, opacity: patch.opacity }}
                />
                <span className="truncate">{t(labelKey)}</span>
              </Button>
            ))}
          </div>
        </div>
      )}
      <div>
        <div className="mb-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">{t('ft.color')}</div>
        <div className="flex items-center gap-1.5">
          {PEN_COLORS.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => onChange({ color: c.value })}
              title={t(c.labelKey)}
              aria-label={t(c.labelKey)}
              className={`size-6 rounded-full border-2 ${value.color === c.value ? 'border-primary ring-2 ring-primary/20' : 'border-border'}`}
              style={{ background: c.value }}
            />
          ))}
          {/* Custom-colour input. The native <input type="color"> opens the
              OS picker — accessible, well-tested, no library needed. We
              hide the native chrome and overlay our own swatch so it
              matches the row. The wrapper handles the click without
              losing the colour-input semantics for keyboard users. */}
          <label
            title={t('ft.custom_color')}
            className={`relative size-6 cursor-pointer rounded-full border-2 ${PEN_COLORS.some((c) => c.value === value.color) ? 'border-border' : 'border-primary ring-2 ring-primary/20'}`}
            style={{
              background: 'conic-gradient(from 0deg, #f43f5e, #f59e0b, #84cc16, #06b6d4, #6366f1, #d946ef, #f43f5e)',
            }}
          >
            <input
              type="color"
              value={value.color}
              onChange={(e) => onChange({ color: e.target.value })}
              aria-label={t('ft.custom_color')}
              className="absolute inset-0 size-full cursor-pointer opacity-0"
            />
          </label>
        </div>
      </div>
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t('ft.width')}</span>
          <span className="text-xs tabular-nums">{widthLabel} pt</span>
        </div>
        <Slider
          min={0.5}
          max={12}
          step={0.5}
          value={[value.width]}
          onValueChange={(v: number[]) => onChange({ width: v[0] })}
        />
      </div>
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{t('ft.opacity')}</span>
          <span className="text-xs tabular-nums">{formatPercent(lang, value.opacity)}</span>
        </div>
        <Slider
          min={0.1}
          max={1}
          step={0.05}
          value={[value.opacity]}
          onValueChange={(v: number[]) => onChange({ opacity: v[0] })}
        />
      </div>
    </>
  )
}

export function FloatingToolbar({
  anchorLeft, anchorTop, richText, date, pen, onDelete,
}: FloatingToolbarProps) {
  const t = useT()
  const lang = usePdfStore((s) => s.lang)
  const [, force] = useState(0)

  useEffect(() => {
    if (!richText) return
    function onSel() { force((n) => n + 1) }
    document.addEventListener('selectionchange', onSel)
    return () => document.removeEventListener('selectionchange', onSel)
  }, [richText])

  function exec(cmd: 'bold' | 'italic' | 'underline') {
    if (!richText) return
    richText.editorRef.current?.focus()
    document.execCommand(cmd, false)
    richText.onCommandApplied()
  }

  const editorFocused = !!(richText?.editorRef.current && document.activeElement === richText.editorRef.current)
  const active = (cmd: 'bold' | 'italic' | 'underline') =>
    editorFocused ? document.queryCommandState(cmd) : false

  // Keep editor selection alive ONLY while clicking B/I/U toggles. Applying
  // preventDefault at the toolbar root breaks Radix popovers/selects (they
  // see `defaultPrevented` and bail, so clicking the date dropdown does
  // nothing). Pin it to the toggles that actually need editor-focus.
  const keepEditorFocus = (e: React.MouseEvent) => e.preventDefault()

  return (
    <div
      onPointerDown={(e) => e.stopPropagation()}
      style={{ position: 'absolute', left: anchorLeft, top: anchorTop }}
      className="anim-pop-in z-20 flex items-center gap-1 rounded-md border bg-popover p-1 shadow-md"
    >
      {richText && (
        <>
          <Toggle size="sm" pressed={active('bold')} onPressedChange={() => exec('bold')} aria-label={t('ft.bold')} onMouseDown={keepEditorFocus}>
            <Bold className="size-4" />
          </Toggle>
          <Toggle size="sm" pressed={active('italic')} onPressedChange={() => exec('italic')} aria-label={t('ft.italic')} onMouseDown={keepEditorFocus}>
            <Italic className="size-4" />
          </Toggle>
          <Toggle size="sm" pressed={active('underline')} onPressedChange={() => exec('underline')} aria-label={t('ft.underline')} onMouseDown={keepEditorFocus}>
            <Underline className="size-4" />
          </Toggle>
          <Separator orientation="vertical" className="mx-1 h-5" />
        </>
      )}
      {date && (
        <>
          <Calendar className="ml-1 size-4 text-muted-foreground" />
          <Select
            value={findDateFormatId(date.locale)}
            onValueChange={(v: string) => {
              const opt = DATE_FORMAT_OPTIONS.find((o) => o.id === v)
              date.onChange(opt?.locale)
            }}
          >
            <SelectTrigger
              size="sm"
              className="h-7 w-[110px] text-xs"
              // Keep the editor focused so the toolbar (which is gated on
              // editorFocused) doesn't unmount the moment the dropdown is
              // about to open. Click still fires; Radix opens normally.
              onMouseDown={keepEditorFocus}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DATE_FORMAT_OPTIONS.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.id === 'system' ? t('date.system_default') : o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Separator orientation="vertical" className="mx-1 h-5" />
        </>
      )}
      {pen && (
        <>
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2">
                <span
                  className="size-3.5 rounded-full border"
                  style={{ background: pen.color, opacity: pen.opacity }}
                />
                <span className="text-xs tabular-nums">
                  {formatNumber(lang, pen.width, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} pt
                </span>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-56 space-y-3">
              <PenControls value={pen} onChange={pen.onChange} />
            </PopoverContent>
          </Popover>
          <Separator orientation="vertical" className="mx-1 h-5" />
        </>
      )}
      {onDelete && (
        <Button
          variant="ghost"
          size="sm"
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          aria-label={t('ft.delete')}
        >
          <Trash2 className="size-4" />
          {t('ft.delete')}
        </Button>
      )}
    </div>
  )
}
