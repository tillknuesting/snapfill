import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  addRecentFile, clearRecentFiles, formatBytes, formatRelativeTime,
  loadRecentFile, loadRecentFiles, removeRecentFile,
} from './recentFiles'

beforeEach(async () => {
  await clearRecentFiles()
})
afterEach(() => { vi.useRealTimers() })

describe('formatBytes', () => {
  it('formats bytes under 1 KB', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(123)).toBe('123 B')
    expect(formatBytes(1023)).toBe('1023 B')
  })

  it('formats KB range with one decimal', () => {
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(10 * 1024)).toBe('10.0 KB')
  })

  it('formats MB range with one decimal', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB')
    expect(formatBytes(2.5 * 1024 * 1024)).toBe('2.5 MB')
  })
})

describe('formatRelativeTime', () => {
  it('returns "just now" for very recent timestamps', () => {
    const now = Date.now()
    vi.setSystemTime(now)
    expect(formatRelativeTime(now)).toBe('just now')
    expect(formatRelativeTime(now - 30 * 1000)).toBe('just now')
  })

  it('formats minutes', () => {
    const now = Date.now()
    vi.setSystemTime(now)
    expect(formatRelativeTime(now - 60 * 1000)).toBe('1 min ago')
    expect(formatRelativeTime(now - 5 * 60 * 1000)).toBe('5 min ago')
    expect(formatRelativeTime(now - 59 * 60 * 1000)).toBe('59 min ago')
  })

  it('formats hours', () => {
    const now = Date.now()
    vi.setSystemTime(now)
    expect(formatRelativeTime(now - 60 * 60 * 1000)).toBe('1 h ago')
    expect(formatRelativeTime(now - 23 * 60 * 60 * 1000)).toBe('23 h ago')
  })

  it('formats days', () => {
    const now = Date.now()
    vi.setSystemTime(now)
    expect(formatRelativeTime(now - 86400 * 1000)).toBe('1 d ago')
    expect(formatRelativeTime(now - 6 * 86400 * 1000)).toBe('6 d ago')
  })

  it('falls back to a date string after a week', () => {
    const now = Date.now()
    vi.setSystemTime(now)
    const old = now - 30 * 86400 * 1000
    const result = formatRelativeTime(old)
    // Just check it produced *some* localized date — not the relative form.
    expect(result).not.toMatch(/ago$/)
    expect(result).not.toBe('just now')
  })
})

describe('IndexedDB cache', () => {
  it('round-trips: add → load metadata → load bytes', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4])
    await addRecentFile('a.pdf', bytes)
    const meta = await loadRecentFiles()
    expect(meta).toHaveLength(1)
    expect(meta[0]).toMatchObject({ name: 'a.pdf', size: 4 })
    const loaded = await loadRecentFile(meta[0].id)
    expect(loaded?.name).toBe('a.pdf')
    expect(Array.from(loaded!.bytes)).toEqual([1, 2, 3, 4])
  })

  it('de-dupes by name + size, latest wins', async () => {
    // Pin Date.now() so each add gets a distinct, monotonically increasing
    // timestamp — `Date.now()` returns the same value for rapid sequential
    // calls otherwise.
    let t = 1_000_000
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => ++t)
    try {
      const bytes = new Uint8Array([1, 2, 3])
      await addRecentFile('doc.pdf', bytes)
      await addRecentFile('other.pdf', new Uint8Array([9]))
      await addRecentFile('doc.pdf', bytes)  // re-add same → bumps timestamp
      const meta = await loadRecentFiles()
      expect(meta).toHaveLength(2)
      expect(meta[0].name).toBe('doc.pdf')  // most recent first
      expect(meta[1].name).toBe('other.pdf')
    } finally {
      spy.mockRestore()
    }
  })

  it('caps the list at 20 entries', async () => {
    for (let i = 0; i < 25; i++) {
      await addRecentFile(`file-${i}.pdf`, new Uint8Array([i]))
    }
    const meta = await loadRecentFiles()
    expect(meta).toHaveLength(20)
  })

  it('orders by openedAt descending (newest first)', async () => {
    let t = 2_000_000
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => ++t)
    try {
      await addRecentFile('first.pdf', new Uint8Array([1]))
      await addRecentFile('second.pdf', new Uint8Array([2]))
      await addRecentFile('third.pdf', new Uint8Array([3]))
      const meta = await loadRecentFiles()
      expect(meta.map((m) => m.name)).toEqual(['third.pdf', 'second.pdf', 'first.pdf'])
    } finally {
      spy.mockRestore()
    }
  })

  it('removeRecentFile removes the matching entry', async () => {
    await addRecentFile('a.pdf', new Uint8Array([1]))
    await addRecentFile('b.pdf', new Uint8Array([2]))
    const meta = await loadRecentFiles()
    const targetId = meta.find((m) => m.name === 'a.pdf')!.id
    await removeRecentFile(targetId)
    const after = await loadRecentFiles()
    expect(after.map((m) => m.name)).toEqual(['b.pdf'])
  })

  it('loadRecentFile returns null for unknown ids', async () => {
    expect(await loadRecentFile('does-not-exist')).toBeNull()
  })

  it('clearRecentFiles wipes everything', async () => {
    await addRecentFile('a.pdf', new Uint8Array([1]))
    await addRecentFile('b.pdf', new Uint8Array([2]))
    await clearRecentFiles()
    expect(await loadRecentFiles()).toEqual([])
  })

  it('returns empty list initially', async () => {
    expect(await loadRecentFiles()).toEqual([])
  })
})

describe('persistence: full record + updateRecentFile', () => {
  it('addRecentFile starts with empty annotations and form-field edits', async () => {
    const { loadRecentFileFull } = await import('./recentFiles')
    const id = await (await import('./recentFiles')).addRecentFile('a.pdf', new Uint8Array([1]))
    const full = await loadRecentFileFull(id)
    expect(full).not.toBeNull()
    expect(full!.annotations).toEqual([])
    expect(full!.formFieldEdits).toEqual([])
  })

  it('updateRecentFile patches annotations + form-field edits', async () => {
    const { addRecentFile, updateRecentFile, loadRecentFileFull } = await import('./recentFiles')
    const id = await addRecentFile('doc.pdf', new Uint8Array([1, 2, 3]))
    await updateRecentFile(id, {
      annotations: [{
        id: 'a1', type: 'text', pageIdx: 0, x: 10, y: 10, w: 100, h: 20,
        data: 'hello', fontSize: 14, family: 'helvetica', color: '#000',
      }],
      formFieldEdits: [['name', 'Alice'], ['agreed', true]],
    })
    const full = await loadRecentFileFull(id)
    expect(full!.annotations).toHaveLength(1)
    expect(full!.annotations[0]).toMatchObject({ id: 'a1', data: 'hello' })
    expect(full!.formFieldEdits).toEqual([['name', 'Alice'], ['agreed', true]])
    // Bytes are not changed
    expect(Array.from(full!.bytes)).toEqual([1, 2, 3])
  })

  it('updateRecentFile is a no-op for unknown ids', async () => {
    const { updateRecentFile } = await import('./recentFiles')
    await expect(updateRecentFile('does-not-exist', { annotations: [] })).resolves.toBeUndefined()
  })

  it('addRecentFile bumps timestamp + preserves annotations on duplicate (name + size)', async () => {
    const { addRecentFile, updateRecentFile, loadRecentFileFull } = await import('./recentFiles')
    const id = await addRecentFile('doc.pdf', new Uint8Array([1, 2, 3]))
    await updateRecentFile(id, {
      annotations: [{
        id: 'a1', type: 'text', pageIdx: 0, x: 0, y: 0, w: 10, h: 10,
        data: 'kept', fontSize: 14, family: 'helvetica', color: '#000',
      }],
    })
    // Re-add the same file (same name + size)
    const id2 = await addRecentFile('doc.pdf', new Uint8Array([1, 2, 3]))
    expect(id2).toBe(id)
    const full = await loadRecentFileFull(id2)
    expect(full!.annotations).toHaveLength(1)
    expect(full!.annotations[0]).toMatchObject({ data: 'kept' })
  })
})
