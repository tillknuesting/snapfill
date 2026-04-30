// Locale options for the date stamp's "format" picker. Each maps to a BCP47
// locale tag whose default toLocaleDateString() output matches the label.
export interface DateFormatOption {
  id: string
  label: string
  short: string  // compact label used in the floating toolbar
  locale: string | undefined  // undefined = system default
}

export const DATE_FORMAT_OPTIONS: DateFormatOption[] = [
  { id: 'system', label: 'System default',         short: 'System',  locale: undefined },
  { id: 'us',     label: 'US — M/D/YYYY',          short: 'M/D/Y',   locale: 'en-US' },
  { id: 'uk',     label: 'UK — D/M/YYYY',          short: 'D/M/Y',   locale: 'en-GB' },
  { id: 'de',     label: 'DE — D.M.YYYY',          short: 'D.M.Y',   locale: 'de-DE' },
  { id: 'iso',    label: 'ISO — YYYY-MM-DD',       short: 'Y-M-D',   locale: 'sv-SE' },
]

export function formatDate(ms: number, locale: string | undefined): string {
  return new Date(ms).toLocaleDateString(locale)
}

export function findDateFormatId(locale: string | undefined): string {
  return DATE_FORMAT_OPTIONS.find((o) => o.locale === locale)?.id ?? 'system'
}
