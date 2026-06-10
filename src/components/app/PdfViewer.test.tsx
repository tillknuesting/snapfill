import { act } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import * as pdfjsLib from 'pdfjs-dist'
import { PdfViewer } from './PdfViewer'
import { usePdfStore } from '@/store/usePdfStore'
import { DEFAULT_PAGE_NUMBERS } from '@/utils/pageNumbers'
import { DEFAULT_WATERMARK } from '@/utils/watermark'

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  PasswordResponses: {
    NEED_PASSWORD: 1,
    INCORRECT_PASSWORD: 2,
  },
  getDocument: vi.fn(),
}))

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({
  default: 'pdf-worker-url',
}))

interface MockLoadingTask {
  onPassword?: (submit: (password: string) => void, reason: number) => void
  promise: Promise<never>
  destroy: ReturnType<typeof vi.fn>
}

let task: MockLoadingTask

function resetStore() {
  usePdfStore.setState({
    pdfBytes: new Uint8Array([1, 2, 3]),
    fileName: 'locked.pdf',
    recentId: null,
    annotations: [],
    pages: [],
    mode: 'idle',
    selectedId: null,
    pendingSignature: null,
    pendingTextValue: null,
    pendingDateMs: null,
    pendingImage: null,
    sigColor: '#0a1f3d',
    penColor: '#0a1f3d',
    penOpacity: 1,
    penWidth: 2,
    drawingTool: 'pen',
    zoom: 1,
    formFieldEdits: new Map(),
    watermark: DEFAULT_WATERMARK,
    pageNumbers: DEFAULT_PAGE_NUMBERS,
    history: [[]],
    historyIdx: 0,
    lang: 'en',
  })
}

function renderViewer() {
  render(
    <PdfViewer
      textFamily="helvetica"
      textSize={14}
      textColor="#0a1f3d"
      snapEnabled
    />,
  )
}

beforeEach(() => {
  resetStore()
  task = {
    promise: new Promise<never>(() => {}),
    destroy: vi.fn().mockResolvedValue(undefined),
  }
  vi.mocked(pdfjsLib.getDocument).mockReturnValue(task as unknown as ReturnType<typeof pdfjsLib.getDocument>)
})

describe('PdfViewer password unlock', () => {
  it('submits the entered password to PDF.js', async () => {
    renderViewer()

    await waitFor(() => expect(task.onPassword).toBeTypeOf('function'))
    const submit = vi.fn()
    act(() => {
      task.onPassword?.(submit, pdfjsLib.PasswordResponses.NEED_PASSWORD)
    })

    expect(await screen.findByRole('dialog', { name: /unlock pdf/i })).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText(/password/i), 'secret')
    await userEvent.click(screen.getByRole('button', { name: /^unlock$/i }))

    expect(submit).toHaveBeenCalledWith('secret')
    expect(screen.queryByRole('dialog', { name: /unlock pdf/i })).not.toBeInTheDocument()
  })

  it('shows retry copy after an incorrect password', async () => {
    renderViewer()

    await waitFor(() => expect(task.onPassword).toBeTypeOf('function'))
    act(() => {
      task.onPassword?.(vi.fn(), pdfjsLib.PasswordResponses.INCORRECT_PASSWORD)
    })

    expect(await screen.findByText(/password did not work/i)).toBeInTheDocument()
  })

  it('closes the current PDF when unlock is cancelled', async () => {
    renderViewer()

    await waitFor(() => expect(task.onPassword).toBeTypeOf('function'))
    act(() => {
      task.onPassword?.(vi.fn(), pdfjsLib.PasswordResponses.NEED_PASSWORD)
    })

    await userEvent.click(await screen.findByRole('button', { name: /cancel/i }))
    expect(usePdfStore.getState().pdfBytes).toBeNull()
  })
})
