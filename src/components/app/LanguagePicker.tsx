import { Globe } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { usePdfStore } from '@/store/usePdfStore'
import { useT } from '@/utils/useT'
import { LANGS, type Lang } from '@/utils/i18n'
import { cn } from '@/lib/utils'

// Globe button + popover language picker. Shows the current language code
// next to the icon (e.g. "EN", "DE") so the user can see at a glance.
export function LanguagePicker() {
  const lang = usePdfStore((s) => s.lang)
  const setLang = usePdfStore((s) => s.setLang)
  const t = useT()
  const current = LANGS.find((l) => l.code === lang) ?? LANGS[0]

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              aria-label={t('tb.lang')}
              data-testid="lang-button"
              className="h-10 shrink-0 gap-1.5 sm:h-8"
            >
              <Globe className="size-4" />
              <span className="font-mono text-[10px] uppercase tracking-wider">
                {current.code}
              </span>
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t('tb.lang')}</TooltipContent>
      </Tooltip>
      <PopoverContent className="w-44 p-1" align="end">
        <ul role="listbox" aria-label={t('tb.lang')}>
          {LANGS.map((l) => (
            <li key={l.code}>
              <button
                type="button"
                role="option"
                aria-selected={l.code === lang}
                onClick={() => setLang(l.code as Lang)}
                data-testid={`lang-option-${l.code}`}
                className={cn(
                  'flex w-full items-center justify-between rounded px-2 py-1.5 text-sm hover:bg-accent',
                  l.code === lang && 'bg-accent font-medium',
                )}
              >
                <span>{l.label}</span>
                <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {l.code}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
