import type { PageNumberSettings } from '@/types'

export const DEFAULT_PAGE_NUMBERS: PageNumberSettings = {
  enabled: false,
  format: 'page-of-total',
  position: 'bottom-center',
  startAt: 1,
  fontSize: 10,
  color: '#0a1f3d',
  margin: 28,
}

export function normalizePageNumbers(
  pageNumbers: Partial<PageNumberSettings> | null | undefined,
): PageNumberSettings {
  const merged = { ...DEFAULT_PAGE_NUMBERS, ...(pageNumbers ?? {}) }
  return {
    enabled: !!merged.enabled,
    format: isFormat(merged.format) ? merged.format : DEFAULT_PAGE_NUMBERS.format,
    position: isPosition(merged.position) ? merged.position : DEFAULT_PAGE_NUMBERS.position,
    startAt: Math.round(clampNumber(merged.startAt, 0, 9999, DEFAULT_PAGE_NUMBERS.startAt)),
    fontSize: clampNumber(merged.fontSize, 6, 48, DEFAULT_PAGE_NUMBERS.fontSize),
    color: /^#[0-9a-f]{6}$/i.test(merged.color) ? merged.color : DEFAULT_PAGE_NUMBERS.color,
    margin: clampNumber(merged.margin, 8, 144, DEFAULT_PAGE_NUMBERS.margin),
  }
}

export function pageNumbersAreVisible(pageNumbers: PageNumberSettings): boolean {
  return pageNumbers.enabled
}

export function formatPageNumber(
  pageNumbers: PageNumberSettings,
  pageIdx: number,
  totalPages: number,
): string {
  const n = pageNumbers.startAt + pageIdx
  if (pageNumbers.format === 'number') return String(n)
  if (pageNumbers.format === 'page') return `Page ${n}`
  return `Page ${n} of ${pageNumbers.startAt + totalPages - 1}`
}

function isFormat(value: unknown): value is PageNumberSettings['format'] {
  return value === 'page' || value === 'page-of-total' || value === 'number'
}

function isPosition(value: unknown): value is PageNumberSettings['position'] {
  return (
    value === 'bottom-center' ||
    value === 'bottom-right' ||
    value === 'bottom-left' ||
    value === 'top-center' ||
    value === 'top-right' ||
    value === 'top-left'
  )
}

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}
