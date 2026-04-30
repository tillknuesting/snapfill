import type { SavedSignature } from '@/types'

const STORAGE_KEY = 'pdfhelper.signatures'

export function loadSavedSignatures(): SavedSignature[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as SavedSignature[]) : []
  } catch {
    return []
  }
}

export function persistSavedSignatures(list: SavedSignature[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  } catch {
    // ignore quota errors
  }
}

export function addSavedSignature(dataUrl: string): SavedSignature[] {
  const list = loadSavedSignatures().filter((s) => s.dataUrl !== dataUrl)
  list.unshift({ id: crypto.randomUUID(), dataUrl, createdAt: Date.now() })
  if (list.length > 8) list.length = 8
  persistSavedSignatures(list)
  return list
}

export function removeSavedSignature(id: string): SavedSignature[] {
  const list = loadSavedSignatures().filter((s) => s.id !== id)
  persistSavedSignatures(list)
  return list
}
