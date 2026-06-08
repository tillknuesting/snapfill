import { beforeEach, describe, expect, it } from 'vitest'
import { fireEvent, render } from '@testing-library/react'
import { Annotation } from './Annotation'
import { usePdfStore } from '@/store/usePdfStore'
import { DEFAULT_WATERMARK } from '@/utils/watermark'
import type { PageInfo, TextAnnotation } from '@/types'

const PAGE: PageInfo = {
  pageIdx: 0,
  cssWidth: 600,
  cssHeight: 800,
  pdfWidth: 600,
  pdfHeight: 800,
}

const text: TextAnnotation = {
  id: 't1',
  type: 'text',
  pageIdx: 0,
  x: 10,
  y: 10,
  w: 100,
  h: 20,
  data: 'start',
  fontSize: 14,
  family: 'helvetica',
  color: '#000000',
}

beforeEach(() => {
  usePdfStore.setState({
    pdfBytes: null,
    fileName: '',
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
    zoom: 1,
    formFieldEdits: new Map(),
    watermark: DEFAULT_WATERMARK,
    history: [[]],
    historyIdx: 0,
    lang: 'en',
  })
})

describe('Annotation text history', () => {
  it('snapshots typed text on blur so app undo restores the prior value', () => {
    const initial = { ...text }
    usePdfStore.setState({
      annotations: [initial],
      history: [[initial]],
      historyIdx: 0,
    })

    const { container } = render(<Annotation annotation={initial} page={PAGE} scale={1} />)
    const editor = container.querySelector<HTMLDivElement>('[contenteditable="true"]')
    expect(editor).not.toBeNull()

    editor!.innerHTML = 'changed'
    fireEvent.input(editor!)
    fireEvent.blur(editor!)

    expect(usePdfStore.getState().annotations[0]).toMatchObject({ data: 'changed' })
    expect(usePdfStore.getState().history).toHaveLength(2)

    usePdfStore.getState().undo()
    expect(usePdfStore.getState().annotations[0]).toMatchObject({ data: 'start' })
  })
})
