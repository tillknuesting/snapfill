import { Image as ImageIcon, MousePointer2, Pencil, PenLine, RectangleHorizontal, TextCursorInput, Type, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { usePdfStore } from '@/store/usePdfStore'
import { useT } from '@/utils/useT'
import type { Mode } from '@/types'

// Keyed by every non-idle mode so adding a new mode is a compile error here
// (the audit caught a missing 'edit' entry under the previous loose typing).
type BannerMeta = { icon: typeof Type; labelKey: string; helpKey: string }
const MESSAGES: Record<Exclude<Mode, 'idle'>, BannerMeta> = {
  text:      { icon: Type,             labelKey: 'mb.text.label',      helpKey: 'mb.text.help' },
  signature: { icon: PenLine,          labelKey: 'mb.signature.label', helpKey: 'mb.signature.help' },
  select:    { icon: MousePointer2,    labelKey: 'mb.select.label',    helpKey: 'mb.select.help' },
  draw:      { icon: Pencil,           labelKey: 'mb.draw.label',      helpKey: 'mb.draw.help' },
  image:     { icon: ImageIcon,        labelKey: 'mb.image.label',     helpKey: 'mb.image.help' },
  edit:      { icon: TextCursorInput,  labelKey: 'mb.edit.label',      helpKey: 'mb.edit.help' },
  redact:    { icon: RectangleHorizontal, labelKey: 'mb.redact.label', helpKey: 'mb.redact.help' },
}

export function ModeBanner() {
  const t = useT()
  const mode = usePdfStore((s) => s.mode)
  const setMode = usePdfStore((s) => s.setMode)
  if (mode === 'idle') return null
  const cfg = MESSAGES[mode]
  const Icon = cfg.icon
  return (
    <div className="anim-slide-down flex min-h-10 items-center gap-2 border-b bg-primary px-2 py-1 text-xs text-primary-foreground sm:gap-3 sm:px-4 sm:py-1.5 sm:text-sm">
      <Icon className="size-4 shrink-0" />
      <span className="shrink-0 font-semibold">{t(cfg.labelKey)}</span>
      <span className="hidden min-w-0 flex-1 truncate opacity-80 sm:inline">
        {t(cfg.helpKey)}
      </span>
      <span className="ms-2 hidden rounded-sm border border-primary-foreground/30 px-1.5 py-0.5 text-[10px] uppercase tracking-wider opacity-80 sm:inline-block">
        {t('mb.esc')}
      </span>
      <div className="flex-1 sm:hidden" />
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setMode('idle')}
        aria-label={t('mb.exit')}
        className="h-8 w-8 gap-1 px-0 text-primary-foreground hover:bg-primary-foreground/15 hover:text-primary-foreground sm:h-7 sm:w-auto sm:px-2"
      >
        <X className="size-3.5" />
        <span className="hidden sm:inline">{t('mb.exit')}</span>
      </Button>
    </div>
  )
}
