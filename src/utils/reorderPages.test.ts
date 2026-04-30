import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { reorderPdfPages } from './reorderPages'

async function buildBlankPdf(widths: number[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  for (const w of widths) doc.addPage([w, 100])
  return await doc.save()
}

describe('reorderPdfPages', () => {
  it('rearranges pages according to the supplied permutation', async () => {
    const src = await buildBlankPdf([200, 201, 202, 203])
    const out = await reorderPdfPages(src, [3, 0, 2, 1])
    const doc = await PDFDocument.load(out)
    const widths = doc.getPages().map((p) => Math.round(p.getWidth()))
    expect(widths).toEqual([203, 200, 202, 201])
  })

  it('is the identity when newOrder is sequential', async () => {
    const src = await buildBlankPdf([200, 201, 202])
    const out = await reorderPdfPages(src, [0, 1, 2])
    const doc = await PDFDocument.load(out)
    const widths = doc.getPages().map((p) => Math.round(p.getWidth()))
    expect(widths).toEqual([200, 201, 202])
  })

  it('throws on a non-permutation (duplicates)', async () => {
    const src = await buildBlankPdf([200, 201, 202])
    await expect(reorderPdfPages(src, [0, 0, 2])).rejects.toThrow(/invalid order/i)
  })

  it('throws on a non-permutation (out of range)', async () => {
    const src = await buildBlankPdf([200, 201])
    await expect(reorderPdfPages(src, [0, 5])).rejects.toThrow(/invalid order/i)
  })

  it('throws when the order length does not match the page count', async () => {
    const src = await buildBlankPdf([200, 201, 202])
    await expect(reorderPdfPages(src, [0, 1])).rejects.toThrow(/page count/i)
  })
})
