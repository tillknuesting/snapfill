import { PDFDocument } from 'pdf-lib'

// Where the new pages go relative to the existing document.
//   'start' — new pages become page 0..N-1; the original first page moves
//             to index N. All annotations on the original need their
//             `pageIdx` shifted by +N. The store handles that side.
//   'end'   — new pages become the trailing pages. No remap needed.
export type MergeWhere = 'start' | 'end'

export interface MergeResult {
  bytes: Uint8Array
  insertedCount: number
}

// Merge a second PDF into the current one. Both inputs are raw bytes;
// output is a freshly serialised PDF. Encrypted source PDFs are loaded
// with `ignoreEncryption: true` (matches buildPdf.ts) so users can still
// glue together documents that have basic copy-protection markers — the
// content is already readable in the browser, the flag just stops pdf-lib
// from refusing to open it.
export async function mergePdf(
  currentBytes: Uint8Array,
  insertBytes: Uint8Array,
  where: MergeWhere,
): Promise<MergeResult> {
  const current = await loadPdf(currentBytes)
  const insert = await loadPdf(insertBytes)
  const insertedCount = insert.getPageCount()
  if (insertedCount === 0) {
    return { bytes: await current.save(), insertedCount: 0 }
  }
  const copied = await current.copyPages(
    insert,
    insert.getPageIndices(),
  )
  if (where === 'end') {
    for (const p of copied) current.addPage(p)
  } else {
    // Insert in reverse so each call uses index 0 — pdf-lib's insertPage
    // shifts everything down, and inserting the array forward would
    // reverse our intended order.
    for (let i = copied.length - 1; i >= 0; i--) {
      current.insertPage(0, copied[i])
    }
  }
  const bytes = await current.save()
  return { bytes, insertedCount }
}

async function loadPdf(bytes: Uint8Array): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes)
  } catch {
    return await PDFDocument.load(bytes, { ignoreEncryption: true })
  }
}
