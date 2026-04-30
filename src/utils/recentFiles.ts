// Recent-file cache backed by IndexedDB. Stores recently-opened PDFs along
// with the user's annotations + form-field edits so they can pick up where
// they left off. Everything is local to the browser; no network involved.

import type { Annotation } from '@/types'

const DB_NAME = 'pdfhelper'
const DB_VERSION = 2
const STORE = 'recent'
const MAX_RECENT = 20

export type SerializedFormFields = Array<[string, string | boolean]>

interface RecentRecord {
  id: string
  name: string
  size: number
  openedAt: number
  bytes: Uint8Array
  annotations: Annotation[]
  formFieldEdits: SerializedFormFields
}

export interface RecentFileMeta {
  id: string
  name: string
  size: number
  openedAt: number
}

export interface RecentFileFull {
  id: string
  name: string
  bytes: Uint8Array
  annotations: Annotation[]
  formFieldEdits: SerializedFormFields
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = (e) => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' })
        return
      }
      // v1 → v2 migration: backfill annotations / formFieldEdits on existing rows.
      if ((e.oldVersion ?? 0) < 2) {
        const tx = req.transaction
        if (!tx) return
        const store = tx.objectStore(STORE)
        const cursor = store.openCursor()
        cursor.onsuccess = () => {
          const c = cursor.result
          if (!c) return
          const r = c.value as Partial<RecentRecord>
          const next: RecentRecord = {
            id: r.id ?? crypto.randomUUID(),
            name: r.name ?? 'Untitled.pdf',
            size: r.size ?? 0,
            openedAt: r.openedAt ?? Date.now(),
            bytes: r.bytes ?? new Uint8Array(),
            annotations: r.annotations ?? [],
            formFieldEdits: r.formFieldEdits ?? [],
          }
          c.update(next)
          c.continue()
        }
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((res, rej) => {
    tx.oncomplete = () => res()
    tx.onerror = () => rej(tx.error)
    tx.onabort = () => rej(tx.error)
  })
}

function reqDone<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => {
    req.onsuccess = () => res(req.result)
    req.onerror = () => rej(req.error)
  })
}

// Add (or refresh) a PDF in the cache. Returns the record's id so the caller
// can reference it for subsequent saves. If the same file (name + size) is
// already there, its timestamp is bumped and existing annotations preserved.
export async function addRecentFile(name: string, bytes: Uint8Array): Promise<string> {
  try {
    const db = await openDb()
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    const all = (await reqDone(store.getAll())) as RecentRecord[]
    const dupe = all.find((e) => e.name === name && e.size === bytes.byteLength)
    if (dupe) {
      const next: RecentRecord = { ...dupe, openedAt: Date.now() }
      store.put(next)
      await txDone(tx)
      return dupe.id
    }
    const remaining = [...all].sort((a, b) => b.openedAt - a.openedAt)
    while (remaining.length >= MAX_RECENT) {
      const oldest = remaining.pop()
      if (oldest) store.delete(oldest.id)
    }
    const id = crypto.randomUUID()
    const record: RecentRecord = {
      id, name,
      size: bytes.byteLength,
      openedAt: Date.now(),
      bytes,
      annotations: [],
      formFieldEdits: [],
    }
    store.put(record)
    await txDone(tx)
    return id
  } catch (err) {
    console.warn('addRecentFile failed', err)
    return ''
  }
}

// Patch a recent file (used by the auto-save loop). Bytes are usually not
// mutated, but the merge action does swap them when a user appends or
// prepends another PDF — `size` should be passed alongside any new bytes.
export async function updateRecentFile(
  id: string,
  patch: Partial<Pick<RecentRecord, 'annotations' | 'formFieldEdits' | 'openedAt' | 'bytes' | 'size'>>,
): Promise<void> {
  try {
    const db = await openDb()
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    const cur = (await reqDone(store.get(id))) as RecentRecord | undefined
    if (!cur) return
    store.put({ ...cur, ...patch })
    await txDone(tx)
  } catch (err) {
    console.warn('updateRecentFile failed', err)
  }
}

export async function loadRecentFiles(): Promise<RecentFileMeta[]> {
  try {
    const db = await openDb()
    const tx = db.transaction(STORE, 'readonly')
    const all = (await reqDone(tx.objectStore(STORE).getAll())) as RecentRecord[]
    await txDone(tx)
    return all
      .sort((a, b) => b.openedAt - a.openedAt)
      .map(({ id, name, size, openedAt }) => ({ id, name, size, openedAt }))
  } catch (err) {
    console.warn('loadRecentFiles failed', err)
    return []
  }
}

export async function loadRecentFile(
  id: string,
): Promise<{ name: string; bytes: Uint8Array } | null> {
  try {
    const db = await openDb()
    const tx = db.transaction(STORE, 'readonly')
    const rec = (await reqDone(tx.objectStore(STORE).get(id))) as RecentRecord | undefined
    await txDone(tx)
    if (!rec) return null
    return { name: rec.name, bytes: rec.bytes }
  } catch (err) {
    console.warn('loadRecentFile failed', err)
    return null
  }
}

// Full record including the user's saved annotations / form-field edits —
// used when switching back to a previously-edited PDF.
export async function loadRecentFileFull(id: string): Promise<RecentFileFull | null> {
  try {
    const db = await openDb()
    const tx = db.transaction(STORE, 'readonly')
    const rec = (await reqDone(tx.objectStore(STORE).get(id))) as RecentRecord | undefined
    await txDone(tx)
    if (!rec) return null
    return {
      id: rec.id,
      name: rec.name,
      bytes: rec.bytes,
      annotations: rec.annotations ?? [],
      formFieldEdits: rec.formFieldEdits ?? [],
    }
  } catch (err) {
    console.warn('loadRecentFileFull failed', err)
    return null
  }
}

export async function removeRecentFile(id: string): Promise<void> {
  try {
    const db = await openDb()
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(id)
    await txDone(tx)
  } catch (err) {
    console.warn('removeRecentFile failed', err)
  }
}

export async function clearRecentFiles(): Promise<void> {
  try {
    const db = await openDb()
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).clear()
    await txDone(tx)
  } catch (err) {
    console.warn('clearRecentFiles failed', err)
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function formatRelativeTime(ms: number): string {
  const diff = (Date.now() - ms) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} d ago`
  return new Date(ms).toLocaleDateString()
}
