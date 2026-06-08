import { describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EmptyState } from './EmptyState'
import { addRecentFile, clearRecentFiles } from '@/utils/recentFiles'

describe('EmptyState', () => {
  it('shows the drop zone instructions', () => {
    render(<EmptyState onFile={vi.fn()} onRecentFile={vi.fn()} />)
    expect(screen.getByRole('heading', { name: /fill.*sign a pdf/i })).toBeInTheDocument()
    expect(screen.getByText(/drag a pdf here/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /open pdf/i })).toBeInTheDocument()
  })

  it('does not render the Recent section when there are no recents', async () => {
    await clearRecentFiles()
    render(<EmptyState onFile={vi.fn()} onRecentFile={vi.fn()} />)
    expect(screen.queryByText(/^Recent$/)).not.toBeInTheDocument()
  })

  it('lists recent files and calls onRecentFile when one is clicked', async () => {
    await clearRecentFiles()
    const id = await addRecentFile('paperwork.pdf', new Uint8Array([1, 2, 3, 4]))
    const onFile = vi.fn()
    const onRecentFile = vi.fn()
    render(<EmptyState onFile={onFile} onRecentFile={onRecentFile} />)
    // The list loads asynchronously after mount
    const item = await waitFor(() => screen.getByText('paperwork.pdf'))
    await userEvent.click(item)
    await waitFor(() => expect(onRecentFile).toHaveBeenCalledWith(id))
    expect(onFile).not.toHaveBeenCalled()
  })

  it('shows "Clear all" only when there are recents', async () => {
    await clearRecentFiles()
    await addRecentFile('a.pdf', new Uint8Array([1]))
    render(<EmptyState onFile={vi.fn()} onRecentFile={vi.fn()} />)
    await waitFor(() => expect(screen.getByText(/clear all/i)).toBeInTheDocument())
  })
})
