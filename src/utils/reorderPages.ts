import { PDFDocument } from 'pdf-lib'

// Reorder pages of a PDF in-place. `newOrder[i] = oldIndex` — the page that
// belonged at oldIndex moves to position `i`. Length must match the doc's
// page count.
//
// Strategy: keep the same PDFDocument so metadata, AcroForm fields, and
// outline entries stay attached to their target pages. We snapshot the
// existing PDFPage references, remove every page from the catalog, then
// add them back in the requested order. pdf-lib retains the page object's
// indirect references after removal, so re-adding doesn't strip resources.
export async function reorderPdfPages(
  bytes: Uint8Array,
  newOrder: number[],
): Promise<Uint8Array> {
  const doc = await loadPdf(bytes)
  const count = doc.getPageCount()
  if (newOrder.length !== count) {
    throw new Error(`reorderPdfPages: newOrder length ${newOrder.length} != page count ${count}`)
  }
  // Bail on non-permutations (duplicates, out-of-range, missing) — silently
  // garbling pages is much worse than throwing.
  const seen = new Set<number>()
  for (const n of newOrder) {
    if (n < 0 || n >= count || seen.has(n)) {
      throw new Error(`reorderPdfPages: invalid order ${JSON.stringify(newOrder)}`)
    }
    seen.add(n)
  }
  const pages = doc.getPages()
  const reordered = newOrder.map((oldIdx) => pages[oldIdx])
  // Remove every page (in reverse — index shifts after each removal).
  for (let i = count - 1; i >= 0; i--) doc.removePage(i)
  for (const p of reordered) doc.addPage(p)
  return await doc.save()
}

async function loadPdf(bytes: Uint8Array): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes)
  } catch {
    return await PDFDocument.load(bytes, { ignoreEncryption: true })
  }
}
