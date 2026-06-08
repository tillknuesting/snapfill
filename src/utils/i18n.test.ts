import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  detectLang,
  isRTL,
  persistLang,
  translate,
  LANGS,
  TRANSLATION_KEYS,
  ownTranslationsForTest,
  type Lang,
} from './i18n'

const STORAGE_KEY = 'pdfhelper.lang'

describe('translate — fallback chain', () => {
  it('returns the language-specific string when present', () => {
    expect(translate('tb.open', 'de')).toBe('PDF öffnen')
    expect(translate('tb.open', 'fr')).toBe('Ouvrir un PDF')
    expect(translate('tb.open', 'es')).toBe('Abrir PDF')
  })

  it('falls back to English when the language has no entry for that key', () => {
    // No language has '__missing__' — translate should fall back to English's
    // entry, and if even English is missing, return the key as-is.
    expect(translate('__missing__', 'de')).toBe('__missing__')
  })

  it('returns the English string when the lang is unknown', () => {
    expect(translate('tb.download', 'xx' as unknown as Lang)).toBe('Download')
  })
})

describe('detectLang', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns the stored value when set', () => {
    localStorage.setItem(STORAGE_KEY, 'fr')
    expect(detectLang()).toBe('fr')
  })

  it('falls back to navigator.language', () => {
    localStorage.removeItem(STORAGE_KEY)
    Object.defineProperty(navigator, 'language', { value: 'de-DE', configurable: true })
    expect(detectLang()).toBe('de')
  })

  it('returns English for unsupported browser locales', () => {
    localStorage.removeItem(STORAGE_KEY)
    // Unsupported locale — must fall back to English.
    Object.defineProperty(navigator, 'language', { value: 'nl-NL', configurable: true })
    expect(detectLang()).toBe('en')
  })

  it('detects Chinese (zh-CN → zh) and Japanese (ja-JP → ja)', () => {
    localStorage.removeItem(STORAGE_KEY)
    Object.defineProperty(navigator, 'language', { value: 'zh-CN', configurable: true })
    expect(detectLang()).toBe('zh')
    Object.defineProperty(navigator, 'language', { value: 'ja-JP', configurable: true })
    expect(detectLang()).toBe('ja')
  })

  it('detects each of the top-10 spoken languages from its browser locale', () => {
    const cases: Array<[string, Lang]> = [
      ['hi-IN', 'hi'],
      ['ar-SA', 'ar'],
      ['bn-BD', 'bn'],
      ['ru-RU', 'ru'],
      ['pt-BR', 'pt'],
      ['pt-PT', 'pt'],
      ['id-ID', 'id'],
    ]
    for (const [locale, expected] of cases) {
      localStorage.removeItem(STORAGE_KEY)
      Object.defineProperty(navigator, 'language', { value: locale, configurable: true })
      expect(detectLang(), `expected ${locale} → ${expected}`).toBe(expected)
    }
  })

  it('detects added high-value non-English markets from browser locale', () => {
    const cases: Array<[string, Lang]> = [
      ['tr-TR', 'tr'],
      ['vi-VN', 'vi'],
      ['th-TH', 'th'],
      ['ko-KR', 'ko'],
      ['it-IT', 'it'],
    ]
    for (const [locale, expected] of cases) {
      localStorage.removeItem(STORAGE_KEY)
      Object.defineProperty(navigator, 'language', { value: locale, configurable: true })
      expect(detectLang(), `expected ${locale} → ${expected}`).toBe(expected)
    }
  })
})

describe('isRTL', () => {
  it('flags Arabic as right-to-left', () => {
    expect(isRTL('ar')).toBe(true)
  })
  it('treats every other supported language as left-to-right', () => {
    for (const { code } of LANGS.filter((l) => l.code !== 'ar')) {
      expect(isRTL(code), code).toBe(false)
    }
  })

  it('ignores a stored value that is not in the supported list', () => {
    localStorage.setItem(STORAGE_KEY, 'pirate')
    Object.defineProperty(navigator, 'language', { value: 'es-MX', configurable: true })
    expect(detectLang()).toBe('es')
  })
})

describe('persistLang', () => {
  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY)
  })

  it('writes the chosen language to localStorage', () => {
    persistLang('fr')
    expect(localStorage.getItem(STORAGE_KEY)).toBe('fr')
  })

  it('round-trips through detectLang', () => {
    persistLang('de')
    expect(detectLang()).toBe('de')
  })
})

describe('LANGS catalog', () => {
  it('exposes a unique code per language', () => {
    const codes = LANGS.map((l) => l.code)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('has at least one bundled UI language beyond English', () => {
    expect(LANGS.length).toBeGreaterThan(1)
    expect(LANGS.find((l) => l.code === 'en')).toBeDefined()
  })

  it('keeps complete translations aligned with the English template', () => {
    const fullyTranslated: Lang[] = ['en', 'de', 'tr', 'vi', 'th', 'ko', 'it']
    for (const code of fullyTranslated) {
      const own = ownTranslationsForTest(code)
      const missing = TRANSLATION_KEYS.filter((k) => !own[k]?.trim())
      expect(missing, `${code} missing translations`).toEqual([])
    }
  })

  it('keeps every translated language in the picker catalog', () => {
    const codes = new Set(LANGS.map((l) => l.code))
    for (const code of ['en', 'de', 'tr', 'vi', 'th', 'ko', 'it'] satisfies Lang[]) {
      expect(codes.has(code), code).toBe(true)
    }
  })
})
