# Deep Review — `deep-review-tests` branch

A pass over `src/` (excluding stock shadcn UI under `src/components/ui/`),
build configs, and the legacy prototype. Findings are grouped by severity;
items already addressed in this branch are marked **(fixed)**.

## Critical

- **XSS via `innerHTML` round-trip on the contentEditable editor.**
  `Annotation.tsx` writes `el.innerHTML = annotation.data`, and `buildPdf.ts`
  parses the same HTML for output. Anything pasted into the rich-text editor
  (e.g. `<img onerror=alert(1)>`) would round-trip and execute when assigned
  back via `innerHTML`. **(fixed)** — added an `onPaste` handler on the editor
  that prevents default and re-inserts the clipboard's `text/plain` payload
  via `insertText`. No HTML markup can enter the editor anymore. (`Annotation.tsx`)

## High

- **Per-`pointermove` state copy when drawing.** `setCurrentStroke` was
  invoked on every move event, copying the entire points array each time;
  on a 120 Hz pointer this triggered hundreds of renders/sec for long
  strokes (O(n²) total work over a stroke). **(fixed)** — moved raw points
  into a `useRef` array; renders are coalesced via `requestAnimationFrame`
  so the SVG preview updates at most once per frame. RAF is cancelled on
  pointer up / cancel. (`PdfPage.tsx`)

- **Discriminated-union narrowing not exhaustive.** The signature/drawing
  resize branch and text-only branch in `Annotation.tsx` rely on control
  flow rather than an explicit `else if`/`assertNever` switch. Adding a new
  annotation type would compile silently. *Not fixed* — left as a follow-up
  refactor; the new test suite will catch behavioural regressions.

- **`document.execCommand` is officially deprecated** for bold/italic/underline
  and `insertLineBreak`. Browsers still support it but standards-track
  alternatives use the `Selection` / `Range` APIs. *Not fixed* — works
  reliably across current browsers; replacing means writing a small editor
  command layer. Acceptable for now; flag for future.

## Medium

- **`useLayoutEffect` deps in auto-grow** suppressed the `react-hooks/exhaustive-deps`
  rule. Justification (the `updateAnnotation` ref is stable in zustand)
  is valid; left documented in the inline comment.

- **`detectFormRows` magic constant 1.35×.** Now documented inline with
  the rationale for the threshold (typical bureaucratic forms put section
  gaps at ~1.4–1.5× line spacing). **(fixed — comment added.)**

- **Snap font-size factor `0.72`** likewise documented in `PdfPage.tsx`
  — chosen so text fits comfortably with ~14% padding above and below in
  the typical 14–22 pt row. **(fixed — comment added.)**

- **`as unknown as ...` casts on pdf-lib form fields** in `buildPdf.ts`
  bypass type checking. Try/catch already swallows mismatches, but a
  future pdf-lib upgrade could silently break field flattening. *Not
  fixed* — the integration test at the bottom of `buildPdf.test.ts` would
  catch a regression in the form-flatten pipeline.

## Low / Nits

- **`recentFiles.ts`** asserts `IDBRequest.result as RecentRecord[]`
  without validating shape. If the DB schema ever changes, malformed
  records would survive. Tolerable for a single-user local cache;
  documented in `LICENSES.md`-adjacent context.

- **`App.tsx`** keyboard handler compares `tagName === 'INPUT'` /
  `'TEXTAREA'` without case-folding. JSDOM and modern browsers always
  return uppercase, so safe today.

- **`fonts.ts`** `normalizeFamily` silently maps unknown ids to
  `'helvetica'`. Acceptable as a migration fallback for legacy `helvB` /
  `sans` style values; logging would clutter console with no benefit.

## Test coverage added in this branch

| Area | New tests |
|---|---|
| Zustand store (`usePdfStore.ts`) | 12 tests covering setPdf reset, setMode selection rules, CRUD, formField map immutability, zoom and pen clamping |
| `detectFormRows` end-to-end | 6 tests exercising the full operator-list → cells pipeline (including section-break gap, vertical divider coverage threshold, single-line fallback, empty-page) |
| `recentFiles` IndexedDB layer | 8 tests via `fake-indexeddb` (round-trip, dedupe, cap at 10, ordering, remove, missing id, clear, empty) |
| `trimSignature` | 2 tests with a stub canvas (no jsdom 2D backend) |
| `buildPdf` integration | 8 tests creating real PDFs via pdf-lib, applying every annotation type and mixed cases, asserting the output round-trips |
| `Toolbar.tsx` | 11 RTL tests — disabled state, mode toggling, Today date stamp, undo/clear, zoom controls |
| `ProfileDialog.tsx` | 8 RTL tests — list, insert, label persistence, add/remove field, Insert disabled when no PDF |
| `ModeBanner.tsx` | 6 RTL tests — visibility per mode, exit button |
| `EmptyState.tsx` | 4 RTL tests — drop zone, recents list rendering, Clear all visibility, click-to-load |
| `FloatingToolbar.tsx` | 5 RTL tests — Delete, B/I/U exec, date select visibility, pen swatch readout |

Total new tests: **~70**. Combined with the existing `~67`, the suite now
covers ~140 tests across pure utilities, the store, and most of the
non-trivial UI.

Tests still skipped (intentional):
- Drag/resize gestures on `Annotation` need `setPointerCapture`/pointer
  event ordering that JSDOM models incompletely; we'd need Playwright
  for true behaviour. Left for an e2e suite.
- `SignatureModal` Draw tab depends on `<canvas>` 2D rendering, which
  jsdom doesn't implement.
- `PdfViewer` requires a real `pdf.js` worker.
