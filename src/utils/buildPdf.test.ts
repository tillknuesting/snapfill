import { describe, expect, it } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { buildPdf, parseHtmlToLines } from './buildPdf'
import type { Annotation, PageInfo } from '@/types'

async function makeBlankPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.addPage([595, 842])
  return doc.save()
}

const PAGE: PageInfo = {
  pageIdx: 0,
  cssWidth: 600,
  cssHeight: 800,
  pdfWidth: 595,
  pdfHeight: 842,
}

// 1×1 transparent PNG, smallest valid PNG bytes
const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABAQMAAAAl21bKAAAAA1BMVEUAAACnej3aAAAAAXRSTlMAQObYZgAAAApJREFUCNdjYAAAAAIAAeIhvDMAAAAASUVORK5CYII='

// 1×1 white JPEG — pdf-lib's embedJpg accepts this; embedPng rejects it,
// which gives us a sharp signal that the prefix dispatch works.
const JPEG_DATA_URL =
  'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wgARCAABAAEDAREAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQBAQAAAAAAAAAAAAAAAAAAAAj/2gAMAwEAAhADEAAAAB8//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABAf/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k='

describe('parseHtmlToLines — plain text', () => {
  it('returns a single line with one run', () => {
    const lines = parseHtmlToLines('hello world')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toEqual([
      { text: 'hello world', bold: false, italic: false, underline: false },
    ])
  })

  it('returns one empty line for empty input', () => {
    const lines = parseHtmlToLines('')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toEqual([])
  })
})

describe('parseHtmlToLines — line breaks', () => {
  it('splits on <br>', () => {
    const lines = parseHtmlToLines('one<br>two')
    expect(lines).toHaveLength(2)
    expect(lines[0][0].text).toBe('one')
    expect(lines[1][0].text).toBe('two')
  })

  it('splits on <div> blocks', () => {
    const lines = parseHtmlToLines('<div>one</div><div>two</div>')
    expect(lines).toHaveLength(2)
    expect(lines[0][0].text).toBe('one')
    expect(lines[1][0].text).toBe('two')
  })
})

describe('parseHtmlToLines — styles', () => {
  it('captures <b> as bold', () => {
    const lines = parseHtmlToLines('<b>bold</b>')
    expect(lines[0][0]).toMatchObject({ text: 'bold', bold: true })
  })

  it('captures <strong> as bold', () => {
    const lines = parseHtmlToLines('<strong>bold</strong>')
    expect(lines[0][0]).toMatchObject({ bold: true })
  })

  it('captures <i> and <em> as italic', () => {
    expect(parseHtmlToLines('<i>x</i>')[0][0].italic).toBe(true)
    expect(parseHtmlToLines('<em>x</em>')[0][0].italic).toBe(true)
  })

  it('captures <u> as underline', () => {
    expect(parseHtmlToLines('<u>x</u>')[0][0].underline).toBe(true)
  })

  it('combines nested styles', () => {
    const lines = parseHtmlToLines('<b><i><u>both</u></i></b>')
    expect(lines[0][0]).toMatchObject({
      text: 'both', bold: true, italic: true, underline: true,
    })
  })

  it('handles inline-style equivalents', () => {
    const lines = parseHtmlToLines('<span style="font-weight: bold">x</span>')
    expect(lines[0][0].bold).toBe(true)
    const italic = parseHtmlToLines('<span style="font-style: italic">x</span>')
    expect(italic[0][0].italic).toBe(true)
    const underline = parseHtmlToLines('<span style="text-decoration: underline">x</span>')
    expect(underline[0][0].underline).toBe(true)
  })
})

describe('parseHtmlToLines — runs within a line', () => {
  it('splits a line into adjacent runs with different styles', () => {
    const lines = parseHtmlToLines('plain <b>bold</b> tail')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toHaveLength(3)
    expect(lines[0][0]).toMatchObject({ text: 'plain ', bold: false })
    expect(lines[0][1]).toMatchObject({ text: 'bold', bold: true })
    expect(lines[0][2]).toMatchObject({ text: ' tail', bold: false })
  })
})

describe('buildPdf — integration', () => {
  it('produces a parseable PDF when there are no annotations', async () => {
    const out = await buildPdf({
      pdfBytes: await makeBlankPdf(),
      annotations: [],
      pages: [PAGE],
      formFieldEdits: new Map(),
    })
    expect(out.byteLength).toBeGreaterThan(100)
    // Round-trip — should still be a valid PDF
    const reloaded = await PDFDocument.load(out)
    expect(reloaded.getPageCount()).toBe(1)
  })

  it('writes a text annotation into the PDF', async () => {
    const text: Annotation = {
      id: '1', type: 'text', pageIdx: 0,
      x: 50, y: 100, w: 200, h: 20,
      data: 'Hello world', fontSize: 12, family: 'helvetica', color: '#000000',
    }
    const out = await buildPdf({
      pdfBytes: await makeBlankPdf(),
      annotations: [text],
      pages: [PAGE],
      formFieldEdits: new Map(),
    })
    const reloaded = await PDFDocument.load(out)
    expect(reloaded.getPageCount()).toBe(1)
    expect(out.byteLength).toBeGreaterThan(100)
  })

  it('skips an annotation that fails to write and still produces a valid PDF', async () => {
    const goodText: Annotation = {
      id: 'g', type: 'text', pageIdx: 0,
      x: 50, y: 100, w: 200, h: 20,
      data: 'good run', fontSize: 12, family: 'helvetica', color: '#000000',
    }
    const badSig: Annotation = {
      id: 'b', type: 'signature', pageIdx: 0,
      x: 50, y: 200, w: 100, h: 50,
      // pdf-lib's embedPng rejects this; without per-annotation try/catch
      // the whole download would fail.
      data: 'data:image/png;base64,YmFkLW5vdC1hLXBuZw==',
    }
    const out = await buildPdf({
      pdfBytes: await makeBlankPdf(),
      annotations: [goodText, badSig],
      pages: [PAGE],
      formFieldEdits: new Map(),
    })
    const reloaded = await PDFDocument.load(out)
    expect(reloaded.getPageCount()).toBe(1)
  })

  it('embeds JPEG page images via embedJpg (compress-on-download path)', async () => {
    // Compress flow on download: each page is rasterised to JPEG and
    // routed through pageImages. The buildPdf branch dispatches on the
    // data-URL prefix — passing JPEG must call embedJpg, not embedPng
    // (which would throw on JPEG bytes). If the dispatch regressed,
    // this test would fail with a pdf-lib parse error.
    const out = await buildPdf({
      pdfBytes: await makeBlankPdf(),
      annotations: [],
      pages: [PAGE],
      formFieldEdits: new Map(),
      pageImages: [JPEG_DATA_URL],
    })
    const reloaded = await PDFDocument.load(out)
    expect(reloaded.getPageCount()).toBe(1)
    // Page geometry preserved at the original PDF dimensions.
    const p = reloaded.getPage(0)
    expect(Math.round(p.getWidth())).toBe(PAGE.pdfWidth)
    expect(Math.round(p.getHeight())).toBe(PAGE.pdfHeight)
  })

  it('embeds PNG page images via embedPng (raster fallback path)', async () => {
    const out = await buildPdf({
      pdfBytes: await makeBlankPdf(),
      annotations: [],
      pages: [PAGE],
      formFieldEdits: new Map(),
      pageImages: [PNG_DATA_URL],
    })
    const reloaded = await PDFDocument.load(out)
    expect(reloaded.getPageCount()).toBe(1)
  })

  it('rejects mismatched dispatch (PNG bytes labelled as JPEG)', async () => {
    // Sanity check: if you mislabel content with the wrong MIME prefix,
    // the corresponding embed call rejects. Documents the assumption the
    // prefix dispatch relies on.
    const mislabelled = 'data:image/jpeg;base64,' + PNG_DATA_URL.split(',')[1]
    await expect(buildPdf({
      pdfBytes: await makeBlankPdf(),
      annotations: [],
      pages: [PAGE],
      formFieldEdits: new Map(),
      pageImages: [mislabelled],
    })).rejects.toThrow()
  })

  it('handles an encrypted-flagged PDF by retrying with ignoreEncryption', async () => {
    // pdf-lib serialises a doc as encrypted when /Encrypt is set in the
    // trailer. Build one explicitly via a low-level dictionary push, then
    // verify buildPdf still produces a valid output.
    const doc = await PDFDocument.create()
    doc.addPage([595, 842])
    const ctx = doc.context
    const dummyEncrypt = ctx.obj({ Filter: 'Standard' })
    doc.context.trailerInfo.Encrypt = ctx.register(dummyEncrypt)
    const bytes = await doc.save({ useObjectStreams: false })

    const out = await buildPdf({
      pdfBytes: bytes,
      annotations: [],
      pages: [PAGE],
      formFieldEdits: new Map(),
    })
    expect(out.byteLength).toBeGreaterThan(100)
  })

  it('writes a textEdit annotation (cover + replacement text) into the PDF', async () => {
    const edit: Annotation = {
      id: 'te', type: 'textEdit', pageIdx: 0,
      x: 50, y: 100, w: 80, h: 14,
      data: 'replacement', fontSize: 12, family: 'helvetica', color: '#0a1f3d',
      originalFontName: 'g_d0_f1',
    }
    const out = await buildPdf({
      pdfBytes: await makeBlankPdf(),
      annotations: [edit],
      pages: [PAGE],
      formFieldEdits: new Map(),
    })
    const reloaded = await PDFDocument.load(out)
    expect(reloaded.getPageCount()).toBe(1)
    // Cover rectangle + drawText both extend the content stream — the result
    // should be larger than the no-annotation baseline (~ a couple hundred
    // bytes) but still tiny relative to a real PDF.
    expect(out.byteLength).toBeGreaterThan(200)
  })

  it('writes a signature annotation (PNG) into the PDF', async () => {
    const sig: Annotation = {
      id: '2', type: 'signature', pageIdx: 0,
      x: 50, y: 200, w: 150, h: 50,
      data: PNG_DATA_URL,
    }
    const out = await buildPdf({
      pdfBytes: await makeBlankPdf(),
      annotations: [sig],
      pages: [PAGE],
      formFieldEdits: new Map(),
    })
    expect(out.byteLength).toBeGreaterThan(100)
    await expect(PDFDocument.load(out)).resolves.toBeDefined()
  })

  it('writes a drawing annotation as an SVG path', async () => {
    const drawing: Annotation = {
      id: '3', type: 'drawing', pageIdx: 0,
      x: 100, y: 100, w: 100, h: 50,
      points: [[0, 0], [50, 25], [100, 50]],
      color: '#dc2626', opacity: 0.8, strokeWidth: 2,
    }
    const out = await buildPdf({
      pdfBytes: await makeBlankPdf(),
      annotations: [drawing],
      pages: [PAGE],
      formFieldEdits: new Map(),
    })
    expect(out.byteLength).toBeGreaterThan(100)
    await expect(PDFDocument.load(out)).resolves.toBeDefined()
  })

  it('mixes all annotation types on one page', async () => {
    const annots: Annotation[] = [
      { id: 't', type: 'text', pageIdx: 0, x: 10, y: 10, w: 100, h: 18,
        data: 'mixed', fontSize: 12, family: 'times', color: '#000' },
      { id: 's', type: 'signature', pageIdx: 0, x: 200, y: 100, w: 100, h: 30,
        data: PNG_DATA_URL },
      { id: 'd', type: 'drawing', pageIdx: 0, x: 300, y: 300, w: 50, h: 50,
        points: [[0, 0], [50, 50]], color: '#1d4ed8', opacity: 1, strokeWidth: 1.5 },
    ]
    const out = await buildPdf({
      pdfBytes: await makeBlankPdf(),
      annotations: annots,
      pages: [PAGE],
      formFieldEdits: new Map(),
    })
    await expect(PDFDocument.load(out)).resolves.toBeDefined()
  })

  it('skips annotations on pages that don\'t exist', async () => {
    const orphan: Annotation = {
      id: 'x', type: 'text', pageIdx: 99,
      x: 10, y: 10, w: 100, h: 20,
      data: 'orphan', fontSize: 12, family: 'helvetica', color: '#000',
    }
    // Should not throw
    const out = await buildPdf({
      pdfBytes: await makeBlankPdf(),
      annotations: [orphan],
      pages: [PAGE],
      formFieldEdits: new Map(),
    })
    await expect(PDFDocument.load(out)).resolves.toBeDefined()
  })

  it('skips empty text annotations (no draw call)', async () => {
    const empty: Annotation = {
      id: 'e', type: 'text', pageIdx: 0,
      x: 10, y: 10, w: 100, h: 20,
      data: '', fontSize: 12, family: 'helvetica', color: '#000',
    }
    const out = await buildPdf({
      pdfBytes: await makeBlankPdf(),
      annotations: [empty],
      pages: [PAGE],
      formFieldEdits: new Map(),
    })
    await expect(PDFDocument.load(out)).resolves.toBeDefined()
  })

  it('uses bold variant for run with bold style', async () => {
    const bold: Annotation = {
      id: 'b', type: 'text', pageIdx: 0,
      x: 10, y: 10, w: 100, h: 20,
      data: '<b>bold</b>', fontSize: 12, family: 'helvetica', color: '#000',
    }
    const out = await buildPdf({
      pdfBytes: await makeBlankPdf(),
      annotations: [bold],
      pages: [PAGE],
      formFieldEdits: new Map(),
    })
    await expect(PDFDocument.load(out)).resolves.toBeDefined()
  })

  it('embeds a PNG image annotation', async () => {
    const image: Annotation = {
      id: 'i', type: 'image', pageIdx: 0,
      x: 50, y: 50, w: 100, h: 100,
      data: PNG_DATA_URL, mime: 'image/png',
    }
    const out = await buildPdf({
      pdfBytes: await makeBlankPdf(),
      annotations: [image],
      pages: [PAGE],
      formFieldEdits: new Map(),
    })
    expect(out.byteLength).toBeGreaterThan(100)
    await expect(PDFDocument.load(out)).resolves.toBeDefined()
  })
})
