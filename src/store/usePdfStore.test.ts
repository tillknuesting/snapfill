import { beforeEach, describe, expect, it } from 'vitest'
import { usePdfStore } from './usePdfStore'
import type { Annotation, TextAnnotation, SignatureAnnotation, DrawingAnnotation } from '@/types'

const text: TextAnnotation = {
  id: 't1', type: 'text', pageIdx: 0, x: 10, y: 10, w: 100, h: 20,
  data: 'hello', fontSize: 14, family: 'helvetica', color: '#000',
}
const sig: SignatureAnnotation = {
  id: 's1', type: 'signature', pageIdx: 0, x: 50, y: 50, w: 100, h: 40,
  data: 'data:image/png;base64,FAKE',
}
const draw: DrawingAnnotation = {
  id: 'd1', type: 'drawing', pageIdx: 1, x: 0, y: 0, w: 50, h: 50,
  points: [[0, 0], [25, 25], [50, 50]], color: '#000', opacity: 1, strokeWidth: 2,
}

beforeEach(() => {
  // Reset the store to its initial state between tests
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
    sigColor: '#0a1f3d',
    penColor: '#0a1f3d',
    penOpacity: 1,
    penWidth: 2,
    zoom: 1,
    formFieldEdits: new Map(),
    history: [[]],
    historyIdx: 0,
  })
})

describe('setPdf', () => {
  it('stores bytes and filename and resets per-document state', () => {
    const s = usePdfStore.getState()
    s.addAnnotation(text)
    s.setSelectedId('t1')
    s.setMode('select')
    s.setFormField('email', 'a@b.c')
    expect(usePdfStore.getState().annotations).toHaveLength(1)

    const bytes = new Uint8Array([1, 2, 3])
    usePdfStore.getState().setPdf(bytes, 'doc.pdf')
    const after = usePdfStore.getState()
    expect(after.pdfBytes).toBe(bytes)
    expect(after.fileName).toBe('doc.pdf')
    expect(after.annotations).toEqual([])
    expect(after.selectedId).toBeNull()
    expect(after.mode).toBe('idle')
    expect(after.formFieldEdits.size).toBe(0)
  })
})

describe('setMode', () => {
  it('preserves selectedId when entering select mode', () => {
    usePdfStore.getState().setSelectedId('x1')
    usePdfStore.getState().setMode('select')
    expect(usePdfStore.getState().selectedId).toBe('x1')
  })

  it('clears selectedId when leaving select mode for any other mode', () => {
    usePdfStore.getState().setSelectedId('x1')
    usePdfStore.getState().setMode('text')
    expect(usePdfStore.getState().selectedId).toBeNull()
  })
})

describe('annotation CRUD', () => {
  it('adds annotations in order', () => {
    const s = usePdfStore.getState()
    s.addAnnotation(text)
    s.addAnnotation(sig)
    s.addAnnotation(draw)
    expect(usePdfStore.getState().annotations.map((a) => a.id)).toEqual(['t1', 's1', 'd1'])
  })

  it('updates an annotation by id, leaving the rest alone', () => {
    const s = usePdfStore.getState()
    s.addAnnotation(text)
    s.addAnnotation(sig)
    s.updateAnnotation('t1', { x: 99 })
    const list = usePdfStore.getState().annotations
    expect(list[0]).toMatchObject({ id: 't1', x: 99, data: 'hello' })
    expect(list[1]).toMatchObject({ id: 's1', x: 50 })
  })

  it('removeAnnotation also clears selection if it pointed there', () => {
    const s = usePdfStore.getState()
    s.addAnnotation(text)
    s.setSelectedId('t1')
    s.removeAnnotation('t1')
    const after = usePdfStore.getState()
    expect(after.annotations).toEqual([])
    expect(after.selectedId).toBeNull()
  })

  it('removeAnnotation leaves selection alone if it pointed elsewhere', () => {
    const s = usePdfStore.getState()
    s.addAnnotation(text)
    s.addAnnotation(sig)
    s.setSelectedId('s1')
    s.removeAnnotation('t1')
    expect(usePdfStore.getState().selectedId).toBe('s1')
  })

  it('clearAnnotations wipes everything and resets selection', () => {
    const s = usePdfStore.getState()
    s.addAnnotation(text)
    s.setSelectedId('t1')
    s.clearAnnotations()
    const after = usePdfStore.getState()
    expect(after.annotations).toEqual([])
    expect(after.selectedId).toBeNull()
  })

  it('undoAnnotation pops the last addition', () => {
    const s = usePdfStore.getState()
    s.addAnnotation(text)
    s.addAnnotation(sig)
    s.undoAnnotation()
    expect(usePdfStore.getState().annotations.map((a: Annotation) => a.id)).toEqual(['t1'])
  })

  it('undoAnnotation on an empty list is a no-op', () => {
    usePdfStore.getState().undoAnnotation()
    expect(usePdfStore.getState().annotations).toEqual([])
  })
})

describe('setFormField', () => {
  it('mutates the form-field map immutably', () => {
    const s = usePdfStore.getState()
    const before = s.formFieldEdits
    s.setFormField('name', 'Alice')
    s.setFormField('agreed', true)
    const after = usePdfStore.getState().formFieldEdits
    expect(after).not.toBe(before)
    expect(after.get('name')).toBe('Alice')
    expect(after.get('agreed')).toBe(true)
  })
})

describe('setZoom', () => {
  it('clamps to [0.25, 4]', () => {
    const s = usePdfStore.getState()
    s.setZoom(0.1)
    expect(usePdfStore.getState().zoom).toBe(0.25)
    s.setZoom(10)
    expect(usePdfStore.getState().zoom).toBe(4)
    s.setZoom(1.5)
    expect(usePdfStore.getState().zoom).toBe(1.5)
  })
})

describe('pen settings', () => {
  it('clamps opacity to [0, 1] and width to [0.5, 20]', () => {
    const s = usePdfStore.getState()
    s.setPenOpacity(-1)
    expect(usePdfStore.getState().penOpacity).toBe(0)
    s.setPenOpacity(2)
    expect(usePdfStore.getState().penOpacity).toBe(1)
    s.setPenWidth(0)
    expect(usePdfStore.getState().penWidth).toBe(0.5)
    s.setPenWidth(50)
    expect(usePdfStore.getState().penWidth).toBe(20)
  })

  it('color updates verbatim', () => {
    usePdfStore.getState().setPenColor('#dc2626')
    expect(usePdfStore.getState().penColor).toBe('#dc2626')
  })
})

describe('undo / redo history', () => {
  it('addAnnotation pushes a snapshot; undo restores the previous state', () => {
    const s = usePdfStore.getState()
    s.addAnnotation(text)
    expect(usePdfStore.getState().annotations).toHaveLength(1)
    s.undo()
    expect(usePdfStore.getState().annotations).toEqual([])
  })

  it('redo moves forward again', () => {
    const s = usePdfStore.getState()
    s.addAnnotation(text)
    s.undo()
    s.redo()
    expect(usePdfStore.getState().annotations).toHaveLength(1)
    expect(usePdfStore.getState().annotations[0].id).toBe('t1')
  })

  it('redo is a no-op when at the head of history', () => {
    const s = usePdfStore.getState()
    s.addAnnotation(text)
    const before = usePdfStore.getState().annotations
    s.redo()
    expect(usePdfStore.getState().annotations).toBe(before)
  })

  it('undo is a no-op when at the start of history', () => {
    const s = usePdfStore.getState()
    s.undo()
    expect(usePdfStore.getState().annotations).toEqual([])
  })

  it('removeAnnotation also adds to history (so it can be undone)', () => {
    const s = usePdfStore.getState()
    s.addAnnotation(text)
    s.addAnnotation(sig)
    s.removeAnnotation('t1')
    expect(usePdfStore.getState().annotations).toHaveLength(1)
    s.undo()
    expect(usePdfStore.getState().annotations).toHaveLength(2)
  })

  it('a new addition after undo discards the old redo branch', () => {
    const s = usePdfStore.getState()
    s.addAnnotation(text)
    s.addAnnotation(sig)  // history: [], [text], [text+sig]
    s.undo()              // back to [text], redo target is [text+sig]
    s.addAnnotation(draw) // forks: [], [text], [text+draw]; sig should not be redoable
    expect(usePdfStore.getState().annotations.map((a) => a.id)).toEqual(['t1', 'd1'])
    s.redo()
    // redo head — there is none
    expect(usePdfStore.getState().annotations.map((a) => a.id)).toEqual(['t1', 'd1'])
  })

  it('clearAnnotations is reversible via undo', () => {
    const s = usePdfStore.getState()
    s.addAnnotation(text)
    s.addAnnotation(sig)
    s.clearAnnotations()
    expect(usePdfStore.getState().annotations).toEqual([])
    s.undo()
    expect(usePdfStore.getState().annotations).toHaveLength(2)
  })

  it('caps the history stack at exactly HISTORY_CAP entries', () => {
    const s = usePdfStore.getState()
    for (let i = 0; i < 80; i++) {
      s.addAnnotation({ ...text, id: `t-${i}` })
    }
    // Pinned to the exact value defined in usePdfStore.ts. If the cap is
    // intentionally tuned, update both this test and the source constant
    // — a deliberate, traceable change instead of a silent drift.
    expect(usePdfStore.getState().history.length).toBe(50)
  })
})

describe('mergeIntoPdf', () => {
  it("appends ('end') keeps annotation pageIdx unchanged", () => {
    const s = usePdfStore.getState()
    s.setPdf(new Uint8Array([1, 2, 3]), 'a.pdf')
    s.addAnnotation(text)             // page 0
    s.addAnnotation(draw)             // page 1
    s.mergeIntoPdf(new Uint8Array([4, 5, 6]), 'end', 3)
    const after = usePdfStore.getState()
    expect(after.pdfBytes).toEqual(new Uint8Array([4, 5, 6]))
    expect(after.annotations.find((a) => a.id === 't1')!.pageIdx).toBe(0)
    expect(after.annotations.find((a) => a.id === 'd1')!.pageIdx).toBe(1)
  })

  it("prepends ('start') shifts every annotation's pageIdx by insertedCount", () => {
    const s = usePdfStore.getState()
    s.setPdf(new Uint8Array([1, 2, 3]), 'a.pdf')
    s.addAnnotation(text)             // page 0
    s.addAnnotation(draw)             // page 1
    s.mergeIntoPdf(new Uint8Array([4, 5, 6]), 'start', 3)
    const after = usePdfStore.getState()
    expect(after.annotations.find((a) => a.id === 't1')!.pageIdx).toBe(3)
    expect(after.annotations.find((a) => a.id === 'd1')!.pageIdx).toBe(4)
  })

  it('resets history to a single snapshot of post-merge annotations', () => {
    const s = usePdfStore.getState()
    s.setPdf(new Uint8Array([1, 2, 3]), 'a.pdf')
    s.addAnnotation(text)
    s.mergeIntoPdf(new Uint8Array([4, 5, 6]), 'start', 2)
    const after = usePdfStore.getState()
    expect(after.historyIdx).toBe(0)
    expect(after.history).toHaveLength(1)
    expect(after.history[0][0].pageIdx).toBe(2)
  })

  it("zero-page insert does not shift annotations even with where='start'", () => {
    const s = usePdfStore.getState()
    s.setPdf(new Uint8Array([1]), 'a.pdf')
    s.addAnnotation(text)
    s.mergeIntoPdf(new Uint8Array([2]), 'start', 0)
    const after = usePdfStore.getState()
    expect(after.annotations.find((a) => a.id === 't1')!.pageIdx).toBe(0)
  })

  it('clears pages array (PdfViewer will repopulate after re-parse)', () => {
    const s = usePdfStore.getState()
    s.setPdf(new Uint8Array([1, 2, 3]), 'a.pdf')
    usePdfStore.setState({ pages: [{
      pageIdx: 0, cssWidth: 800, cssHeight: 1000, pdfWidth: 612, pdfHeight: 792,
    }] })
    s.mergeIntoPdf(new Uint8Array([4, 5, 6]), 'end', 1)
    expect(usePdfStore.getState().pages).toEqual([])
  })
})

describe('reorderPages', () => {
  it('remaps each annotation pageIdx via newOrder.indexOf', () => {
    const s = usePdfStore.getState()
    s.setPdf(new Uint8Array([1]), 'a.pdf')
    // Three pages, three annotations — one per page.
    s.addAnnotation({ ...text, id: 'p0', pageIdx: 0 })
    s.addAnnotation({ ...text, id: 'p1', pageIdx: 1 })
    s.addAnnotation({ ...text, id: 'p2', pageIdx: 2 })
    // newOrder=[2,0,1] means: new page 0 is old page 2, new page 1 is old
    // page 0, new page 2 is old page 1. So annotation on old 0 → new 1,
    // old 1 → new 2, old 2 → new 0.
    s.reorderPages(new Uint8Array([2]), [2, 0, 1])
    const after = usePdfStore.getState()
    expect(after.annotations.find((a) => a.id === 'p0')!.pageIdx).toBe(1)
    expect(after.annotations.find((a) => a.id === 'p1')!.pageIdx).toBe(2)
    expect(after.annotations.find((a) => a.id === 'p2')!.pageIdx).toBe(0)
  })

  it('replaces pdfBytes and clears the pages array', () => {
    const s = usePdfStore.getState()
    s.setPdf(new Uint8Array([9]), 'a.pdf')
    usePdfStore.setState({ pages: [{
      pageIdx: 0, cssWidth: 800, cssHeight: 1000, pdfWidth: 612, pdfHeight: 792,
    }] })
    const newBytes = new Uint8Array([1, 2, 3])
    s.reorderPages(newBytes, [0])
    const after = usePdfStore.getState()
    expect(after.pdfBytes).toEqual(newBytes)
    expect(after.pages).toEqual([])
  })

  it('snapshots post-reorder annotations into history (resets undo stack)', () => {
    const s = usePdfStore.getState()
    s.setPdf(new Uint8Array([1]), 'a.pdf')
    s.addAnnotation({ ...text, id: 'p0', pageIdx: 0 })
    s.reorderPages(new Uint8Array([2]), [0])
    const after = usePdfStore.getState()
    expect(after.historyIdx).toBe(0)
    expect(after.history).toHaveLength(1)
  })
})

describe('loadFromRecent', () => {
  it('replaces state with the recent record and resets history', () => {
    const s = usePdfStore.getState()
    s.addAnnotation(text)
    s.loadFromRecent(
      new Uint8Array([7, 7, 7]),
      'other.pdf',
      'rec-id',
      [sig, draw],
      [['name', 'Bob']],
    )
    const after = usePdfStore.getState()
    expect(after.fileName).toBe('other.pdf')
    expect(after.recentId).toBe('rec-id')
    expect(after.annotations).toEqual([sig, draw])
    expect(after.formFieldEdits.get('name')).toBe('Bob')
    expect(after.historyIdx).toBe(0)
    expect(after.history[0]).toEqual([sig, draw])
  })
})
