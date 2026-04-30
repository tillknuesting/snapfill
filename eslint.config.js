import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // The compiler-aware "set-state-in-effect" rule flags legitimate
      // patterns we use in several places: refreshing local state when a
      // dialog opens (`useEffect(() => { if (open) setFoo(load()) })`),
      // resetting local state when an external prop changes, and a
      // setActiveIdx call inside an IntersectionObserver callback. Each of
      // those is *correct* — the alternative is uglier branching that
      // doesn't actually avoid the cascade. Relax to a warning.
      'react-hooks/set-state-in-effect': 'warn',
    },
  },
  {
    // Vendored shadcn/ui components export variants alongside the component
    // (cva schemas etc.). That trips `react-refresh/only-export-components`,
    // which is a fast-refresh hint, not a correctness issue.
    files: ['src/components/ui/**/*.{ts,tsx}'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    // Same pattern in our FloatingToolbar (it exports the shared PenControls
    // sub-component used by both the toolbar's pen popover and the
    // floating selection toolbar). Splitting it into a separate file is a
    // refactor for another day.
    files: ['src/components/app/FloatingToolbar.tsx'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
])
