import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { mergePdf } from './mergePdf'

async function buildBlankPdf(pageCount: number, sizeTag: number): Promise<Uint8Array> {
  // Each "tag" is a unique width so we can identify which page came from
  // which doc after a merge.
  const doc = await PDFDocument.create()
  for (let i = 0; i < pageCount; i++) {
    doc.addPage([sizeTag + i, 100])
  }
  return await doc.save()
}

describe('mergePdf', () => {
  it("appends pages at the end when where='end'", async () => {
    const a = await buildBlankPdf(2, 200) // pages 200x100, 201x100
    const b = await buildBlankPdf(3, 300) // pages 300x100, 301x100, 302x100
    const { bytes, insertedCount } = await mergePdf(a, b, 'end')
    expect(insertedCount).toBe(3)

    const out = await PDFDocument.load(bytes)
    expect(out.getPageCount()).toBe(5)
    const widths = out.getPages().map((p) => Math.round(p.getWidth()))
    // Original A pages first, then B's appended.
    expect(widths).toEqual([200, 201, 300, 301, 302])
  })

  it("prepends pages at the start when where='start' (preserves insert order)", async () => {
    const a = await buildBlankPdf(2, 200)
    const b = await buildBlankPdf(3, 300)
    const { bytes, insertedCount } = await mergePdf(a, b, 'start')
    expect(insertedCount).toBe(3)

    const out = await PDFDocument.load(bytes)
    expect(out.getPageCount()).toBe(5)
    const widths = out.getPages().map((p) => Math.round(p.getWidth()))
    // B's pages first in their original order, then A's.
    expect(widths).toEqual([300, 301, 302, 200, 201])
  })

  it('appends a single-page PDF correctly (smallest non-trivial case)', async () => {
    const a = await buildBlankPdf(2, 200)
    const single = await buildBlankPdf(1, 999)
    const { bytes, insertedCount } = await mergePdf(a, single, 'end')
    expect(insertedCount).toBe(1)
    const out = await PDFDocument.load(bytes)
    expect(out.getPageCount()).toBe(3)
    expect(Math.round(out.getPage(2).getWidth())).toBe(999)
  })

  it('does not mutate page geometry of inserted pages', async () => {
    const a = await buildBlankPdf(1, 200)
    const b = await PDFDocument.create()
    const p = b.addPage([400, 600])
    p.setMediaBox(0, 0, 400, 600)
    const bBytes = await b.save()
    const { bytes } = await mergePdf(a, bBytes, 'end')
    const out = await PDFDocument.load(bytes)
    const last = out.getPage(out.getPageCount() - 1)
    expect(Math.round(last.getWidth())).toBe(400)
    expect(Math.round(last.getHeight())).toBe(600)
  })
})
