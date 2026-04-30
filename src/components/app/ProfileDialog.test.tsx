import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProfileDialog } from './ProfileDialog'
import { usePdfStore } from '@/store/usePdfStore'

beforeEach(() => {
  usePdfStore.setState({
    pdfBytes: new Uint8Array([1, 2, 3]),
    fileName: '', annotations: [], pages: [], mode: 'idle',
    selectedId: null, pendingSignature: null, pendingTextValue: null,
    pendingDateMs: null, sigColor: '#0a1f3d', penColor: '#0a1f3d',
    penOpacity: 1, penWidth: 2, zoom: 1, formFieldEdits: new Map(),
  })
  // Seed profile with two known fields
  localStorage.setItem('pdfhelper.profile', JSON.stringify([
    { id: '1', label: 'Full name', value: 'Alice Wonderland' },
    { id: '2', label: 'City',      value: '' },
  ]))
})

describe('ProfileDialog', () => {
  it('lists saved fields when opened', () => {
    render(<ProfileDialog open onOpenChange={vi.fn()} />)
    expect(screen.getByDisplayValue('Full name')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Alice Wonderland')).toBeInTheDocument()
    expect(screen.getByDisplayValue('City')).toBeInTheDocument()
  })

  it('Insert with a non-empty value sets pendingTextValue, switches to text mode, closes dialog', async () => {
    const onOpenChange = vi.fn()
    render(<ProfileDialog open onOpenChange={onOpenChange} />)
    const buttons = screen.getAllByRole('button', { name: /insert/i })
    // First Insert is on "Full name" which has a value
    await userEvent.click(buttons[0])
    const s = usePdfStore.getState()
    expect(s.pendingTextValue).toBe('Alice Wonderland')
    expect(s.mode).toBe('text')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('Insert is disabled for empty values', () => {
    render(<ProfileDialog open onOpenChange={vi.fn()} />)
    const buttons = screen.getAllByRole('button', { name: /insert/i })
    // The "City" row has an empty value
    expect(buttons[1]).toBeDisabled()
  })

  it('editing a label persists to localStorage', async () => {
    render(<ProfileDialog open onOpenChange={vi.fn()} />)
    const labelInput = screen.getByDisplayValue('Full name')
    await userEvent.clear(labelInput)
    await userEvent.type(labelInput, 'Name')
    const stored = JSON.parse(localStorage.getItem('pdfhelper.profile')!)
    expect(stored[0].label).toBe('Name')
  })

  it('Add field appends a new empty row', async () => {
    render(<ProfileDialog open onOpenChange={vi.fn()} />)
    const before = screen.getAllByRole('button', { name: /insert/i }).length
    await userEvent.click(screen.getByRole('button', { name: /add field/i }))
    const after = screen.getAllByRole('button', { name: /insert/i }).length
    expect(after).toBe(before + 1)
  })

  it('Remove deletes a row', async () => {
    render(<ProfileDialog open onOpenChange={vi.fn()} />)
    const rows = screen.getAllByDisplayValue(/Full name|City/)
    expect(rows).toHaveLength(2)
    const removeButtons = screen.getAllByLabelText(/remove field/i)
    await userEvent.click(removeButtons[0])
    expect(screen.queryByDisplayValue('Full name')).not.toBeInTheDocument()
  })

  it('disables Insert when no PDF is loaded', () => {
    usePdfStore.setState({ pdfBytes: null })
    render(<ProfileDialog open onOpenChange={vi.fn()} />)
    const buttons = screen.getAllByRole('button', { name: /insert/i })
    // Even the row with a value can't insert without a PDF
    expect(buttons[0]).toBeDisabled()
  })
})

describe('ProfileDialog — defaults', () => {
  it('shows the seed fields when localStorage is empty', () => {
    localStorage.clear()
    render(<ProfileDialog open onOpenChange={vi.fn()} />)
    // Default seed includes "Full name"
    expect(within(document.body).queryByDisplayValue('Full name')).toBeInTheDocument()
  })
})
