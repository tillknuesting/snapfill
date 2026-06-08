import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { deletePdfPage } from './deletePage'

async function buildPdf(widths: number[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  for (const w of widths) doc.addPage([w, 100])
  return await doc.save()
}

describe('deletePdfPage', () => {
  it('removes the requested page and keeps the remaining page order', async () => {
    const out = await deletePdfPage(await buildPdf([200, 201, 202]), 1)
    const doc = await PDFDocument.load(out)
    const widths = doc.getPages().map((p) => Math.round(p.getWidth()))
    expect(widths).toEqual([200, 202])
  })

  it('throws when asked to delete the only page', async () => {
    await expect(deletePdfPage(await buildPdf([200]), 0)).rejects.toThrow(/only page/i)
  })

  it('throws when the page index is out of range', async () => {
    await expect(deletePdfPage(await buildPdf([200, 201]), 2)).rejects.toThrow(/out of range/i)
  })
})
