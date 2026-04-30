import { create } from 'zustand'
import type { Annotation, Mode, PageInfo } from '@/types'
import { detectLang, persistLang, type Lang } from '@/utils/i18n'

interface PdfState {
  pdfBytes: Uint8Array | null
  fileName: string
  recentId: string | null  // IDB id of the currently-loaded PDF (for auto-save)
  annotations: Annotation[]
  pages: PageInfo[]
  mode: Mode
  selectedId: string | null
  pendingSignature: string | null
  pendingTextValue: string | null
  pendingDateMs: number | null
  // When set, the next click on a page in 'image' mode places this image.
  pendingImage: {
    dataUrl: string
    mime: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'
    width: number
    height: number
  } | null
  sigColor: string
  penColor: string
  penOpacity: number
  penWidth: number
  zoom: number
  formFieldEdits: Map<string, string | boolean>

  // Undo/redo history. Each entry is a snapshot of `annotations` *after* a
  // user action; in-memory only (session-scoped). historyIdx points at the
  // currently-applied snapshot.
  history: Annotation[][]
  historyIdx: number

  setPdf: (bytes: Uint8Array, name: string, recentId?: string | null) => void
  loadFromRecent: (
    bytes: Uint8Array, name: string, id: string,
    annotations: Annotation[], formFieldEdits: Array<[string, string | boolean]>,
  ) => void
  // Replace the loaded PDF bytes after a merge. Annotations stay; if the
  // merge inserted pages at the front, every annotation's pageIdx must be
  // shifted by +insertedCount to keep its position on the originally-named
  // page. `where: 'end'` is a no-op for annotations.
  mergeIntoPdf: (
    bytes: Uint8Array,
    where: 'start' | 'end',
    insertedCount: number,
  ) => void
  // Apply a page reorder: `newOrder[newIdx] = oldIdx`. Replaces pdfBytes
  // with the new (already-reordered) bytes, remaps every annotation's
  // pageIdx by `newOrder.indexOf(oldIdx)`, and resets history so undo
  // doesn't pop you back to a state where annotations were on the wrong
  // page numbers.
  reorderPages: (bytes: Uint8Array, newOrder: number[]) => void
  setPages: (pages: PageInfo[]) => void
  setMode: (mode: Mode) => void
  setSelectedId: (id: string | null) => void
  addAnnotation: (a: Annotation) => void
  updateAnnotation: (id: string, patch: Partial<Annotation>) => void
  removeAnnotation: (id: string) => void
  clearAnnotations: () => void
  undoAnnotation: () => void   // legacy: equivalent to undo()
  undo: () => void
  redo: () => void
  pushHistory: () => void
  setPendingSignature: (dataUrl: string | null) => void
  setPendingTextValue: (value: string | null) => void
  setPendingDateMs: (ms: number | null) => void
  setPendingImage: (img: PdfState['pendingImage']) => void
  setSigColor: (color: string) => void
  setPenColor: (color: string) => void
  setPenOpacity: (opacity: number) => void
  setPenWidth: (width: number) => void
  setZoom: (z: number) => void
  setFormField: (name: string, value: string | boolean) => void

  // UI language (auto-detected on first load, manual override stored in
  // localStorage via persistLang).
  lang: Lang
  setLang: (lang: Lang) => void
}

const HISTORY_CAP = 50

export const usePdfStore = create<PdfState>((set, get) => ({
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
  history: [[]],
  historyIdx: 0,

  setPdf: (pdfBytes, fileName, recentId = null) =>
    set({
      pdfBytes, fileName, recentId,
      annotations: [], formFieldEdits: new Map(),
      selectedId: null, mode: 'idle',
      history: [[]], historyIdx: 0,
    }),

  loadFromRecent: (pdfBytes, fileName, recentId, annotations, formFieldEdits) =>
    set({
      pdfBytes, fileName, recentId,
      annotations,
      formFieldEdits: new Map(formFieldEdits),
      selectedId: null, mode: 'idle',
      // Seed the history with the loaded snapshot so the first user action
      // creates a redo target above it.
      history: [annotations],
      historyIdx: 0,
    }),

  mergeIntoPdf: (pdfBytes, where, insertedCount) =>
    set((s) => {
      const remapped = where === 'start' && insertedCount > 0
        ? s.annotations.map((a) => ({ ...a, pageIdx: a.pageIdx + insertedCount }))
        : s.annotations
      return {
        pdfBytes,
        // pages will be repopulated by PdfViewer once the new bytes parse;
        // resetting now prevents a flash of the old page list against the
        // new (longer/shorter) document.
        pages: [],
        annotations: remapped,
        // Snapshot the post-merge annotations into history so undo from
        // here doesn't pop you back to a state that doesn't match the new
        // page layout (which would leave annotations on the wrong pages).
        history: [remapped],
        historyIdx: 0,
        selectedId: null, mode: 'idle',
      }
    }),

  reorderPages: (pdfBytes, newOrder) =>
    set((s) => {
      const remapped = s.annotations.map((a) => {
        const ni = newOrder.indexOf(a.pageIdx)
        return ni < 0 ? a : { ...a, pageIdx: ni }
      })
      return {
        pdfBytes,
        pages: [], // PdfViewer reparses
        annotations: remapped,
        history: [remapped],
        historyIdx: 0,
        selectedId: null, mode: 'idle',
      }
    }),

  setPages: (pages) => set({ pages }),
  setMode: (mode) =>
    set((s) => ({ mode, selectedId: mode === 'select' ? s.selectedId : null })),
  setSelectedId: (selectedId) => set({ selectedId }),

  addAnnotation: (a) =>
    set((s) => {
      const annotations = [...s.annotations, a]
      return { annotations, ...truncateAndPush(s, annotations) }
    }),

  updateAnnotation: (id, patch) =>
    set((s) => ({
      annotations: s.annotations.map((a) =>
        a.id === id ? ({ ...a, ...patch } as Annotation) : a,
      ),
    })),

  removeAnnotation: (id) =>
    set((s) => {
      const annotations = s.annotations.filter((a) => a.id !== id)
      return {
        annotations,
        selectedId: s.selectedId === id ? null : s.selectedId,
        ...truncateAndPush(s, annotations),
      }
    }),

  clearAnnotations: () =>
    set((s) => ({
      annotations: [], selectedId: null,
      ...truncateAndPush(s, []),
    })),

  undoAnnotation: () => get().undo(),

  undo: () => set((s) => {
    if (s.historyIdx <= 0) return s
    const idx = s.historyIdx - 1
    return { annotations: s.history[idx], historyIdx: idx, selectedId: null }
  }),

  redo: () => set((s) => {
    if (s.historyIdx >= s.history.length - 1) return s
    const idx = s.historyIdx + 1
    return { annotations: s.history[idx], historyIdx: idx, selectedId: null }
  }),

  // Public helper: snapshot the current annotations into history. Used by
  // updateAnnotation flows that want to mark a "settled" change (e.g. drag
  // end, resize end) without creating a snapshot for every intermediate value.
  pushHistory: () => set((s) => truncateAndPush(s, s.annotations)),

  setPendingSignature: (pendingSignature) => set({ pendingSignature }),
  setPendingTextValue: (pendingTextValue) => set({ pendingTextValue }),
  setPendingDateMs: (pendingDateMs) => set({ pendingDateMs }),
  setPendingImage: (pendingImage) => set({ pendingImage }),
  setSigColor: (sigColor) => set({ sigColor }),
  setPenColor: (penColor) => set({ penColor }),
  setPenOpacity: (penOpacity) => set({ penOpacity: Math.max(0, Math.min(1, penOpacity)) }),
  setPenWidth: (penWidth) => set({ penWidth: Math.max(0.5, Math.min(20, penWidth)) }),
  setZoom: (zoom) => set({ zoom: Math.max(0.25, Math.min(4, zoom)) }),
  setFormField: (name, value) =>
    set((s) => {
      const next = new Map(s.formFieldEdits)
      next.set(name, value)
      return { formFieldEdits: next }
    }),

  lang: detectLang(),
  setLang: (lang) => {
    persistLang(lang)
    set({ lang })
  },
}))

// Drop any redo entries above the current index, push the new snapshot,
// and cap the stack at HISTORY_CAP (oldest dropped).
function truncateAndPush(s: PdfState, snapshot: Annotation[]): Pick<PdfState, 'history' | 'historyIdx'> {
  const trimmed = s.history.slice(0, s.historyIdx + 1)
  trimmed.push(snapshot)
  while (trimmed.length > HISTORY_CAP) trimmed.shift()
  return { history: trimmed, historyIdx: trimmed.length - 1 }
}
