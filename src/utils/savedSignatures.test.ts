import { beforeEach, describe, expect, it } from 'vitest'
import {
  addSavedSignature,
  loadSavedSignatures,
  persistSavedSignatures,
  removeSavedSignature,
} from './savedSignatures'

const PNG1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAAXNSR0I' // truncated, OK for tests
const PNG2 = 'data:image/png;base64,DIFFERENT'

beforeEach(() => {
  localStorage.clear()
})

describe('loadSavedSignatures', () => {
  it('returns an empty list initially', () => {
    expect(loadSavedSignatures()).toEqual([])
  })

  it('handles malformed storage gracefully', () => {
    localStorage.setItem('pdfhelper.signatures', '{not json}')
    expect(loadSavedSignatures()).toEqual([])
  })
})

describe('addSavedSignature', () => {
  it('prepends new entries (newest first)', () => {
    addSavedSignature(PNG1)
    addSavedSignature(PNG2)
    const list = loadSavedSignatures()
    expect(list).toHaveLength(2)
    expect(list[0].dataUrl).toBe(PNG2)
    expect(list[1].dataUrl).toBe(PNG1)
  })

  it('de-dupes by data URL — same image bumps to top', () => {
    addSavedSignature(PNG1)
    addSavedSignature(PNG2)
    addSavedSignature(PNG1)
    const list = loadSavedSignatures()
    expect(list).toHaveLength(2)
    expect(list[0].dataUrl).toBe(PNG1)
    expect(list[1].dataUrl).toBe(PNG2)
  })

  it('caps the list at 8 entries', () => {
    for (let i = 0; i < 12; i++) {
      addSavedSignature(`data:image/png;base64,${i}`)
    }
    const list = loadSavedSignatures()
    expect(list).toHaveLength(8)
    // Newest is the last one we added
    expect(list[0].dataUrl).toBe('data:image/png;base64,11')
  })

  it('assigns a unique id and timestamp to each entry', () => {
    addSavedSignature(PNG1)
    addSavedSignature(PNG2)
    const list = loadSavedSignatures()
    expect(list[0].id).not.toBe(list[1].id)
    expect(typeof list[0].createdAt).toBe('number')
  })
})

describe('removeSavedSignature', () => {
  it('removes the matching entry', () => {
    addSavedSignature(PNG1)
    addSavedSignature(PNG2)
    const list = loadSavedSignatures()
    const targetId = list[0].id
    removeSavedSignature(targetId)
    const after = loadSavedSignatures()
    expect(after).toHaveLength(1)
    expect(after[0].id).not.toBe(targetId)
  })

  it('is a no-op for unknown ids', () => {
    addSavedSignature(PNG1)
    removeSavedSignature('does-not-exist')
    expect(loadSavedSignatures()).toHaveLength(1)
  })
})

describe('persistSavedSignatures', () => {
  it('writes the list verbatim', () => {
    persistSavedSignatures([
      { id: 'a', dataUrl: PNG1, createdAt: 1 },
      { id: 'b', dataUrl: PNG2, createdAt: 2 },
    ])
    const list = loadSavedSignatures()
    expect(list).toHaveLength(2)
    expect(list[0]).toEqual({ id: 'a', dataUrl: PNG1, createdAt: 1 })
  })
})
