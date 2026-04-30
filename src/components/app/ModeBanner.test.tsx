import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ModeBanner } from './ModeBanner'
import { usePdfStore } from '@/store/usePdfStore'

beforeEach(() => {
  usePdfStore.setState({ mode: 'idle', selectedId: null })
})

describe('ModeBanner', () => {
  it('renders nothing in idle mode', () => {
    const { container } = render(<ModeBanner />)
    expect(container).toBeEmptyDOMElement()
  })

  it.each([
    ['text', /add text/i],
    ['signature', /place signature/i],
    ['select', /^select$/i],
    ['draw', /^draw$/i],
    ['image', /place image/i],
    ['edit', /edit text/i],
  ] as const)('renders the right label for %s mode', (mode, pattern) => {
    usePdfStore.setState({ mode })
    render(<ModeBanner />)
    expect(screen.getByText(pattern)).toBeInTheDocument()
    expect(screen.getByText(/Esc to exit/i)).toBeInTheDocument()
  })

  it('Exit button returns the store to idle mode', async () => {
    usePdfStore.setState({ mode: 'text' })
    render(<ModeBanner />)
    await userEvent.click(screen.getByRole('button', { name: /exit/i }))
    expect(usePdfStore.getState().mode).toBe('idle')
  })
})
