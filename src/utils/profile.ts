import type { ProfileField } from '@/types'

const STORAGE_KEY = 'pdfhelper.profile'

const DEFAULT_FIELDS: Omit<ProfileField, 'id'>[] = [
  { label: 'Full name',     value: '' },
  { label: 'First name',    value: '' },
  { label: 'Last name',     value: '' },
  { label: 'Date of birth', value: '' },
  { label: 'Address',       value: '' },
  { label: 'Postal code',   value: '' },
  { label: 'City',          value: '' },
  { label: 'Phone',         value: '' },
  { label: 'Email',         value: '' },
]

export function loadProfile(): ProfileField[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as ProfileField[]
  } catch { /* ignore */ }
  return DEFAULT_FIELDS.map((f) => ({ ...f, id: crypto.randomUUID() }))
}

export function saveProfile(fields: ProfileField[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(fields))
  } catch { /* ignore quota errors */ }
}
