// Named theme presets. Each theme is a CSS class applied to <html>; the
// dark-style ones also carry the existing `.dark` class so Tailwind's
// `dark:` utilities flip correctly. "system" follows the OS preference.

export type Theme =
  | 'system'
  | 'light'
  | 'dark'
  | 'sepia'
  | 'solarized-light'
  | 'gruvbox-light'
  | 'catppuccin-latte'
  | 'github-light'
  | 'hc'
  | 'solarized'
  | 'dracula'
  | 'nord'
  | 'gruvbox'
  | 'catppuccin'
  | 'tokyo'

export interface ThemeMeta {
  code: Theme
  // i18n key for the visible label in the picker.
  labelKey: string
  // CSS class added to <html>. Empty = light default (no extra class).
  cssClass: string
  // Whether to also add `.dark` so Tailwind dark: utilities flip.
  isDark: boolean
}

export const THEMES: ThemeMeta[] = [
  { code: 'system',    labelKey: 'theme.system',    cssClass: '',                isDark: false /* resolved at runtime */ },
  { code: 'light',     labelKey: 'theme.light',     cssClass: '',                isDark: false },
  { code: 'dark',      labelKey: 'theme.dark',      cssClass: '',                isDark: true  },
  { code: 'sepia',     labelKey: 'theme.sepia',     cssClass: 'theme-sepia',     isDark: false },
  { code: 'solarized-light', labelKey: 'theme.solarized_light', cssClass: 'theme-solarized-light', isDark: false },
  { code: 'gruvbox-light', labelKey: 'theme.gruvbox_light', cssClass: 'theme-gruvbox-light', isDark: false },
  { code: 'catppuccin-latte', labelKey: 'theme.catppuccin_latte', cssClass: 'theme-catppuccin-latte', isDark: false },
  { code: 'github-light', labelKey: 'theme.github_light', cssClass: 'theme-github-light', isDark: false },
  { code: 'hc',        labelKey: 'theme.hc',        cssClass: 'theme-hc',        isDark: true  },
  { code: 'solarized', labelKey: 'theme.solarized', cssClass: 'theme-solarized', isDark: true  },
  { code: 'dracula',   labelKey: 'theme.dracula',   cssClass: 'theme-dracula',   isDark: true  },
  { code: 'nord',      labelKey: 'theme.nord',      cssClass: 'theme-nord',      isDark: true  },
  { code: 'gruvbox',   labelKey: 'theme.gruvbox',   cssClass: 'theme-gruvbox',   isDark: true  },
  { code: 'catppuccin', labelKey: 'theme.catppuccin', cssClass: 'theme-catppuccin', isDark: true },
  { code: 'tokyo',     labelKey: 'theme.tokyo',     cssClass: 'theme-tokyo',     isDark: true  },
]

const STORAGE_KEY = 'pdfhelper.theme'
const ALL_CLASSES = THEMES.map((t) => t.cssClass).filter(Boolean)

function osPrefersDark(): boolean {
  return typeof window !== 'undefined'
    && window.matchMedia('(prefers-color-scheme: dark)').matches
}

// Read what the user last chose (or "system" by default).
export function readStoredTheme(): Theme {
  try {
    const v = localStorage.getItem(STORAGE_KEY) as Theme | null
    if (v && THEMES.find((t) => t.code === v)) return v
  } catch { /* ignore */ }
  return 'system'
}

export function persistTheme(theme: Theme) {
  try { localStorage.setItem(STORAGE_KEY, theme) } catch { /* ignore */ }
}

// Apply the chosen theme to the document. "system" resolves to either
// 'light' or 'dark' depending on the OS preference.
export function applyTheme(theme: Theme) {
  const root = document.documentElement
  for (const cls of ALL_CLASSES) root.classList.remove(cls)
  root.classList.remove('dark')
  const resolved: Theme = theme === 'system' ? (osPrefersDark() ? 'dark' : 'light') : theme
  const meta = THEMES.find((t) => t.code === resolved)
  if (!meta) return
  if (meta.cssClass) root.classList.add(meta.cssClass)
  if (meta.isDark) root.classList.add('dark')
}

// Resolve "system" → concrete theme; otherwise return the chosen theme.
// Useful for components that want to render an icon or label based on the
// effective theme.
export function resolveTheme(theme: Theme): Exclude<Theme, 'system'> {
  if (theme === 'system') return osPrefersDark() ? 'dark' : 'light'
  return theme
}
