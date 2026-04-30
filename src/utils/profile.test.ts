import { beforeEach, describe, expect, it } from 'vitest'
import { loadProfile, saveProfile } from './profile'
import type { ProfileField } from '@/types'

beforeEach(() => {
  localStorage.clear()
})

describe('loadProfile', () => {
  it('returns the default fields when nothing is stored', () => {
    const fields = loadProfile()
    expect(fields.length).toBeGreaterThan(0)
    expect(fields.every((f) => typeof f.label === 'string' && typeof f.value === 'string')).toBe(true)
    // Each default field should have a generated id
    const ids = new Set(fields.map((f) => f.id))
    expect(ids.size).toBe(fields.length)
  })

  it('returns whatever was stored', () => {
    const stored: ProfileField[] = [
      { id: '1', label: 'Name', value: 'Alice' },
      { id: '2', label: 'City', value: 'Berlin' },
    ]
    localStorage.setItem('pdfhelper.profile', JSON.stringify(stored))
    const fields = loadProfile()
    expect(fields).toEqual(stored)
  })

  it('falls back to defaults on malformed JSON', () => {
    localStorage.setItem('pdfhelper.profile', '{not json}')
    const fields = loadProfile()
    expect(fields.length).toBeGreaterThan(0)
  })
})

describe('saveProfile', () => {
  it('round-trips a profile through localStorage', () => {
    const fields: ProfileField[] = [
      { id: 'a', label: 'IBAN', value: 'DE89 3704 0044 0532 0130 00' },
    ]
    saveProfile(fields)
    const reloaded = loadProfile()
    expect(reloaded).toEqual(fields)
  })

  it('overwrites previous content', () => {
    saveProfile([{ id: '1', label: 'first', value: 'one' }])
    saveProfile([{ id: '2', label: 'second', value: 'two' }])
    const reloaded = loadProfile()
    expect(reloaded).toHaveLength(1)
    expect(reloaded[0].label).toBe('second')
  })
})
