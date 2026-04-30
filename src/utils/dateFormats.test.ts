import { describe, expect, it } from 'vitest'
import { DATE_FORMAT_OPTIONS, findDateFormatId, formatDate } from './dateFormats'

const SAMPLE_MS = Date.UTC(2026, 0, 15, 12, 0, 0)  // Jan 15, 2026 midday UTC

describe('DATE_FORMAT_OPTIONS', () => {
  it('always includes a System default with no locale', () => {
    const sys = DATE_FORMAT_OPTIONS.find((o) => o.id === 'system')
    expect(sys).toBeDefined()
    expect(sys!.locale).toBeUndefined()
  })

  it('has unique ids', () => {
    const ids = DATE_FORMAT_OPTIONS.map((o) => o.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('formatDate', () => {
  it('produces locale-specific output', () => {
    expect(formatDate(SAMPLE_MS, 'en-US')).toMatch(/1\/15\/2026/)
    // en-GB and de-DE both place day first; allow either / or .
    expect(formatDate(SAMPLE_MS, 'en-GB')).toMatch(/15\/0?1\/2026/)
    expect(formatDate(SAMPLE_MS, 'de-DE')).toMatch(/15\.0?1\.2026/)
    expect(formatDate(SAMPLE_MS, 'sv-SE')).toMatch(/2026-0?1-15/)
  })

  it('falls back to system locale when undefined', () => {
    const out = formatDate(SAMPLE_MS, undefined)
    expect(out).toBeTruthy()
    expect(out).toContain('2026')
  })
})

describe('findDateFormatId', () => {
  it('matches each option by locale', () => {
    for (const opt of DATE_FORMAT_OPTIONS) {
      expect(findDateFormatId(opt.locale)).toBe(opt.id)
    }
  })

  it('falls back to system for unknown locales', () => {
    expect(findDateFormatId('xx-YY')).toBe('system')
  })
})
