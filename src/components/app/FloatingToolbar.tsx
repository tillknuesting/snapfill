import { useEffect, useState, type RefObject } from 'react'
import { Bold, Calendar, Italic, Trash2, Underline } from 'lucide-react'
import { Toggle } from '@/components/ui/toggle'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Slider } from '@/components/ui/slider'
import { DATE_FORMAT_OPTIONS, findDateFormatId } from '@/utils/dateFormats'

interface PenSettings {
  color: string
  opacity: number
  width: number
  onChange: (patch: { color?: string; opacity?: number; width?: number }) => void
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
  { value: '#0a1f3d', label: 'Black' },
  { value: '#1d4ed8', label: 'Blue' },
  { value: '#dc2626', label: 'Red' },
  { value: '#16a34a', label: 'Green' },
  { value: '#facc15', label: 'Yellow' },
]

interface PenControlsProps {
  value: { color: string; opacity: number; width: number }
  onChange: (patch: { color?: string; opacity?: number; width?: number }) => void
}

export function PenControls({ value, onChange }: PenControlsProps) {
  return (
    <>
      <div>
        <div className="mb-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">Color</div>
        <div className="flex gap-1.5">
          {PEN_COLORS.map((c) => (
            <button
              key={c.value}
              type="button"
              onClick={() => onChange({ color: c.value })}
              title={c.label}
              className={`size-6 rounded-full border-2 ${value.color === c.value ? 'border-primary ring-2 ring-primary/20' : 'border-border'}`}
              style={{ background: c.value }}
            />
          ))}
        </div>
      </div>
      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Width</span>
          <span className="text-xs tabular-nums">{value.width.toFixed(1)} pt</span>
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
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Opacity</span>
          <span className="text-xs tabular-nums">{Math.round(value.opacity * 100)}%</span>
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
          <Toggle size="sm" pressed={active('bold')} onPressedChange={() => exec('bold')} aria-label="Bold" onMouseDown={keepEditorFocus}>
            <Bold className="size-4" />
          </Toggle>
          <Toggle size="sm" pressed={active('italic')} onPressedChange={() => exec('italic')} aria-label="Italic" onMouseDown={keepEditorFocus}>
            <Italic className="size-4" />
          </Toggle>
          <Toggle size="sm" pressed={active('underline')} onPressedChange={() => exec('underline')} aria-label="Underline" onMouseDown={keepEditorFocus}>
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
                <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>
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
                <span className="text-xs tabular-nums">{pen.width.toFixed(1)} pt</span>
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
          aria-label="Delete"
        >
          <Trash2 className="size-4" />
          Delete
        </Button>
      )}
    </div>
  )
}
