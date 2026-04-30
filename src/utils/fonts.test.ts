import { describe, expect, it } from 'vitest'
import {
  FAMILY_OPTIONS,
  FONT_FAMILIES,
  HANDWRITING_FONTS,
  normalizeFamily,
  pdfFontIdFor,
} from './fonts'

describe('normalizeFamily', () => {
  it('returns the family for a known id', () => {
    expect(normalizeFamily('helvetica')).toBe('helvetica')
    expect(normalizeFamily('times')).toBe('times')
    expect(normalizeFamily('courier')).toBe('courier')
  })

  it('migrates legacy ids', () => {
    expect(normalizeFamily('sans')).toBe('helvetica')
    expect(normalizeFamily('serif')).toBe('times')
    expect(normalizeFamily('mono')).toBe('courier')
  })

  it('migrates legacy compound ids (helvB / timesI / etc.)', () => {
    expect(normalizeFamily('helvB')).toBe('helvetica')
    expect(normalizeFamily('helvI')).toBe('helvetica')
    expect(normalizeFamily('timesB')).toBe('times')
    expect(normalizeFamily('timesI')).toBe('times')
    expect(normalizeFamily('courB')).toBe('courier')
  })

  it('falls back to helvetica for unknown / undefined / empty', () => {
    expect(normalizeFamily(undefined)).toBe('helvetica')
    expect(normalizeFamily('')).toBe('helvetica')
    expect(normalizeFamily('comic-sans')).toBe('helvetica')
  })
})

describe('pdfFontIdFor', () => {
  it('selects the regular variant by default', () => {
    expect(pdfFontIdFor('helvetica', false, false)).toBe('Helvetica')
    expect(pdfFontIdFor('times', false, false)).toBe('TimesRoman')
    expect(pdfFontIdFor('courier', false, false)).toBe('Courier')
  })

  it('selects bold-only variant', () => {
    expect(pdfFontIdFor('helvetica', true, false)).toBe('HelveticaBold')
    expect(pdfFontIdFor('times', true, false)).toBe('TimesRomanBold')
    expect(pdfFontIdFor('courier', true, false)).toBe('CourierBold')
  })

  it('selects italic-only variant', () => {
    expect(pdfFontIdFor('helvetica', false, true)).toBe('HelveticaOblique')
    expect(pdfFontIdFor('times', false, true)).toBe('TimesRomanItalic')
    expect(pdfFontIdFor('courier', false, true)).toBe('CourierOblique')
  })

  it('selects bold-italic variant', () => {
    expect(pdfFontIdFor('helvetica', true, true)).toBe('HelveticaBoldOblique')
    expect(pdfFontIdFor('times', true, true)).toBe('TimesRomanBoldItalic')
    expect(pdfFontIdFor('courier', true, true)).toBe('CourierBoldOblique')
  })
})

describe('FAMILY_OPTIONS', () => {
  it('exposes one entry per family with a label', () => {
    const familyKeys = Object.keys(FONT_FAMILIES)
    expect(FAMILY_OPTIONS).toHaveLength(familyKeys.length)
    for (const opt of FAMILY_OPTIONS) {
      expect(opt.label).toBeTruthy()
      expect(familyKeys).toContain(opt.id)
    }
  })
})

describe('HANDWRITING_FONTS', () => {
  it('contains the curated set of permissively-licensed Google Fonts', () => {
    const expected = [
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
    ]
    expect(HANDWRITING_FONTS).toHaveLength(expected.length)
    for (const f of expected) expect(HANDWRITING_FONTS).toContain(f)
  })

  it('has no duplicates', () => {
    expect(new Set(HANDWRITING_FONTS).size).toBe(HANDWRITING_FONTS.length)
  })
})
