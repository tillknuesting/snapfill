import { describe, expect, it } from 'vitest'
import { PDFDocument, degrees } from 'pdf-lib'
import { rotatePdfPage } from './rotatePage'

async function buildPdf(pageCount = 2): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pageCount; i++) doc.addPage([200 + i, 100])
  return await doc.save()
}

describe('rotatePdfPage', () => {
  it('rotates the requested page clockwise', async () => {
    const out = await rotatePdfPage(await buildPdf(), 1, 'cw')
    const doc = await PDFDocument.load(out)
    expect(doc.getPage(0).getRotation().angle).toBe(0)
    expect(doc.getPage(1).getRotation().angle).toBe(90)
  })

  it('rotates counter-clockwise by wrapping to 270 degrees', async () => {
    const out = await rotatePdfPage(await buildPdf(), 0, 'ccw')
    const doc = await PDFDocument.load(out)
    expect(doc.getPage(0).getRotation().angle).toBe(270)
  })

  it('wraps existing rotation back to zero', async () => {
    const doc = await PDFDocument.create()
    const page = doc.addPage([200, 100])
    page.setRotation(degrees(270))
    const out = await rotatePdfPage(await doc.save(), 0, 'cw')
    const reloaded = await PDFDocument.load(out)
    expect(reloaded.getPage(0).getRotation().angle).toBe(0)
  })

  it('throws when the page index is out of range', async () => {
    await expect(rotatePdfPage(await buildPdf(1), 2, 'cw')).rejects.toThrow(/out of range/i)
  })
})
