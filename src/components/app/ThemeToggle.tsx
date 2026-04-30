import { useEffect, useState } from 'react'
import { Monitor, Moon, Palette, Sun } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useT } from '@/utils/useT'
import {
  applyTheme, persistTheme, readStoredTheme, resolveTheme, THEMES, type Theme,
} from '@/utils/themes'
import { cn } from '@/lib/utils'

// Theme picker — popover with the seven presets (System / Light / Dark /
// Sepia / High Contrast / Solarized / Dracula). Shows an icon that reflects
// the *resolved* theme (Sun / Moon / Palette) so the trigger stays
// recognisable regardless of which named theme is active.
export function ThemeToggle() {
  const t = useT()
  const [theme, setTheme] = useState<Theme>(readStoredTheme)

  useEffect(() => {
    applyTheme(theme)
    persistTheme(theme)
  }, [theme])

  // While in 'system' mode, follow OS-preference changes live.
  useEffect(() => {
    if (theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyTheme('system')
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [theme])

  const resolved = resolveTheme(theme)
  const Icon =
    theme === 'system' ? Monitor :
    resolved === 'dark' || ['hc', 'solarized', 'dracula'].includes(resolved) ? Moon :
    resolved === 'sepia' ? Palette :
    Sun

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              aria-label={t('tb.theme')}
              data-testid="theme-button"
              className="h-10 shrink-0 sm:h-8"
            >
              <Icon className="size-4" />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">{t('tb.theme')}</TooltipContent>
      </Tooltip>
      <PopoverContent className="w-44 p-1" align="end">
        <ul role="listbox" aria-label={t('tb.theme')}>
          {THEMES.map((th) => (
            <li key={th.code}>
              <button
                type="button"
                role="option"
                aria-selected={th.code === theme}
                onClick={() => setTheme(th.code)}
                data-testid={`theme-option-${th.code}`}
                className={cn(
                  'flex w-full items-center justify-between rounded px-2 py-1.5 text-sm hover:bg-accent',
                  th.code === theme && 'bg-accent font-medium',
                )}
              >
                <span>{t(th.labelKey)}</span>
              </button>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
