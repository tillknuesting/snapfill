import { PDFDocument } from 'pdf-lib'

export async function deletePdfPage(bytes: Uint8Array, pageIdx: number): Promise<Uint8Array> {
  const doc = await loadPdf(bytes)
  const count = doc.getPageCount()
  if (count <= 1) {
    throw new Error('deletePdfPage: cannot delete the only page in a PDF')
  }
  if (pageIdx < 0 || pageIdx >= count) {
    throw new Error(`deletePdfPage: page index ${pageIdx} out of range for ${count} pages`)
  }
  doc.removePage(pageIdx)
  return await doc.save()
}

async function loadPdf(bytes: Uint8Array): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes)
  } catch {
    return await PDFDocument.load(bytes, { ignoreEncryption: true })
  }
}
