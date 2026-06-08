import { PDFDocument, degrees } from 'pdf-lib'

export type RotateDirection = 'cw' | 'ccw'

export async function rotatePdfPage(
  bytes: Uint8Array,
  pageIdx: number,
  direction: RotateDirection,
): Promise<Uint8Array> {
  const doc = await loadPdf(bytes)
  const count = doc.getPageCount()
  if (pageIdx < 0 || pageIdx >= count) {
    throw new Error(`rotatePdfPage: page index ${pageIdx} out of range for ${count} pages`)
  }
  const page = doc.getPage(pageIdx)
  const current = normalizeAngle(page.getRotation().angle)
  const delta = direction === 'cw' ? 90 : -90
  page.setRotation(degrees(normalizeAngle(current + delta)))
  return await doc.save()
}

function normalizeAngle(angle: number): 0 | 90 | 180 | 270 {
  const normalized = ((Math.round(angle / 90) * 90) % 360 + 360) % 360
  if (normalized === 90 || normalized === 180 || normalized === 270) return normalized
  return 0
}

async function loadPdf(bytes: Uint8Array): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes)
  } catch {
    return await PDFDocument.load(bytes, { ignoreEncryption: true })
  }
}
