// Type-only import: we never call into pdf-lib from this file. Going value-
// import here would pull all of pdf-lib into the initial bundle because
// fonts.ts is imported by many UI files. The actual font embedding happens
// in buildPdf.ts (lazy-loaded at download time).
import type { StandardFonts } from 'pdf-lib'
import type { FontFamily } from '@/types'

export interface FontFamilyInfo {
  label: string
  css: string
  std: {
    regular: keyof typeof StandardFonts
    bold: keyof typeof StandardFonts
    italic: keyof typeof StandardFonts
    boldItalic: keyof typeof StandardFonts
  }
}

export const FONT_FAMILIES: Record<FontFamily, FontFamilyInfo> = {
  helvetica: {
    label: 'Helvetica',
    css: 'Helvetica, Arial, sans-serif',
    std: {
      regular: 'Helvetica',
      bold: 'HelveticaBold',
      italic: 'HelveticaOblique',
      boldItalic: 'HelveticaBoldOblique',
    },
  },
  times: {
    label: 'Times Roman',
    css: 'Georgia, "Times New Roman", Times, serif',
    std: {
      regular: 'TimesRoman',
      bold: 'TimesRomanBold',
      italic: 'TimesRomanItalic',
      boldItalic: 'TimesRomanBoldItalic',
    },
  },
  courier: {
    label: 'Courier',
    css: 'ui-monospace, Menlo, Consolas, monospace',
    std: {
      regular: 'Courier',
      bold: 'CourierBold',
      italic: 'CourierOblique',
      boldItalic: 'CourierBoldOblique',
    },
  },
}

export const FAMILY_OPTIONS: Array<{ id: FontFamily; label: string }> =
  (Object.keys(FONT_FAMILIES) as FontFamily[]).map((id) => ({
    id, label: FONT_FAMILIES[id].label,
  }))

export function pdfFontIdFor(
  family: FontFamily,
  bold: boolean,
  italic: boolean,
): keyof typeof StandardFonts {
  const v = FONT_FAMILIES[family].std
  if (bold && italic) return v.boldItalic
  if (bold) return v.bold
  if (italic) return v.italic
  return v.regular
}

// Migrate stored values that may use older identifiers (legacy single-file
// build used 'sans'/'serif'/'mono' or compound 'helvB' etc.).
export function normalizeFamily(id: string | undefined): FontFamily {
  if (!id) return 'helvetica'
  const lower = id.toLowerCase()
  if (lower.startsWith('helv') || lower === 'sans') return 'helvetica'
  if (lower.startsWith('times') || lower === 'serif') return 'times'
  if (lower.startsWith('cour') || lower === 'mono') return 'courier'
  return id in FONT_FAMILIES ? (id as FontFamily) : 'helvetica'
}

export const HANDWRITING_FONTS = [
  'Architects Daughter',
  'Caveat',
  'Coming Soon',
  'Homemade Apple',
  'Indie Flower',
  'Just Another Hand',
  'Kalam',
  'Patrick Hand',
  'Reenie Beanie',
  'Shadows Into Light',
] as const

export type HandwritingFont = (typeof HANDWRITING_FONTS)[number]
