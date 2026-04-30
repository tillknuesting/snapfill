import { useCallback } from 'react'
import { usePdfStore } from '@/store/usePdfStore'
import { translate } from './i18n'

// Hook that returns a `t(key)` function bound to the current language. The
// language is read from the zustand store, so changing it via setLang will
// re-render any component that called useT() without manual wiring.
export function useT() {
  const lang = usePdfStore((s) => s.lang)
  const t = useCallback((key: string) => translate(key, lang), [lang])
  return t
}
