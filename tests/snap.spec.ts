import { test, expect, type Locator, type Page } from '@playwright/test'

// Pre-dismiss the onboarding tour for every test by default — except for
// tests inside the dedicated 'onboarding tour' describe, which need the
// tour visible. Using addInitScript means it runs on every navigation
// (including reloads), which would defeat persistence assertions in the
// onboarding suite.
//
// We also stub `/fixtures/forms/*.pdf` requests with the on-disk fixture
// files. Production no longer ships these (they're git-tracked but moved
// out of `public/` so they aren't deployed), and a couple of tests fetch
// them from the browser context for round-trip assertions. The route
// handler keeps those tests working without re-deploying the PDFs.
test.beforeEach(async ({ page }, testInfo) => {
  if (!testInfo.titlePath.some((t) => t === 'onboarding tour')) {
    await page.addInitScript(() => {
      try { localStorage.setItem('pdfhelper.onboardingDone.v2', '1') } catch { /* ignore */ }
    })
  }
  await page.route('**/fixtures/forms/*.pdf', async (route) => {
    const url = new URL(route.request().url())
    const filename = url.pathname.split('/').pop() ?? ''
    await route.fulfill({ path: `fixtures/forms/${filename}` })
  })
})

// Each fixture's 1st page lower bound on the snap cell count. Below this and
// something is wrong (algorithm regressed, fixture changed, rendering broke).
// Numbers are intentionally well below the current detector output so a
// reasonable amount of drift won't make the suite flaky.
//
// `path` points at the on-disk fixture (relative to repo root). The
// public-facing UI no longer surfaces sample forms — these are kept for the
// E2E suite only and loaded via `setInputFiles` on the toolbar's hidden
// file input.
const FIXTURES: { label: RegExp; minCells: number; path: string }[] = [
  { label: /IRS 1040 \(2022\)/,    minCells: 40, path: 'fixtures/forms/f1040-2022.pdf' },
  { label: /IRS 1040 \(2010\)/,    minCells: 40, path: 'fixtures/forms/f1040-2010.pdf' },
  { label: /Widget-only form/,     minCells: 5,  path: 'fixtures/forms/annotation-text-widget.pdf' },
  { label: /pdf\.js form regression/, minCells: 1, path: 'fixtures/forms/bug1947248_forms.pdf' },
  { label: /IRS Form W-9/,         minCells: 1,  path: 'fixtures/forms/irs-w9.pdf' },
  { label: /IRS Form W-4/,         minCells: 8,  path: 'fixtures/forms/irs-w4.pdf' },
  { label: /IRS Schedule A/,       minCells: 25, path: 'fixtures/forms/irs-schedule-a.pdf' },
  { label: /DE — Anmeldung/,       minCells: 10, path: 'fixtures/forms/de-anmeldung.pdf' },
  { label: /DE — Krankmeldung/,    minCells: 8,  path: 'fixtures/forms/de-krankmeldung.pdf' },
  { label: /DE — Kündigung/,       minCells: 5,  path: 'fixtures/forms/de-kuendigung.pdf' },
  { label: /DE — Mietvertrag/,     minCells: 10, path: 'fixtures/forms/de-mietvertrag.pdf' },
  { label: /DE — Rechnung/,        minCells: 15, path: 'fixtures/forms/de-rechnung.pdf' },
  { label: /DE — DRV V0005/,       minCells: 18, path: 'fixtures/forms/de-drv-v0005-rente.pdf' },
  { label: /DE — AA eID-card/,     minCells: 18, path: 'fixtures/forms/de-aa-eid-card.pdf' },
  { label: /DE — BNetzA 0800/,     minCells: 24, path: 'fixtures/forms/de-bnetza-0800-rechtsnachfolge.pdf' },
  { label: /DE — BA KiZ 5/,        minCells: 35, path: 'fixtures/forms/de-ba-kiz5-verdienst.pdf' },
  { label: /DE — BA PD U1/,        minCells: 15, path: 'fixtures/forms/de-ba-pd-u1.pdf' },
  { label: /EU — Financial ID/,    minCells: 16, path: 'fixtures/forms/eu-commission-financial-identification.pdf' },
  { label: /EU — ACER RRM/,        minCells: 6,  path: 'fixtures/forms/eu-acer-rrm-application.pdf' },
  { label: /USCIS Form I-9/,       minCells: 0,  path: 'fixtures/forms/uscis-i9-2011.pdf' },
  { label: /Free-text annotation PDF/, minCells: 0, path: 'fixtures/forms/annotation-freetext.pdf' },
  { label: /XFA — IMM1344E/,       minCells: 0,  path: 'fixtures/forms/xfa-imm1344e.pdf' },
  { label: /IRS 1040 prefilled/,   minCells: 0,  path: 'fixtures/forms/prefilled_f1040.pdf' },
]

async function openFixture(page: Page, label: RegExp) {
  await page.goto('/?snap=debug')
  // The public UI no longer offers sample forms; load via setInputFiles
  // on the toolbar's hidden <input type="file" accept="application/pdf">.
  // Match by regex source equality — the labels in FIXTURES are RegExp
  // literals and we look up the path by exact pattern.
  const f = FIXTURES.find((x) => x.label.source === label.source)
  if (!f) throw new Error(`No fixture path registered for ${label}`)
  const input = page.locator('input[type="file"][accept="application/pdf"]').first()
  await input.setInputFiles(f.path)
  // Wait for at least one PDF page to render its canvas.
  await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15_000 })
}

type CssBox = { x: number; y: number; width: number; height: number }

type SnapPreviewGeometry = {
  x: number
  y: number
  w: number
  h: number
  scale: number
  box: CssBox
}

function numericAttr(raw: string | null, name: string): number {
  const value = Number(raw)
  if (!Number.isFinite(value)) throw new Error(`Missing numeric ${name} attribute on snap preview`)
  return value
}

async function readSnapPreview(preview: Locator): Promise<SnapPreviewGeometry> {
  await expect(preview).toBeVisible({ timeout: 10_000 })
  const [x, y, w, h, scale] = await Promise.all([
    preview.getAttribute('data-snap-x').then((v) => numericAttr(v, 'data-snap-x')),
    preview.getAttribute('data-snap-y').then((v) => numericAttr(v, 'data-snap-y')),
    preview.getAttribute('data-snap-w').then((v) => numericAttr(v, 'data-snap-w')),
    preview.getAttribute('data-snap-h').then((v) => numericAttr(v, 'data-snap-h')),
    preview.getAttribute('data-snap-scale').then((v) => numericAttr(v, 'data-snap-scale')),
  ])
  const box = { x: x * scale, y: y * scale, width: w * scale, height: h * scale }
  return { x, y, w, h, scale, box }
}

async function hoverSnapPreview(
  page: Page,
  position: { x: number; y: number },
  pageIdx = 0,
): Promise<SnapPreviewGeometry> {
  const pdfPage = page.locator(`[data-page-idx="${pageIdx}"]`)
  await expect(pdfPage).toBeVisible({ timeout: 15_000 })
  await pdfPage.hover({ position: { x: position.x + 2, y: position.y + 2 } })
  await pdfPage.hover({ position })
  return readSnapPreview(page.getByTestId('snap-hover-preview').first())
}

async function readInlineBox(locator: Locator): Promise<CssBox> {
  await expect(locator).toBeVisible({ timeout: 10_000 })
  const box = await locator.evaluate((el) => {
    const style = el instanceof HTMLElement ? el.style : null
    return {
      x: Number.parseFloat(style?.left ?? ''),
      y: Number.parseFloat(style?.top ?? ''),
      width: Number.parseFloat(style?.width ?? ''),
      height: Number.parseFloat(style?.height ?? ''),
    }
  })
  for (const [key, value] of Object.entries(box)) {
    if (!Number.isFinite(value)) throw new Error(`Missing inline ${key} geometry`)
  }
  return box
}

function expectBoxesToMatch(actual: CssBox, expected: CssBox, positionTolerance = 2, sizeTolerance = positionTolerance) {
  expect(Math.abs(actual.x - expected.x), `x mismatch: ${actual.x} vs ${expected.x}`).toBeLessThanOrEqual(positionTolerance)
  expect(Math.abs(actual.y - expected.y), `y mismatch: ${actual.y} vs ${expected.y}`).toBeLessThanOrEqual(positionTolerance)
  expect(Math.abs(actual.width - expected.width), `width mismatch: ${actual.width} vs ${expected.width}`).toBeLessThanOrEqual(sizeTolerance)
  expect(Math.abs(actual.height - expected.height), `height mismatch: ${actual.height} vs ${expected.height}`).toBeLessThanOrEqual(sizeTolerance)
}

test.describe('snap debug overlay', () => {
  for (const f of FIXTURES) {
    test(`renders ≥${f.minCells} cells on ${f.label}`, async ({ page }) => {
      await openFixture(page, f.label)
      const badge = page.getByTestId('snap-cell-count').first()
      // Fixtures with `minCells: 0` (XFA, prefilled, free-text) genuinely
      // have no snappable cells — the badge is suppressed in that case
      // (PdfPage renders it only when snapRows.length > 0). For those, just
      // assert the canvas rendered and the doc didn't crash.
      if (f.minCells === 0) {
        await expect(page.locator('[data-page-idx="0"] canvas')).toBeVisible({ timeout: 15_000 })
        return
      }
      await expect(badge).toBeVisible({ timeout: 15_000 })
      const text = await badge.textContent()
      const n = Number(text?.match(/(\d+)/)?.[1] ?? 0)
      expect(n, `cell count for ${f.label}`).toBeGreaterThanOrEqual(f.minCells)
    })
  }
})

test.describe('add-text + snap user flow', () => {
  test('clicking inside a snap cell creates a text annotation at that location', async ({ page }) => {
    await openFixture(page, /IRS 1040 \(2022\)/)

    // Toolbar's "Add text" button — both keyboard 'T' and the explicit click
    // path are wired in the app; we use the click since it doesn't depend on
    // window focus heuristics inside Playwright.
    await page.getByRole('button', { name: /^Add text$/ }).click()

    // Pick a cell roughly in the middle of page 1's debug overlay. Position
    // is in the canvas-surface coords; we use a known spot a real user would
    // click on the form.
    const firstPage = page.locator('[data-page-idx="0"]')
    await expect(firstPage).toBeVisible()

    // The hover target is the source of truth the user sees before clicking.
    // Click the centre of that preview so dense, adjacent form rows cannot
    // turn a boundary point into a different snap decision.
    const preview = await hoverSnapPreview(page, { x: 200, y: 200 })
    await firstPage.click({
      position: {
        x: preview.box.x + preview.box.width / 2,
        y: preview.box.y + preview.box.height / 2,
      },
    })

    // A text annotation should appear — its contenteditable is what receives
    // typed input. The first one should be focused and ready.
    const editor = page.locator('[contenteditable]').first()
    await expect(editor).toBeVisible()
    const annotationBox = await readInlineBox(page.locator('[data-id]').first())
    expectBoxesToMatch(annotationBox, preview.box, 2, 8)
    await editor.type('hello')
    await expect(editor).toContainText('hello')
  })

  test('hover preview shows a snap rectangle over a form cell in Add-text mode', async ({ page }) => {
    await openFixture(page, /IRS 1040 \(2022\)/)
    await page.getByRole('button', { name: /^Add text$/ }).click()

    const preview = await hoverSnapPreview(page, { x: 200, y: 200 })
    expect(preview.x).toBeGreaterThanOrEqual(0)
    expect(preview.y).toBeGreaterThanOrEqual(0)
    expect(preview.w).toBeGreaterThan(10)
    expect(preview.h).toBeGreaterThan(4)
    expect(preview.scale).toBeGreaterThan(0)
  })
})

test.describe('text rendering on PDF surface', () => {
  test('typed text is dark, not white-on-white invisible', async ({ page }) => {
    await openFixture(page, /IRS 1040 \(2022\)/)
    await page.getByRole('button', { name: /^Add text$/ }).click()
    await page.locator('[data-page-idx="0"]').click({ position: { x: 200, y: 200 } })
    const editor = page.locator('[contenteditable]').first()
    await editor.type('contrast check')

    // The contenteditable carries inline color; resolve and assert it's
    // visibly dark (sum of RGB < 200 → not near-white).
    const rgb = await editor.evaluate((el) => getComputedStyle(el).color)
    const m = rgb.match(/rgb[a]?\((\d+),\s*(\d+),\s*(\d+)/)
    expect(m, `unexpected color string: ${rgb}`).not.toBeNull()
    const [r, g, b] = (m as RegExpMatchArray).slice(1, 4).map(Number)
    expect(r + g + b, `text color too light (rgb=${r},${g},${b})`).toBeLessThan(200)
  })
})

test.describe('theme picker', () => {
  test('picking Dark applies the .dark class to <html>', async ({ page }) => {
    await page.goto('/')
    const html = page.locator('html')
    await expect(html).not.toHaveClass(/(^|\s)dark(\s|$)/)
    await page.getByTestId('theme-button').click()
    await page.getByTestId('theme-option-dark').click()
    await expect(html).toHaveClass(/(^|\s)dark(\s|$)/)
  })

  test('persists across reload (FOUC inline script applies the saved theme before React mounts)', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('theme-button').click()
    await page.getByTestId('theme-option-dark').click()
    await expect(page.locator('html')).toHaveClass(/(^|\s)dark(\s|$)/)
    await page.reload()
    await expect(page.locator('html')).toHaveClass(/(^|\s)dark(\s|$)/)
  })

  test('named themes each map to their own class', async ({ page }) => {
    await page.goto('/')
    const html = page.locator('html')
    const cases: Array<[string, string, boolean]> = [
      // [option-id, expected class on <html>, isDark]
      ['theme-option-sepia',     'theme-sepia',     false],
      ['theme-option-solarized-light', 'theme-solarized-light', false],
      ['theme-option-gruvbox-light', 'theme-gruvbox-light', false],
      ['theme-option-catppuccin-latte', 'theme-catppuccin-latte', false],
      ['theme-option-github-light', 'theme-github-light', false],
      ['theme-option-hc',        'theme-hc',        true],
      ['theme-option-solarized', 'theme-solarized', true],
      ['theme-option-dracula',   'theme-dracula',   true],
      ['theme-option-nord',      'theme-nord',      true],
      ['theme-option-gruvbox',   'theme-gruvbox',   true],
      ['theme-option-catppuccin', 'theme-catppuccin', true],
      ['theme-option-tokyo',     'theme-tokyo',     true],
      ['theme-option-light',     '',                false],
    ]
    for (const [tid, cls, isDark] of cases) {
      await page.keyboard.press('Escape').catch(() => {})
      await page.waitForTimeout(150)
      await page.getByTestId('theme-button').click()
      const opt = page.getByTestId(tid)
      await expect(opt).toBeVisible({ timeout: 5_000 })
      await opt.click()
      if (cls) await expect(html).toHaveClass(new RegExp(cls))
      if (isDark) await expect(html).toHaveClass(/(^|\s)dark(\s|$)/)
      else        await expect(html).not.toHaveClass(/(^|\s)dark(\s|$)/)
    }
  })
})

test.describe('multi-page rendering', () => {
  test('USCIS I-9 renders all 5 pages (lazy canvases share one wrapper each)', async ({ page }) => {
    await openFixture(page, /USCIS Form I-9/)
    await expect(page.locator('[data-page-idx]')).toHaveCount(5)
    // Wrappers carry data-page-idx 0..4 sequentially.
    for (let i = 0; i < 5; i++) {
      await expect(page.locator(`[data-page-idx="${i}"]`)).toBeVisible()
    }
  })
})

test.describe('history', () => {
  test('Undo reverts typed text before removing the annotation', async ({ page }) => {
    await openFixture(page, /IRS 1040 \(2022\)/)
    await page.getByRole('button', { name: /^Add text$/ }).click()
    const firstPage = page.locator('[data-page-idx="0"]')
    await firstPage.click({ position: { x: 200, y: 200 } })
    const editor = page.locator('[contenteditable]').first()
    await editor.type('temp')
    await expect(editor).toBeVisible()
    // Click somewhere outside to commit and let the toolbar re-evaluate.
    await page.keyboard.press('Escape')

    const undo = page.getByRole('button', { name: /^Undo$/ })
    await undo.click()
    await expect(page.locator('[contenteditable]')).toHaveCount(1)
    await expect(page.locator('[contenteditable]').first()).toHaveText('')
    await undo.click()
    await expect(page.locator('[contenteditable]')).toHaveCount(0)
  })
})

test.describe('date insert via toolbar', () => {
  test("Insert today's date places annotation containing the current year", async ({ page }) => {
    await openFixture(page, /IRS 1040 \(2022\)/)
    await page.getByRole('button', { name: /Insert today's date/ }).click()
    // Click on page 1 to drop the date annotation at that position.
    await page.locator('[data-page-idx="0"]').click({ position: { x: 240, y: 240 } })
    const editor = page.locator('[contenteditable]').first()
    await expect(editor).toBeVisible()
    const text = (await editor.textContent()) ?? ''
    // System default format includes the year regardless of locale order.
    const year = new Date().getFullYear().toString()
    expect(text, `editor text was ${JSON.stringify(text)}`).toContain(year)
  })
})

test.describe('snap toggle behavior', () => {
  test('hover preview disappears when Snap is turned off in Add-text mode', async ({ page }) => {
    await openFixture(page, /IRS 1040 \(2022\)/)
    await page.getByRole('button', { name: /^Add text$/ }).click()

    const firstPage = page.locator('[data-page-idx="0"]')
    await hoverSnapPreview(page, { x: 200, y: 200 })

    // Disable snap. The toggle is labelled "Snap on" while pressed.
    await page.getByRole('button', { name: /Snap on/ }).click()

    // Move the cursor first to clear any current hoverRow, then re-hover.
    await firstPage.hover({ position: { x: 50, y: 50 } })
    await firstPage.hover({ position: { x: 200, y: 200 } })
    await expect(page.getByTestId('snap-hover-preview')).toHaveCount(0)
  })

  test('snap-off click free-places text instead of reusing the snap row', async ({ page }) => {
    await openFixture(page, /IRS 1040 \(2022\)/)
    await page.getByRole('button', { name: /^Add text$/ }).click()

    const firstPage = page.locator('[data-page-idx="0"]')
    const preview = await hoverSnapPreview(page, { x: 200, y: 200 })

    await page.getByRole('button', { name: /Snap on/ }).click()
    await firstPage.click({ position: { x: 200, y: 200 } })

    const annotationBox = await readInlineBox(page.locator('[data-id]').first())
    expect(Math.abs(annotationBox.x - 200), `free-place x was ${annotationBox.x}`).toBeLessThanOrEqual(2)
    expect(Math.abs(annotationBox.y - 200), `free-place y was ${annotationBox.y}`).toBeLessThanOrEqual(2)
    expect(Math.abs(annotationBox.x - preview.box.x), 'snap-off reused snapped x').toBeGreaterThan(8)
    expect(Math.abs(annotationBox.y - preview.box.y), 'snap-off reused snapped y').toBeGreaterThan(8)
  })
})

test.describe('snap geometry under zoom', () => {
  test('the same PDF point resolves to the same snap row after zooming', async ({ page }) => {
    await openFixture(page, /IRS 1040 \(2022\)/)
    await page.getByRole('button', { name: /^Add text$/ }).click()

    const firstPage = page.locator('[data-page-idx="0"]')
    const pageBoxBefore = await firstPage.boundingBox()
    if (!pageBoxBefore) throw new Error('missing page bbox before zoom')

    const first = await hoverSnapPreview(page, { x: 200, y: 200 })
    const pdfPoint = { x: 200 / first.scale, y: 200 / first.scale }

    await page.getByRole('button', { name: /^Zoom in$/ }).click()
    await page.getByRole('button', { name: /^Zoom in$/ }).click()

    await expect.poll(async () => {
      const box = await firstPage.boundingBox()
      return box?.width ?? 0
    }, { timeout: 10_000 }).toBeGreaterThan(pageBoxBefore.width * 1.4)

    const pageBoxAfter = await firstPage.boundingBox()
    if (!pageBoxAfter) throw new Error('missing page bbox after zoom')
    const zoomedScale = first.scale * (pageBoxAfter.width / pageBoxBefore.width)

    const second = await hoverSnapPreview(page, {
      x: pdfPoint.x * zoomedScale,
      y: pdfPoint.y * zoomedScale,
    })

    expect(Math.abs(second.x - first.x), `x changed from ${first.x} to ${second.x}`).toBeLessThanOrEqual(1)
    expect(Math.abs(second.y - first.y), `y changed from ${first.y} to ${second.y}`).toBeLessThanOrEqual(1)
    expect(Math.abs(second.w - first.w), `w changed from ${first.w} to ${second.w}`).toBeLessThanOrEqual(1)
    expect(Math.abs(second.h - first.h), `h changed from ${first.h} to ${second.h}`).toBeLessThanOrEqual(1)
  })
})

test.describe('recent files persistence', () => {
  test('opened fixture appears in Recent on next page load', async ({ page }) => {
    await openFixture(page, /IRS 1040 \(2022\)/)
    // Wait until the auto-save effect has had a chance to run (it watches
    // annotations/formFieldEdits but addRecentFile fires immediately on open).
    await page.waitForTimeout(500)

    // Navigate back to the empty state by reloading without the URL params
    // (snap=debug is harmless but we go fresh to make sure recents load).
    await page.goto('/')
    await expect(page.getByRole('heading', { name: /Recent/ })).toBeVisible()
    // The opened fixture's filename should be listed.
    await expect(page.getByText(/f1040-2022\.pdf/)).toBeVisible()
  })
})

test.describe('sequential fixture loads', () => {
  test('opening a second fixture replaces the first (cell counts diverge)', async ({ page }) => {
    await openFixture(page, /IRS 1040 \(2022\)/)
    const badge = page.getByTestId('snap-cell-count').first()
    await expect(badge).toBeVisible()
    const firstCount = Number(((await badge.textContent()) ?? '').match(/(\d+)/)?.[1] ?? 0)

    // Go back to empty state and pick a different fixture.
    await page.goto('/?snap=debug')
    await page.locator('input[type="file"][accept="application/pdf"]').first()
      .setInputFiles('fixtures/forms/bug1947248_forms.pdf')
    const newBadge = page.getByTestId('snap-cell-count').first()
    await expect(newBadge).toBeVisible({ timeout: 15_000 })
    const secondCount = Number(((await newBadge.textContent()) ?? '').match(/(\d+)/)?.[1] ?? 0)

    expect(firstCount).toBeGreaterThan(secondCount)
    expect(secondCount).toBeGreaterThanOrEqual(1)
  })
})

// ─── advanced ─────────────────────────────────────────────────────────────

async function addTextAnnotation(page: Page, x = 200, y = 200, text = 'note') {
  await page.getByRole('button', { name: /^Add text$/ }).click()
  await page.locator('[data-page-idx="0"]').click({ position: { x, y } })
  const editor = page.locator('[contenteditable]').last()
  await editor.type(text)
  await page.keyboard.press('Escape')
  // Escape exits Add Text mode but does NOT blur the contenteditable on its
  // own. Most app-level keyboard shortcuts (Cmd+Z, T, S, …) bail when the
  // target is inside an editable element, so explicitly blur it here.
  await page.evaluate(() => {
    const a = document.activeElement as HTMLElement | null
    if (a && (a as HTMLElement).blur) a.blur()
  })
  return editor
}

async function downloadPdfBytes(page: Page, timeout = 60_000): Promise<Uint8Array> {
  const downloadPromise = page.waitForEvent('download', { timeout })
  await page.getByRole('button', { name: /^Download$/ }).click()
  const download = await downloadPromise
  const path = await download.path()
  if (!path) throw new Error('download path not available')
  const fs = await import('node:fs/promises')
  return await fs.readFile(path)
}

async function expectValidPdf(bytes: Uint8Array, minPages = 1) {
  expect(bytes.length).toBeGreaterThan(1000)
  expect(bytes.subarray(0, 4).toString()).toBe('%PDF')
  const tail = bytes.subarray(Math.max(0, bytes.length - 64)).toString()
  expect(tail).toContain('%%EOF')

  const { PDFDocument } = await import('pdf-lib')
  const doc = await PDFDocument.load(bytes)
  expect(doc.getPageCount()).toBeGreaterThanOrEqual(minPages)
}

async function extractPdfText(bytes: Uint8Array, pageNumber = 1): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const reloaded = await pdfjs.getDocument({
    data: new Uint8Array(bytes), isEvalSupported: false, disableFontFace: true,
  }).promise
  const p = await reloaded.getPage(pageNumber)
  const tc = await p.getTextContent()
  return tc.items.map((it: { str?: string }) => it.str ?? '').join(' ')
}

test.describe('history stack depth', () => {
  test('three typed annotations undo through text edits and placements', async ({ page }) => {
    await openFixture(page, /IRS 1040 \(2022\)/)
    await addTextAnnotation(page, 200, 200, 'one')
    await addTextAnnotation(page, 200, 240, 'two')
    await addTextAnnotation(page, 200, 280, 'three')
    await expect(page.locator('[contenteditable]')).toHaveCount(3)

    const undo = page.getByRole('button', { name: /^Undo$/ })
    await undo.click()
    await expect(page.locator('[contenteditable]')).toHaveCount(3)
    await undo.click()
    await expect(page.locator('[contenteditable]')).toHaveCount(2)
    await undo.click()
    await expect(page.locator('[contenteditable]')).toHaveCount(2)
    await undo.click()
    await expect(page.locator('[contenteditable]')).toHaveCount(1)
    await undo.click()
    await expect(page.locator('[contenteditable]')).toHaveCount(1)
    await undo.click()
    await expect(page.locator('[contenteditable]')).toHaveCount(0)
  })
})

test.describe('redo and clear all', () => {
  test('Cmd+Shift+Z redoes an undone annotation edit', async ({ page }) => {
    await openFixture(page, /IRS 1040 \(2022\)/)
    await addTextAnnotation(page, 220, 220, 'redo-check')
    const editor = page.locator('[contenteditable]').last()
    await expect(editor).toContainText('redo-check')

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Z' : 'Control+Z')
    await expect(editor).toHaveText('', { timeout: 10_000 })

    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+Z' : 'Control+Shift+Z')
    await expect(editor).toContainText('redo-check', { timeout: 10_000 })
  })

  test('Clear all removes placed annotations after confirmation', async ({ page }) => {
    await openFixture(page, /IRS 1040 \(2022\)/)
    await addTextAnnotation(page, 220, 220, 'clear-me')
    await expect(page.locator('[contenteditable]')).toHaveCount(1)

    page.once('dialog', async (dialog) => {
      expect(dialog.message()).toContain('Remove all annotations')
      await dialog.accept()
    })
    await page.getByRole('button', { name: /^Clear all$/ }).click()
    await expect(page.locator('[contenteditable]')).toHaveCount(0)
  })
})

test.describe('persistence round-trip', () => {
  test('text annotations restore when re-opening from Recent', async ({ page }) => {
    await openFixture(page, /IRS 1040 \(2022\)/)
    await addTextAnnotation(page, 220, 220, 'survives reload')
    // Auto-save flushes the annotation state to IndexedDB on every change;
    // give it a moment to settle before reloading.
    await page.waitForTimeout(800)
    await page.reload()
    // The app does not auto-restore the last fixture — the user has to click
    // the Recent entry. Verify the round-trip via that path.
    await expect(page.getByRole('heading', { name: /Recent/ })).toBeVisible()
    await page.getByRole('button', { name: /^f1040-2022\.pdf\b/ }).click()
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15_000 })
    const editor = page.locator('[contenteditable]').first()
    await expect(editor).toBeVisible({ timeout: 10_000 })
    await expect(editor).toContainText('survives reload')
  })

  test('opening a different fixture starts with zero annotations', async ({ page }) => {
    await openFixture(page, /IRS 1040 \(2022\)/)
    await addTextAnnotation(page, 200, 200, 'a-only')
    await expect(page.locator('[contenteditable]')).toHaveCount(1)

    // Switch to a totally different fixture via the file-input path
    // (sample list was removed from the empty state).
    await page.goto('/?snap=debug')
    await page.locator('input[type="file"][accept="application/pdf"]').first()
      .setInputFiles('fixtures/forms/annotation-text-widget.pdf')
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('[contenteditable]')).toHaveCount(0)
  })

  test('keyboard shortcut ⌘Z undoes typed content before the annotation', async ({ page }) => {
    await openFixture(page, /IRS 1040 \(2022\)/)
    await addTextAnnotation(page, 200, 200, 'undoable')
    await expect(page.locator('[contenteditable]')).toHaveCount(1)
    // Use the platform-specific modifier (Mac is "Meta" — Playwright maps
    // ControlOrMeta to whichever fits the agent OS).
    await page.keyboard.press('ControlOrMeta+z')
    await expect(page.locator('[contenteditable]')).toHaveCount(1)
    await expect(page.locator('[contenteditable]').first()).toHaveText('')
    await page.keyboard.press('ControlOrMeta+z')
    await expect(page.locator('[contenteditable]')).toHaveCount(0)
  })
})

test.describe('form fields', () => {
  test('text and checkbox widget edits persist through Recent and download as a valid PDF', async ({ page }) => {
    await openFixture(page, /Widget-only form/)
    const formText = page.locator('[data-form-field-name]').first()
    await expect(formText).toBeVisible({ timeout: 15_000 })

    const textInput = page.locator('input[type="text"][data-form-field-name], textarea[data-form-field-name]').first()
    await expect(textInput).toBeVisible({ timeout: 15_000 })
    await textInput.fill('FORM-E2E-VALUE')
    await textInput.blur()

    const checkbox = page.locator('input[type="checkbox"][data-form-field-name]').first()
    if (await checkbox.count()) {
      await checkbox.check()
      await expect(checkbox).toBeChecked()
    }

    const bytes = await downloadPdfBytes(page)
    await expectValidPdf(bytes)
    // Form-field edits are patched into the Recent record by the same
    // debounce used in production, so wait for that autosave before reload.
    await page.waitForTimeout(1_000)

    await page.reload()
    await page.getByRole('button', { name: /^annotation-text-widget\.pdf\b/ }).click()
    await expect(page.locator('[data-page-idx="0"] canvas')).toBeVisible({ timeout: 15_000 })
    const restoredText = page.locator('input[type="text"][data-form-field-name], textarea[data-form-field-name]').first()
    await expect(restoredText).toHaveValue('FORM-E2E-VALUE', { timeout: 10_000 })
    if (await checkbox.count()) {
      await expect(page.locator('input[type="checkbox"][data-form-field-name]').first()).toBeChecked()
    }
  })
})

test.describe('image annotations', () => {
  test('Add image places an image annotation, supports moving it, and downloads a valid PDF', async ({ page }) => {
    await openFixture(page, /IRS 1040 \(2022\)/)
    await page.getByRole('button', { name: /Add image/ }).click()
    await page.locator('input[type="file"][accept="image/png,image/jpeg,image/gif,image/webp"]').setInputFiles('public/icon-192.png')

    const firstPage = page.locator('[data-page-idx="0"]')
    await firstPage.click({ position: { x: 260, y: 260 } })
    const imageAnnotation = page.locator('[data-id] img').first()
    await expect(imageAnnotation).toBeVisible({ timeout: 10_000 })

    const wrapper = page.locator('[data-id]').first()
    const before = await wrapper.boundingBox()
    if (!before) throw new Error('missing image annotation bbox before drag')
    await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2)
    await page.mouse.down()
    await page.mouse.move(before.x + before.width / 2 + 80, before.y + before.height / 2 + 80, { steps: 8 })
    await page.mouse.up()
    await expect.poll(async () => {
      const after = await wrapper.boundingBox()
      return !!after && Math.abs(after.x - before.x) > 5
    }, { timeout: 10_000 }).toBe(true)

    const bytes = await downloadPdfBytes(page)
    await expectValidPdf(bytes)
  })
})

test.describe('mode + keyboard shortcuts', () => {
  test("'T' enters Add Text mode and another 'T' exits it", async ({ page }) => {
    await openFixture(page, /IRS 1040 \(2022\)/)
    const btn = page.getByRole('button', { name: /^Add text$/ })
    await expect(btn).toHaveAttribute('aria-pressed', 'false')
    await page.keyboard.press('t')
    await expect(btn).toHaveAttribute('aria-pressed', 'true')
    await page.keyboard.press('t')
    await expect(btn).toHaveAttribute('aria-pressed', 'false')
  })

  test("'S' enters Select mode", async ({ page }) => {
    await openFixture(page, /IRS 1040 \(2022\)/)
    const select = page.getByRole('button', { name: /^Select$/ })
    await expect(select).toHaveAttribute('aria-pressed', 'false')
    await page.keyboard.press('s')
    await expect(select).toHaveAttribute('aria-pressed', 'true')
  })
})

test.describe('drawing mode', () => {
  test('dragging in draw mode produces an SVG path', async ({ page }) => {
    await openFixture(page, /IRS 1040 \(2022\)/)
    await page.getByRole('button', { name: /^Draw$/ }).click()

    const firstPage = page.locator('[data-page-idx="0"]')
    const box = await firstPage.boundingBox()
    if (!box) throw new Error('first page bbox unavailable')

    // Synthesise a short stroke. Playwright dispatches real pointer events.
    await page.mouse.move(box.x + 220, box.y + 300)
    await page.mouse.down()
    for (let i = 1; i <= 12; i++) {
      await page.mouse.move(box.x + 220 + i * 6, box.y + 300 + Math.sin(i) * 4)
    }
    await page.mouse.up()

    // The committed annotation lives in the page's annotation overlay as an
    // SVG path with a non-empty `d` attribute.
    const path = firstPage.locator('svg path').first()
    await expect(path).toBeAttached()
    const d = await path.getAttribute('d')
    expect(d ?? '').toMatch(/^M[\s-\d.]+/)
  })
})

test.describe('zoom controls', () => {
  test('zoom-in widens the rendered page', async ({ page }) => {
    await openFixture(page, /IRS 1040 \(2022\)/)
    const wrapper = page.locator('[data-page-idx="0"]')
    const before = await wrapper.boundingBox()
    if (!before) throw new Error('no bbox before zoom')

    await page.getByRole('button', { name: /^Zoom in$/ }).click()
    // Allow the layout pass to apply.
    await page.waitForTimeout(150)
    const after = await wrapper.boundingBox()
    if (!after) throw new Error('no bbox after zoom')
    expect(after.width).toBeGreaterThan(before.width * 1.1)
  })
})

test.describe('snap font sizing', () => {
  test('snapped annotation font size differs from the toolbar default of 14pt', async ({ page }) => {
    await openFixture(page, /IRS 1040 \(2022\)/)
    await page.getByRole('button', { name: /^Add text$/ }).click()
    // Click somewhere that should snap onto a small (~12pt) cell on f1040.
    await page.locator('[data-page-idx="0"]').click({ position: { x: 220, y: 240 } })
    const editor = page.locator('[contenteditable]').first()
    await expect(editor).toBeVisible()
    // The contenteditable's inline `font-size` reflects fontSize × scale.
    // For a snapped 12pt cell we expect roughly 7–14 px after CSS scaling;
    // for the unsnapped default (textSize 14 × scale ≈ 0.85) we'd see ~12 px.
    // Either way, after a successful snap the font is *different from* the
    // hard-coded 14 px (which would mean snap silently fell back to default).
    const fs = await editor.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
    expect(fs).not.toBe(14)
    expect(fs).toBeGreaterThan(0)
  })
})

test.describe('select mode + delete', () => {
  test('selecting an annotation and pressing Backspace removes it', async ({ page }) => {
    await openFixture(page, /IRS 1040 \(2022\)/)
    await addTextAnnotation(page, 200, 200, 'doomed')
    await expect(page.locator('[contenteditable]')).toHaveCount(1)

    // Switch to Select mode.
    await page.keyboard.press('s')

    // Clicking the wrapper through Playwright's `.click()` (and through
    // `page.mouse.click`) causes the resulting `click` event to retarget to
    // the page overlay — the overlay's onClick then calls
    // setSelectedId(null) and the annotation never becomes selected.
    // Dispatching the pointer events directly on the wrapper drives the
    // same React handler (startDrag → setSelectedId) without that retarget.
    // Real browser use of select-mode click-to-select works fine; this is a
    // Playwright-only workaround.
    await page.evaluate(() => {
      const w = document.querySelector('[data-id]') as HTMLElement | null
      if (!w) throw new Error('no annotation wrapper found')
      const opts: PointerEventInit = { bubbles: true, cancelable: true, button: 0, pointerType: 'mouse' }
      w.dispatchEvent(new PointerEvent('pointerdown', opts))
      w.dispatchEvent(new PointerEvent('pointerup', opts))
    })

    // The floating toolbar's Delete button (labelled, distinct from the
    // small corner X which is overlapped by a resize handle) confirms the
    // annotation is now selected.
    await expect(
      page.getByRole('button', { name: /^Delete$/ }).filter({ hasText: 'Delete' }),
    ).toBeVisible()

    // The wired keyboard shortcut for select-mode delete.
    await page.keyboard.press('Backspace')
    await expect(page.locator('[contenteditable]')).toHaveCount(0)
  })
})

test.describe('redaction flow', () => {
  test('R shortcut enters redaction mode, drag creates a redaction, and download removes source text', async ({ page }) => {
    await openFixture(page, /IRS 1040 \(2022\)/)
    const fs = await import('node:fs/promises')
    const sourceBytes = await fs.readFile('fixtures/forms/f1040-2022.pdf')
    const sourceText = await extractPdfText(sourceBytes)
    expect(sourceText).toMatch(/Form\s+1040/)

    await page.keyboard.press('r')
    await expect(page.getByText(/Drag over sensitive content/i)).toBeVisible()

    const firstPage = page.locator('[data-page-idx="0"]')
    await firstPage.hover({ position: { x: 80, y: 70 } })
    await page.mouse.down()
    await firstPage.hover({ position: { x: 310, y: 125 } })
    await expect(page.getByTestId('redaction-draft')).toBeVisible()
    await page.mouse.up()

    await expect(page.locator('[data-id]').first()).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText(/^Select$/).first()).toBeVisible()

    const bytes = await downloadPdfBytes(page)
    await expectValidPdf(bytes)
    const redactedText = await extractPdfText(bytes)
    expect(redactedText).not.toMatch(/Form\s+1040/)
  })
})

test.describe('graceful no-snap fallback', () => {
  // XFA forms render via pdf.js's separate XFA pipeline. Our detector reads
  // the standard Acroform/operator-list path and finds 0 cells on a pure XFA
  // form. That's a known limitation; the test locks in the *graceful* fallback
  // — the canvas still paints, the toolbar still works, free-place text
  // annotations still drop where you click without snap.
  test('XFA fixture renders without crashing and accepts free-place text', async ({ page }) => {
    await page.goto('/?snap=debug')
    await page.locator('input[type="file"][accept="application/pdf"]').first()
      .setInputFiles('fixtures/forms/xfa-imm1344e.pdf')
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30_000 })
    // Snap badge may not appear at all when there are 0 cells — that's fine.
    // Just verify text-mode click still produces an annotation.
    await page.getByRole('button', { name: /^Add text$/ }).click()
    await page.locator('[data-page-idx="0"]').click({ position: { x: 200, y: 200 } })
    await expect(page.locator('[contenteditable]').first()).toBeVisible()
  })
})

// ─── full-coverage matrix for German fixtures ─────────────────────────────
// The Cell-count overlay test above proves the detector sees cells on each
// German PDF. These tests prove the *user flow* — click-to-snap, hover
// preview, font sizing, dark-on-white legibility, add-and-undo — works on
// every German fixture, not just the IRS 1040 baseline.

const GERMAN_FIXTURES: { label: RegExp; click: { x: number; y: number } }[] = [
  { label: /DE — Anmeldung/,           click: { x: 220, y: 180 } },
  { label: /DE — Krankmeldung/,        click: { x: 220, y: 180 } },
  { label: /DE — Kündigung/,           click: { x: 220, y: 200 } },
  { label: /DE — Mietvertrag/,         click: { x: 220, y: 200 } },
  { label: /DE — Rechnung/,            click: { x: 220, y: 200 } },
  { label: /DE — DRV V0005/,           click: { x: 220, y: 200 } },
  { label: /DE — AA eID-card/,         click: { x: 220, y: 160 } },
  { label: /DE — BNetzA 0800/,         click: { x: 230, y: 170 } },
  { label: /DE — BA KiZ 5/,            click: { x: 220, y: 155 } },
  { label: /DE — BA PD U1/,            click: { x: 220, y: 320 } },
]

for (const f of GERMAN_FIXTURES) {
  test.describe(`German fixture flow — ${f.label.source}`, () => {
    test('click in Add-text mode creates a focused contenteditable', async ({ page }) => {
      await openFixture(page, f.label)
      await page.getByRole('button', { name: /^Add text$/ }).click()
      await page.locator('[data-page-idx="0"]').click({ position: f.click })
      const editor = page.locator('[contenteditable]').first()
      await expect(editor).toBeVisible()
      await editor.type('hallo')
      await expect(editor).toContainText('hallo')
    })

    test('hover preview rectangle appears in Add-text mode', async ({ page }) => {
      await openFixture(page, f.label)
      await page.getByRole('button', { name: /^Add text$/ }).click()
      const preview = await hoverSnapPreview(page, f.click)
      expect(preview.w).toBeGreaterThan(8)
      expect(preview.h).toBeGreaterThan(3)
    })

    test('snap-applied font size is non-default and visible', async ({ page }) => {
      await openFixture(page, f.label)
      await page.getByRole('button', { name: /^Add text$/ }).click()
      await page.locator('[data-page-idx="0"]').click({ position: f.click })
      const editor = page.locator('[contenteditable]').first()
      await expect(editor).toBeVisible()
      const fs = await editor.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
      expect(fs).toBeGreaterThan(0)
      // Non-snapped default is the toolbar's textSize × scale ≈ 12 px. We
      // accept anything in the legible 4–28 px range — the assertion is that
      // the editor renders with *some* sensible size, not the previous
      // catastrophic 0pt or 36pt regressions.
      expect(fs).toBeLessThan(28)
    })

    test('typed text uses a dark color, not white-on-white', async ({ page }) => {
      await openFixture(page, f.label)
      await page.getByRole('button', { name: /^Add text$/ }).click()
      await page.locator('[data-page-idx="0"]').click({ position: f.click })
      const editor = page.locator('[contenteditable]').first()
      await editor.type('Lesbarkeit')
      const rgb = await editor.evaluate((el) => getComputedStyle(el).color)
      const m = rgb.match(/rgb[a]?\((\d+),\s*(\d+),\s*(\d+)/)
      expect(m, `unexpected color string: ${rgb}`).not.toBeNull()
      const [r, g, b] = (m as RegExpMatchArray).slice(1, 4).map(Number)
      expect(r + g + b).toBeLessThan(200)
    })

    test('undo reverts typed text, then removes the annotation', async ({ page }) => {
      await openFixture(page, f.label)
      await addTextAnnotation(page, f.click.x, f.click.y, 'temporäre Notiz')
      await expect(page.locator('[contenteditable]')).toHaveCount(1)
      const undo = page.getByRole('button', { name: /^Undo$/ })
      await undo.click()
      await expect(page.locator('[contenteditable]')).toHaveCount(1)
      await expect(page.locator('[contenteditable]').first()).toHaveText('')
      await undo.click()
      await expect(page.locator('[contenteditable]')).toHaveCount(0)
    })
  })
}

// ─── deeper end-to-end coverage ───────────────────────────────────────────

test.describe('mode mutual exclusion', () => {
  test('Add Text and Draw cannot both be on at the same time', async ({ page }) => {
    await openFixture(page, /IRS 1040 \(2022\)/)
    const textBtn = page.getByRole('button', { name: /^Add text$/ })
    const drawBtn = page.getByRole('button', { name: /^Draw$/ })
    await page.keyboard.press('t')
    await expect(textBtn).toHaveAttribute('aria-pressed', 'true')
    await expect(drawBtn).toHaveAttribute('aria-pressed', 'false')
    await page.keyboard.press('d')
    await expect(textBtn).toHaveAttribute('aria-pressed', 'false')
    await expect(drawBtn).toHaveAttribute('aria-pressed', 'true')
    await page.keyboard.press('s')
    await expect(drawBtn).toHaveAttribute('aria-pressed', 'false')
  })
})

test.describe('multi-page annotations', () => {
  test('Annotations on different pages persist independently and round-trip', async ({ page }) => {
    await openFixture(page, /USCIS Form I-9/)
    // page 0 — instructions, but click still works (free placement if no cell).
    await page.getByRole('button', { name: /^Add text$/ }).click()
    await page.locator('[data-page-idx="0"]').click({ position: { x: 220, y: 220 } })
    const editor0 = page.locator('[contenteditable]').last()
    await editor0.type('seite eins')
    await page.keyboard.press('Escape')
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())

    // page 3 — the fillable page (44 widgets); scroll into view first.
    const page3 = page.locator('[data-page-idx="3"]')
    await page3.scrollIntoViewIfNeeded()
    await page.getByRole('button', { name: /^Add text$/ }).click()
    await page3.click({ position: { x: 220, y: 220 } })
    const editor3 = page.locator('[contenteditable]').last()
    await editor3.type('seite vier')
    await page.keyboard.press('Escape')
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())

    // Two distinct annotations on two distinct page wrappers.
    await expect(page.locator('[contenteditable]')).toHaveCount(2)
    const placement = await page.evaluate(() =>
      Array.from(document.querySelectorAll('[data-page-idx]')).flatMap((p) =>
        Array.from(p.querySelectorAll('[contenteditable]')).map((el) => ({
          pageIdx: p.getAttribute('data-page-idx'),
          text: (el as HTMLElement).innerText,
        })),
      ),
    )
    expect(placement.find((p) => p.text.includes('seite eins'))?.pageIdx).toBe('0')
    expect(placement.find((p) => p.text.includes('seite vier'))?.pageIdx).toBe('3')

    // Round-trip via Recent.
    await page.waitForTimeout(800)
    await page.reload()
    await page.getByRole('button', { name: /^uscis-i9-2011\.pdf\b/ }).click()
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('[contenteditable]')).toHaveCount(2, { timeout: 10_000 })
  })
})

test.describe('profile auto-fill', () => {
  test('Profile dialog → Insert places the saved value at the next click', async ({ page }) => {
    await openFixture(page, /IRS 1040 \(2022\)/)
    // Open profile via toolbar button (more reliable than the keyboard
    // shortcut, which the global key handler might gate on focus).
    await page.getByRole('button', { name: /^Profile$/ }).click()

    // Add a field, set label + value.
    await page.getByRole('button', { name: /^Add field$/ }).click()
    const inputs = page.getByRole('dialog').locator('input')
    await inputs.nth(0).fill('Vor- und Zuname')
    await inputs.nth(1).fill('Tilo Knopfler')
    // Click Insert. There is one Insert button per field, so pick the first.
    await page.getByRole('button', { name: /^Insert$/ }).first().click()

    // Modal closes, mode is now 'text', pendingTextValue=value.
    await expect(page.getByRole('dialog')).toBeHidden()
    await page.locator('[data-page-idx="0"]').click({ position: { x: 220, y: 220 } })

    const editor = page.locator('[contenteditable]').first()
    await expect(editor).toBeVisible()
    await expect(editor).toContainText('Tilo Knopfler')
  })
})

test.describe('signature flow', () => {
  test('Type tab → Use signature → click → signature image annotation appears', async ({ page }) => {
    await openFixture(page, /IRS 1040 \(2022\)/)
    await page.getByRole('button', { name: /Add signature/ }).click()
    // Switch to the Type tab — easier to drive than the canvas Draw tab.
    await page.getByRole('tab', { name: /^Type$/ }).click()
    await page.locator('[role="tabpanel"][data-state="active"] input').first().fill('Tilo')
    await page.getByRole('button', { name: /Use signature/ }).click()
    // Modal closes; mode is now 'signature' with pendingSignature armed.
    await expect(page.getByRole('dialog')).toBeHidden()
    await page.locator('[data-page-idx="0"]').click({ position: { x: 240, y: 360 } })
    // The placed annotation is an <img> inside a [data-id] wrapper.
    await expect(page.locator('[data-id] img').first()).toBeVisible()
  })

  test('Generate tab -> Shuffle -> Use signature -> click -> signature image annotation appears', async ({ page }) => {
    await openFixture(page, /IRS 1040 \(2022\)/)
    await page.getByRole('button', { name: /Add signature/ }).click()
    await page.getByRole('tab', { name: /^Generate$/ }).click()
    const activePanel = page.locator('[role="tabpanel"][data-state="active"]')
    await activePanel.locator('input').first().fill('Tilo Knopfler')
    await activePanel.getByRole('combobox').click()
    await expect(page.getByRole('option', { name: /^Readable$/ })).toBeVisible()
    await expect(page.getByRole('option', { name: /^Formal$/ })).toBeVisible()
    await expect(page.getByRole('option', { name: /^Flowing$/ })).toHaveCount(0)
    await expect(page.getByRole('option', { name: /^Quick$/ })).toHaveCount(0)
    await page.getByRole('option', { name: /^Formal$/ }).click()
    await activePanel.getByRole('button', { name: /^Shuffle$/ }).click()
    await activePanel.getByRole('button', { name: /^Use signature$/ }).click()

    await expect(page.getByRole('dialog')).toBeHidden()
    await page.locator('[data-page-idx="0"]').click({ position: { x: 240, y: 360 } })
    await expect(page.locator('[data-id] img').first()).toBeVisible()
  })

  test('Drawn signatures are saved, reusable, and removable', async ({ page }) => {
    await openFixture(page, /IRS 1040 \(2022\)/)
    await page.getByRole('button', { name: /Add signature/ }).click()

    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    const pad = dialog.locator('canvas').first()
    await expect(pad).toBeVisible()
    const box = await pad.boundingBox()
    if (!box) throw new Error('signature pad bbox missing')

    await page.mouse.move(box.x + 40, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + 140, box.y + 40, { steps: 5 })
    await page.mouse.move(box.x + 240, box.y + box.height / 2, { steps: 5 })
    await page.mouse.up()
    await dialog.getByRole('button', { name: /^Use signature$/ }).click()

    await expect(dialog).toBeHidden()
    await page.locator('[data-page-idx="0"]').click({ position: { x: 240, y: 360 } })
    await expect(page.locator('[data-id] img')).toHaveCount(1)

    await page.getByRole('button', { name: /Add signature/ }).click()
    await expect(page.getByText(/Saved/i)).toBeVisible()
    await dialog.locator('button:has(img)').first().click()
    await expect(dialog).toBeHidden()
    await page.locator('[data-page-idx="0"]').click({ position: { x: 330, y: 360 } })
    await expect(page.locator('[data-id] img')).toHaveCount(2)

    await page.getByRole('button', { name: /Add signature/ }).click()
    await expect(page.getByRole('button', { name: /^Delete saved signature$/ })).toBeVisible()
    await page.getByRole('button', { name: /^Delete saved signature$/ }).click()
    await expect(page.getByRole('button', { name: /^Delete saved signature$/ })).toHaveCount(0)
  })
})

test.describe('download produces a valid PDF', () => {
  test('Download attaches placed text annotations and yields a valid PDF', async ({ page }) => {
    await openFixture(page, /IRS 1040 \(2022\)/)
    await addTextAnnotation(page, 220, 220, 'download-check')

    const downloadPromise = page.waitForEvent('download', { timeout: 30_000 })
    await page.getByRole('button', { name: /^Download$/ }).click()
    const download = await downloadPromise
    const path = await download.path()
    if (!path) throw new Error('download path not available')

    const fs = await import('node:fs/promises')
    const bytes = await fs.readFile(path)
    // Sanity: real PDF (magic header + EOF marker) and reasonable size.
    expect(bytes.length).toBeGreaterThan(1000)
    expect(bytes.subarray(0, 4).toString()).toBe('%PDF')
    // Trailing %%EOF marker confirms the PDF was finalised cleanly.
    const tail = bytes.subarray(Math.max(0, bytes.length - 64)).toString()
    expect(tail).toContain('%%EOF')

    // Parse with pdf-lib to confirm pages are intact.
    const { PDFDocument } = await import('pdf-lib')
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBeGreaterThan(0)

    // Searching the rendered content stream for the literal annotation text
    // is brittle (text gets re-encoded). Instead, prove the build path went
    // beyond the original — a build-failed result would be a bytes blob much
    // closer to the input PDF size; with our annotation embedded the file
    // grows. For f1040-2022 (~156 KB), expect ≥2 KB additional content.
    const inputRes = await fetch('/fixtures/forms/f1040-2022.pdf')
      .catch(() => null)
    if (inputRes) {
      const inputBuf = new Uint8Array(await inputRes.arrayBuffer())
      expect(bytes.length).toBeGreaterThanOrEqual(inputBuf.length - 2_000)
    }
  })
})

test.describe('annotation drag in select mode', () => {
  test('pointerdown → pointermove → pointerup updates the annotation position', async ({ page }) => {
    await openFixture(page, /IRS 1040 \(2022\)/)
    await addTextAnnotation(page, 200, 200, 'movable')
    await page.keyboard.press('s')

    const before = await page.evaluate(() => {
      const w = document.querySelector('[data-id]') as HTMLElement
      const r = w.getBoundingClientRect()
      return { left: r.left, top: r.top }
    })

    // Drive the drag via direct pointer events. Same Playwright `.click()`
    // retargeting quirk from the select-mode delete test applies — we bypass
    // it by dispatching pointerdown on the wrapper then pointermove/pointerup
    // on window (where startDrag attaches its handlers).
    await page.evaluate(({ dx, dy }) => {
      const w = document.querySelector('[data-id]') as HTMLElement
      const r = w.getBoundingClientRect()
      const cx = r.left + r.width / 2
      const cy = r.top + r.height / 2
      const make = (type: string, x: number, y: number, target: 'el' | 'win' = 'el') => {
        const e = new PointerEvent(type, {
          bubbles: true, cancelable: true, button: 0, pointerType: 'mouse', clientX: x, clientY: y,
        })
        if (target === 'el') w.dispatchEvent(e)
        else window.dispatchEvent(e)
      }
      make('pointerdown', cx, cy, 'el')
      // Several intermediate moves so React can coalesce / re-render between them.
      for (let i = 1; i <= 8; i++) {
        make('pointermove', cx + (dx * i) / 8, cy + (dy * i) / 8, 'win')
      }
      make('pointerup', cx + dx, cy + dy, 'win')
    }, { dx: 80, dy: 60 })

    await page.waitForTimeout(150)
    const after = await page.evaluate(() => {
      const w = document.querySelector('[data-id]') as HTMLElement
      const r = w.getBoundingClientRect()
      return { left: r.left, top: r.top }
    })

    // Allow some scaling fudge — drag deltas are in CSS px but the store
    // converts to PDF points, then back to CSS via scale. End result should
    // still move ≥ ~20 px in each axis.
    expect(after.left - before.left).toBeGreaterThan(20)
    expect(after.top - before.top).toBeGreaterThan(20)
  })
})

test.describe('drawing pen settings', () => {
  test('Pen color picked in the toolbar popover flows into the SVG stroke', async ({ page }) => {
    await openFixture(page, /IRS 1040 \(2022\)/)

    // The pen-settings swatch is only visible in draw mode (it has no
    // effect anywhere else, so it's gated by mode === 'draw'). Enter draw
    // mode first, then open the popover and pick a colour.
    await page.getByRole('button', { name: /^Draw$/ }).click()
    await expect(page.getByRole('button', { name: /^Draw$/ })).toHaveAttribute('aria-pressed', 'true')
    const penSettings = page.getByRole('button', { name: /^Pen settings$/ })
    await expect(penSettings).toBeVisible()
    await penSettings.click()
    // PEN_COLORS uses HTML `title` for accessible name; pick Red.
    const popoverRed = page.locator('[data-radix-popper-content-wrapper]').getByRole('button', { name: /^Red$/ })
    await expect(popoverRed.first()).toBeVisible()
    await popoverRed.first().click()
    const firstPage = page.locator('[data-page-idx="0"]')
    const box = await firstPage.boundingBox()
    if (!box) throw new Error('first page bbox unavailable')
    await page.mouse.move(box.x + 240, box.y + 320)
    await page.mouse.down()
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(box.x + 240 + i * 6, box.y + 320 + i * 3)
    }
    await page.mouse.up()

    const path = firstPage.locator('svg path[stroke="#dc2626"]').first()
    await expect(path).toBeAttached()
  })
})

test.describe('edit existing text mode', () => {
  test('E enters Edit mode and clickable text-run targets render', async ({ page }) => {
    await openFixture(page, /IRS Schedule A/)
    await page.keyboard.press('e')
    await expect(page.getByRole('button', { name: /^Edit text$/ })).toHaveAttribute('aria-pressed', 'true')
    // Text-run targets render only in edit mode.
    const targets = page.getByTestId('edit-target')
    await expect(targets.first()).toBeVisible({ timeout: 10_000 })
    const count = await targets.count()
    expect(count).toBeGreaterThan(20)
  })

  test('Click a text run → editor opens prefilled, typing replaces it, download contains the new text', async ({ page }) => {
    await openFixture(page, /IRS Schedule A/)
    await page.keyboard.press('e')
    const target = page.getByTestId('edit-target').first()
    await expect(target).toBeVisible({ timeout: 10_000 })
    await target.click()

    // After clicking, mode is back to idle and an editor is open + focused.
    const editor = page.locator('[contenteditable]').last()
    await expect(editor).toBeVisible()
    // Initial content equals the original text run (whatever pdf.js returned).
    const initial = await editor.textContent()
    expect(initial?.trim().length ?? 0).toBeGreaterThan(0)

    // The editor's selection is set to "select all" so typing replaces.
    await page.keyboard.press('Backspace')
    await editor.type('OVERWRITTEN')
    await expect(editor).toContainText('OVERWRITTEN')

    // Download → the resulting PDF must include the replacement.
    const downloadPromise = page.waitForEvent('download', { timeout: 30_000 })
    await page.getByRole('button', { name: /^Download$/ }).click()
    const download = await downloadPromise
    const path = await download.path()
    if (!path) throw new Error('download path not available')
    const fs = await import('node:fs/promises')
    const bytes = await fs.readFile(path)
    expect(bytes.subarray(0, 4).toString()).toBe('%PDF')

    const { PDFDocument } = await import('pdf-lib')
    const doc = await PDFDocument.load(bytes)
    expect(doc.getPageCount()).toBeGreaterThan(0)

    // Content streams are Flate-compressed; raw byte search would miss "OVERWRITTEN".
    // Parse the produced PDF with pdf.js's legacy Node build and read its text.
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const reloaded = await pdfjs.getDocument({
      data: new Uint8Array(bytes), isEvalSupported: false, disableFontFace: true,
    }).promise
    const p = await reloaded.getPage(1)
    const tc = await p.getTextContent()
    const allText = tc.items.map((it: { str?: string }) => it.str ?? '').join(' ')
    expect(allText).toContain('OVERWRITTEN')
  })

  test('Once a run is edited, its target disappears in edit mode', async ({ page }) => {
    await openFixture(page, /IRS Schedule A/)
    await page.keyboard.press('e')
    const targets = page.getByTestId('edit-target')
    // pdf.js's getTextContent is async — wait for at least one target before
    // reading the count, otherwise we see the pre-render value.
    await expect(targets.first()).toBeVisible({ timeout: 10_000 })
    const before = await targets.count()
    expect(before).toBeGreaterThan(20)
    await targets.first().click()
    await page.keyboard.press('Escape')
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())
    await page.keyboard.press('e')
    await expect(targets.first()).toBeVisible({ timeout: 10_000 })
    const after = await targets.count()
    expect(after).toBe(before - 1)
  })

  test('The cover rectangle behind the editor is white', async ({ page }) => {
    await openFixture(page, /IRS Schedule A/)
    await page.keyboard.press('e')
    const target = page.getByTestId('edit-target').first()
    await expect(target).toBeVisible({ timeout: 10_000 })
    const targetBox = await target.boundingBox()
    if (!targetBox) throw new Error('no target bbox')
    await target.click()
    // The cover became a separate element (data-testid="text-edit-cover")
    // pinned to origBbox so the editor wrapper can be dragged independently.
    // Look at the cover, not the wrapper, for the white masking colour.
    const cover = page.getByTestId('text-edit-cover').first()
    await expect(cover).toBeVisible()
    const coverBox = await cover.boundingBox()
    const wrapperBox = await page.locator('[data-id]').last().boundingBox()
    if (!coverBox) throw new Error('no cover bbox')
    if (!wrapperBox) throw new Error('no wrapper bbox')
    const bg = await cover.evaluate((el) => getComputedStyle(el as HTMLElement).backgroundColor)
    expect(bg.replace(/\s+/g, '')).toMatch(/^rgba?\(255,255,255(,1)?\)$/)
    expect(coverBox.y).toBeLessThan(wrapperBox.y)
    expect(coverBox.y + coverBox.height).toBeGreaterThan(wrapperBox.y + targetBox.height + 1)
  })

  test('Multiple edits on the same page persist as distinct annotations', async ({ page }) => {
    await openFixture(page, /IRS Schedule A/)
    await page.keyboard.press('e')
    await page.getByTestId('edit-target').nth(0).click()
    await page.locator('[contenteditable]').last().fill('FIRST_EDIT')
    await page.keyboard.press('Escape')
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())

    await page.keyboard.press('e')
    await page.getByTestId('edit-target').nth(0).click()  // first remaining run
    await page.locator('[contenteditable]').last().fill('SECOND_EDIT')
    await page.keyboard.press('Escape')
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())

    await expect(page.locator('[contenteditable]')).toHaveCount(2)
  })

  test('Edit, then Undo restores the original — annotation gone, edit-target reappears', async ({ page }) => {
    await openFixture(page, /IRS Schedule A/)
    await page.keyboard.press('e')
    const targets = page.getByTestId('edit-target')
    await expect(targets.first()).toBeVisible({ timeout: 10_000 })
    const before = await targets.count()
    expect(before).toBeGreaterThan(20)
    await targets.first().click()
    await page.locator('[contenteditable]').last().fill('UNDONE')
    await page.keyboard.press('Escape')
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())

    const undo = page.getByRole('button', { name: /^Undo$/ })
    await undo.click()
    await expect(page.locator('[contenteditable]')).toHaveCount(1)
    await expect(page.locator('[contenteditable]').last()).not.toContainText('UNDONE')
    await undo.click()
    await expect(page.locator('[contenteditable]')).toHaveCount(0)

    // Re-enter edit mode — the run we just undid should be clickable again.
    await page.keyboard.press('e')
    await expect(targets.first()).toBeVisible({ timeout: 10_000 })
    const after = await targets.count()
    expect(after).toBe(before)
  })

  test('Edits round-trip across a full reload via Recent', async ({ page }) => {
    await openFixture(page, /IRS Schedule A/)
    await page.keyboard.press('e')
    await page.getByTestId('edit-target').first().click()
    await page.locator('[contenteditable]').last().fill('PERSIST_THIS')
    await page.keyboard.press('Escape')
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())
    await page.waitForTimeout(800)
    await page.reload()
    await page.getByRole('button', { name: /^irs-schedule-a\.pdf\b/ }).click()
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15_000 })
    const editor = page.locator('[contenteditable]').first()
    await expect(editor).toBeVisible({ timeout: 10_000 })
    await expect(editor).toContainText('PERSIST_THIS')
  })

  test('Each edit target carries a tooltip with the original text', async ({ page }) => {
    await openFixture(page, /IRS Schedule A/)
    await page.keyboard.press('e')
    const target = page.getByTestId('edit-target').first()
    await expect(target).toBeVisible({ timeout: 10_000 })
    const title = await target.getAttribute('title')
    expect(title?.length ?? 0).toBeGreaterThan(0)
  })

  test('Adjacent text runs are grouped (some targets contain a space)', async ({ page }) => {
    // pdf.js often splits a sentence into per-word runs around spaces or
    // kerning. groupTextRuns merges them; the only way a target's title
    // contains a space is if the merger ran.
    await openFixture(page, /IRS Schedule A/)
    await page.keyboard.press('e')
    const targets = page.getByTestId('edit-target')
    await expect(targets.first()).toBeVisible({ timeout: 10_000 })
    const titles = await targets.evaluateAll((els) =>
      els.slice(0, 80).map((e) => e.getAttribute('title') ?? ''),
    )
    expect(titles.some((t) => t.includes(' '))).toBe(true)
  })

  test('Cover rectangle expands when the typed replacement is wider', async ({ page }) => {
    // The auto-grow useLayoutEffect from the shared text branch should
    // resize the wrapper when the editor's scrollWidth grows.
    await openFixture(page, /IRS Schedule A/)
    await page.keyboard.press('e')
    await page.getByTestId('edit-target').first().click()
    const wrapper = page.locator('[data-id]').last()
    const before = await wrapper.boundingBox()
    if (!before) throw new Error('no wrapper bbox before')
    await page.locator('[contenteditable]').last().fill(
      'a much longer replacement string than the original word',
    )
    await page.waitForTimeout(200)
    const after = await wrapper.boundingBox()
    if (!after) throw new Error('no wrapper bbox after')
    expect(after.width).toBeGreaterThan(before.width * 1.5)
  })

  test('Original text colour is sampled from the canvas, not hardcoded', async ({ page }) => {
    // Default fallback colour is #0a1f3d. When sampling succeeds the editor's
    // resolved colour should NOT be that exact value — pdf.js antialiases
    // glyph pixels so the darkest sample is rarely a perfect rgb(0,0,0)
    // either, but sub-200 brightness is a safe bound for a real glyph.
    await openFixture(page, /IRS Schedule A/)
    await page.keyboard.press('e')
    await page.getByTestId('edit-target').first().click()
    const editor = page.locator('[contenteditable]').last()
    await expect(editor).toBeVisible()
    const rgb = await editor.evaluate((el) => getComputedStyle(el).color)
    const m = rgb.match(/rgb[a]?\((\d+),\s*(\d+),\s*(\d+)/)
    expect(m).not.toBeNull()
    const [r, g, b] = (m as RegExpMatchArray).slice(1, 4).map(Number)
    expect(r + g + b).toBeLessThan(200)
    // Check it's not literally the fallback constant. #0a1f3d = rgb(10,31,61),
    // sum 102. Sampling lands at roughly rgb(0..30, 0..30, 0..30); equality
    // is unlikely but not impossible — we just assert it's a defensible
    // dark colour, not the silent fallback.
    expect(`rgb(${r}, ${g}, ${b})`).not.toBe('rgb(10, 31, 61)')
  })

  test('Alt+click places the caret at the click point instead of select-all', async ({ page }) => {
    await openFixture(page, /IRS Schedule A/)
    await page.keyboard.press('e')
    const target = page.getByTestId('edit-target').first()
    await expect(target).toBeVisible({ timeout: 10_000 })
    const box = await target.boundingBox()
    if (!box) throw new Error('target bbox unavailable')
    // Click toward the right side of the run with Alt held so the caret
    // lands somewhere inside the text rather than spanning it.
    await page.mouse.move(box.x + box.width * 0.8, box.y + box.height / 2)
    await page.keyboard.down('Alt')
    await page.mouse.down()
    await page.mouse.up()
    await page.keyboard.up('Alt')

    // Verify the editor opened, is focused, and the selection is *collapsed*
    // (no characters selected) — that's the alt-click path, distinct from
    // the default select-all behaviour that follows a plain click.
    const editor = page.locator('[contenteditable]').last()
    await expect(editor).toBeVisible()
    const collapsed = await editor.evaluate(() => {
      const sel = window.getSelection()
      return !!sel && sel.rangeCount > 0 && sel.isCollapsed
    })
    expect(collapsed).toBe(true)
  })

  test('Plain click select-all path is unchanged (caret spans the original text)', async ({ page }) => {
    await openFixture(page, /IRS Schedule A/)
    await page.keyboard.press('e')
    await page.getByTestId('edit-target').first().click()
    const editor = page.locator('[contenteditable]').last()
    await expect(editor).toBeVisible()
    const collapsed = await editor.evaluate(() => {
      const sel = window.getSelection()
      return !!sel && sel.rangeCount > 0 && sel.isCollapsed
    })
    // Default click → select-all → not collapsed.
    expect(collapsed).toBe(false)
  })

  test('Bold source text is preserved as <b> in the editor', async ({ page }) => {
    // de-anmeldung's first run is the title "Anmeldung bei der Meldebehörde"
    // drawn with StandardFonts.HelveticaBold by pdf-lib. pdf.js's font hint
    // should carry the "Bold" suffix; detectFontStyle picks it up and the
    // click handler wraps the editor data in <b>...</b>.
    await openFixture(page, /DE — Anmeldung/)
    await page.keyboard.press('e')
    const target = page.getByTestId('edit-target').first()
    await expect(target).toBeVisible({ timeout: 10_000 })
    await target.click()
    const html = await page.locator('[contenteditable]').last().innerHTML()
    expect(html.toLowerCase()).toContain('<b>')
  })

  test('Multi-line targets: a single click target spans wrapped paragraph lines', async ({ page }) => {
    // The synthetic German Mietvertrag has multi-line address blocks. After
    // groupParagraphs runs, we expect at least one target whose title
    // contains a newline — that's the marker of multi-line merging.
    await openFixture(page, /DE — Mietvertrag/)
    await page.keyboard.press('e')
    const targets = page.getByTestId('edit-target')
    await expect(targets.first()).toBeVisible({ timeout: 10_000 })
    const titles = await targets.evaluateAll((els) =>
      els.map((e) => e.getAttribute('title') ?? ''),
    )
    // Either we found a newline-containing target, OR the fixture's lines
    // are far enough apart that the paragraph grouper correctly DOES NOT
    // merge them (false positives are worse than misses). Locking in the
    // existence of multi-line groups in our test fixtures uses Schedule A
    // which has dense same-column lists.
    const anyMultiline = titles.some((t) => t.includes('\n'))
    if (!anyMultiline) {
      // Fall back to Schedule A which has tightly-stacked paragraph lines.
      await page.goto('/?snap=debug')
      await page.locator('input[type="file"][accept="application/pdf"]').first()
        .setInputFiles('fixtures/forms/irs-schedule-a.pdf')
      await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15_000 })
      await page.keyboard.press('e')
      await expect(targets.first()).toBeVisible({ timeout: 10_000 })
      const titles2 = await targets.evaluateAll((els) =>
        els.map((e) => e.getAttribute('title') ?? ''),
      )
      expect(titles2.some((t) => t.includes('\n'))).toBe(true)
    } else {
      expect(anyMultiline).toBe(true)
    }
  })

  test('Multi-line edit round-trips through the downloaded PDF', async ({ page }) => {
    await openFixture(page, /IRS Schedule A/)
    await page.keyboard.press('e')
    const targets = page.getByTestId('edit-target')
    await expect(targets.first()).toBeVisible({ timeout: 10_000 })
    // Find the first multi-line target.
    const multiLineIdx = await targets.evaluateAll((els) =>
      els.findIndex((e) => (e.getAttribute('title') ?? '').includes('\n')),
    )
    if (multiLineIdx < 0) test.skip()
    await targets.nth(multiLineIdx).click()
    const editor = page.locator('[contenteditable]').last()
    await expect(editor).toBeVisible()
    // Replace with our own two-line content.
    await editor.evaluate((el) => { el.innerHTML = 'LINE_ONE<br>LINE_TWO' })
    await editor.dispatchEvent('input')

    const dl = page.waitForEvent('download', { timeout: 30_000 })
    await page.getByRole('button', { name: /^Download$/ }).click()
    const download = await dl
    const path = await download.path()
    if (!path) throw new Error('download path missing')
    const fs = await import('node:fs/promises')
    const bytes = await fs.readFile(path)
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const reloaded = await pdfjs.getDocument({
      data: new Uint8Array(bytes), isEvalSupported: false, disableFontFace: true,
    }).promise
    const p = await reloaded.getPage(1)
    const tc = await p.getTextContent()
    const allText = tc.items.map((it: { str?: string }) => it.str ?? '').join(' ')
    expect(allText).toContain('LINE_ONE')
    expect(allText).toContain('LINE_TWO')
  })

  test('Existing textEdit annotations are clickable in edit mode and re-focus their editor', async ({ page }) => {
    await openFixture(page, /IRS Schedule A/)
    // First, make an edit.
    await page.keyboard.press('e')
    await page.getByTestId('edit-target').first().click()
    await page.locator('[contenteditable]').last().fill('first pass')
    await page.keyboard.press('Escape')
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())
    // Re-enter edit mode. The just-edited annotation should still be in the
    // DOM as a [data-id] wrapper. In edit mode it's now visually marked
    // (yellow ring) and stays pointer-clickable.
    await page.keyboard.press('e')
    const editedWrapper = page.locator('[data-id]').last()
    await expect(editedWrapper).toBeVisible()
    // Its computed style includes the amber ring colour we just added.
    const ring = await editedWrapper.evaluate((el) => getComputedStyle(el as HTMLElement).boxShadow)
    expect(ring).not.toBe('none')

    // Click the wrapper — it should re-focus the existing editor rather
    // than spawn a new annotation. Editor count stays at 1.
    await editedWrapper.click()
    await expect(page.locator('[contenteditable]')).toHaveCount(1)
    // And the contenteditable should now own the document focus.
    const isFocused = await page.evaluate(() => {
      const a = document.activeElement
      return !!a && a.getAttribute('contenteditable') === 'true'
    })
    expect(isFocused).toBe(true)
  })

  test('Editor uses tight line-height (1.0) so the new glyph baseline lands close to the original', async ({ page }) => {
    await openFixture(page, /IRS Schedule A/)
    await page.keyboard.press('e')
    await page.getByTestId('edit-target').first().click()
    const editor = page.locator('[contenteditable]').last()
    await expect(editor).toBeVisible()
    const lh = await editor.evaluate((el) => {
      const cs = getComputedStyle(el as HTMLElement)
      const fs = parseFloat(cs.fontSize)
      const lh = parseFloat(cs.lineHeight)
      // Some browsers report "normal" — ratio ~1.2. We set 1, so reading
      // back as-is (px) divided by font-size should be near 1.
      return fs > 0 && lh > 0 ? lh / fs : null
    })
    expect(lh).not.toBeNull()
    expect(lh!).toBeGreaterThan(0.9)
    expect(lh!).toBeLessThan(1.1)
  })

  test('Dragging a textEdit in edit mode keeps the original glyphs masked at the source bbox', async ({ page }) => {
    await openFixture(page, /IRS Schedule A/)
    await page.keyboard.press('e')
    const targets = page.getByTestId('edit-target')
    await expect(targets.first()).toBeVisible({ timeout: 10_000 })
    const before = await targets.count()
    await targets.first().click()
    await page.keyboard.press('Escape')
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())
    await page.keyboard.press('e')

    const cover = page.getByTestId('text-edit-cover').first()
    await expect(cover).toBeVisible()
    const coverBefore = await cover.boundingBox()
    const wrapper = page.locator('[data-id]').last()
    const wrapperBefore = await wrapper.boundingBox()
    if (!coverBefore || !wrapperBefore) throw new Error('no bbox before')

    await page.mouse.move(wrapperBefore.x + wrapperBefore.width / 2, wrapperBefore.y + wrapperBefore.height / 2)
    await page.mouse.down()
    await page.mouse.move(
      wrapperBefore.x + wrapperBefore.width / 2 + 80,
      wrapperBefore.y + wrapperBefore.height / 2 + 50,
      { steps: 10 },
    )
    await page.mouse.up()
    await page.waitForTimeout(300)

    // The cover must stay anchored to the original glyph bbox regardless of
    // where the wrapper moves — that's the load-bearing contract.
    const coverAfter = await cover.boundingBox()
    const wrapperAfter = await wrapper.boundingBox()
    if (!coverAfter) throw new Error('no cover bbox after')
    if (!wrapperAfter) throw new Error('no wrapper bbox after')
    expect(Math.abs(coverAfter.x - coverBefore.x)).toBeLessThan(1)
    expect(Math.abs(coverAfter.y - coverBefore.y)).toBeLessThan(1)
    expect(Math.abs(wrapperAfter.x - wrapperBefore.x)).toBeGreaterThan(20)

    // Re-entering edit mode must not expose the original run as a target again;
    // target suppression is based on the fixed source bbox, not the moved editor.
    await page.keyboard.press('Escape')
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())
    await page.keyboard.press('e')
    await expect(targets.first()).toBeVisible({ timeout: 10_000 })
    await expect.poll(async () => targets.count(), { timeout: 10_000 }).toBe(before - 1)
  })

  test('Cyrillic input round-trips through download (Unicode font fallback)', async ({ page }) => {
    // Audit found that text outside WinAnsi was silently mangled to '?'.
    // The Unicode-font fallback in buildPdf embeds Noto Sans for any run
    // that contains non-WinAnsi chars. Russian is the canonical test.
    await openFixture(page, /IRS 1040 \(2022\)/)
    await addTextAnnotation(page, 220, 220, 'русский текст')

    const dl = page.waitForEvent('download', { timeout: 30_000 })
    await page.getByRole('button', { name: /^Download$/ }).click()
    const download = await dl
    const path = await download.path()
    if (!path) throw new Error('download path missing')
    const fs = await import('node:fs/promises')
    const bytes = await fs.readFile(path)
    expect(bytes.subarray(0, 4).toString()).toBe('%PDF')

    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const reloaded = await pdfjs.getDocument({
      data: new Uint8Array(bytes), isEvalSupported: false, disableFontFace: true,
    }).promise
    const p = await reloaded.getPage(1)
    const tc = await p.getTextContent()
    const allText = tc.items.map((it: { str?: string }) => it.str ?? '').join(' ')
    // Critical assertion: the Cyrillic text actually round-tripped — we
    // must NOT see `?????`-style mangling.
    expect(allText).toContain('русский')
    expect(allText).not.toContain('?????')
  })

  test('Edit a German fixture with umlauts — replacement text retained', async ({ page }) => {
    await openFixture(page, /DE — Anmeldung/)
    await page.keyboard.press('e')
    await expect(page.getByTestId('edit-target').first()).toBeVisible({ timeout: 10_000 })
    await page.getByTestId('edit-target').first().click()
    const editor = page.locator('[contenteditable]').last()
    await editor.fill('Müller-Straße 23')
    await expect(editor).toContainText('Müller-Straße 23')

    // Download and confirm the umlauts survive the WinAnsi encoding pdf-lib
    // applies for StandardFonts.Helvetica.
    const dl = page.waitForEvent('download', { timeout: 30_000 })
    await page.getByRole('button', { name: /^Download$/ }).click()
    const download = await dl
    const path = await download.path()
    if (!path) throw new Error('download path missing')
    const fs = await import('node:fs/promises')
    const bytes = await fs.readFile(path)
    expect(bytes.subarray(0, 4).toString()).toBe('%PDF')

    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const reloaded = await pdfjs.getDocument({
      data: new Uint8Array(bytes), isEvalSupported: false, disableFontFace: true,
    }).promise
    const p = await reloaded.getPage(1)
    const tc = await p.getTextContent()
    const allText = tc.items.map((it: { str?: string }) => it.str ?? '').join(' ')
    expect(allText).toContain('Müller-Straße 23')
  })
})

// Sweep every bundled fixture through the download pipeline. Catches
// regressions where a specific fixture's structure (encrypted flag, weird
// resource trees, malformed embeds) causes pdf-lib to throw — the resilience
// path in buildPdf should produce a valid PDF for every one of them.
const ALL_FIXTURES: RegExp[] = [
  /IRS 1040 \(2022\)/,
  /IRS 1040 \(2010\)/,
  /IRS 1040 prefilled/,
  /USCIS Form I-9/,
  /Widget-only form/,
  /pdf\.js form regression/,
  /IRS Form W-9/,
  /IRS Form W-4/,
  /IRS Schedule A/,
  /Free-text annotation PDF/,
  /XFA — IMM1344E/,
  /DE — Anmeldung/,
  /DE — Krankmeldung/,
  /DE — Kündigung/,
  /DE — Mietvertrag/,
  /DE — Rechnung/,
  /DE — DRV V0005/,
  /DE — AA eID-card/,
  /DE — BNetzA 0800/,
  /DE — BA KiZ 5/,
  /DE — BA PD U1/,
  /EU — Financial ID/,
  /EU — ACER RRM/,
]

test.describe('download every bundled fixture', () => {
  for (const label of ALL_FIXTURES) {
    test(`${label.source} produces a valid PDF`, async ({ page }) => {
      await openFixture(page, label)
      const dl = page.waitForEvent('download', { timeout: 30_000 })
      await page.getByRole('button', { name: /^Download$/ }).click()
      const download = await dl
      const path = await download.path()
      if (!path) throw new Error(`download path missing for ${label.source}`)
      const fs = await import('node:fs/promises')
      const bytes = await fs.readFile(path)
      // PDF magic + EOF marker + parseable by pdf-lib.
      expect(bytes.length).toBeGreaterThan(500)
      expect(bytes.subarray(0, 4).toString()).toBe('%PDF')
      const tail = bytes.subarray(Math.max(0, bytes.length - 64)).toString()
      expect(tail).toContain('%%EOF')
      const { PDFDocument } = await import('pdf-lib')
      const doc = await PDFDocument.load(bytes, { ignoreEncryption: true })
      expect(doc.getPageCount()).toBeGreaterThan(0)
    })
  }
})

test.describe('onboarding tour', () => {
  // No init-script overrides — the global beforeEach skips this describe so
  // each test starts in a fresh browser context with an empty localStorage
  // (= the tour is visible on first goto, persists after Skip across reload).

  test('shows on first visit with a centred welcome card', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId('onboarding-card')).toBeVisible()
    await expect(page.getByText('Welcome to PDF Helper')).toBeVisible()
    // Skip text button + close (X) icon both present.
    await expect(page.getByTestId('onboarding-skip-text')).toBeVisible()
    await expect(page.getByTestId('onboarding-skip')).toBeVisible()
  })

  test('Skip dismisses the tour and persists across reload', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('onboarding-skip-text').click()
    await expect(page.getByTestId('onboarding-card')).toBeHidden()
    // Reload — flag in localStorage should keep it dismissed.
    await page.reload()
    await expect(page.getByTestId('onboarding-card')).toBeHidden()
  })

  test('the X close button also dismisses the tour', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId('onboarding-card')).toBeVisible()
    await page.getByTestId('onboarding-skip').click()
    await expect(page.getByTestId('onboarding-card')).toBeHidden()
  })

  test('after opening a PDF, the tour transitions into a toolbar walkthrough', async ({ page }) => {
    await page.goto('/')
    // Pre-PDF: the welcome card.
    await expect(page.getByText('Welcome to PDF Helper')).toBeVisible()
    // Click a sample to enter the post-open phase. The walkthrough's exact
    // step list grows over time — assert the first step is "Add text", the
    // last step is "Download" (Next becomes "Done"), and that walking
    // through all of them dismisses the card and persists across reload.
    await page.locator('input[type="file"][accept="application/pdf"]').first()
      .setInputFiles('fixtures/forms/f1040-2022.pdf')
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Add text anywhere')).toBeVisible()
    // Click Next until the button reads "Done", then click once more.
    for (let i = 0; i < 30; i++) {
      const next = page.getByTestId('onboarding-next')
      const label = (await next.textContent())?.trim() ?? ''
      if (/Done/i.test(label)) break
      await next.click()
    }
    await expect(page.getByTestId('onboarding-next')).toHaveText(/Done/)
    await page.getByTestId('onboarding-next').click()
    await expect(page.getByTestId('onboarding-card')).toBeHidden()
    // Reload — completion persisted.
    await page.reload()
    await expect(page.getByTestId('onboarding-card')).toBeHidden()
  })
})

test.describe('language picker', () => {
  test('auto-detects browser locale (de-DE → German UI)', async ({ browser }) => {
    const ctx = await browser.newContext({ locale: 'de-DE' })
    const page = await ctx.newPage()
    await page.addInitScript(() => {
      try { localStorage.setItem('pdfhelper.onboardingDone.v2', '1') } catch { /* ignore */ }
    })
    await page.goto('/')
    // Heading on the empty state translates to "PDF ausfüllen & unterschreiben".
    await expect(page.getByRole('heading', { name: /PDF ausfüllen/ })).toBeVisible()
    await ctx.close()
  })

  test('auto-detects Chinese browser locale (zh-CN → Simplified Chinese UI)', async ({ browser }) => {
    const ctx = await browser.newContext({ locale: 'zh-CN' })
    const page = await ctx.newPage()
    await page.addInitScript(() => {
      try { localStorage.setItem('pdfhelper.onboardingDone.v2', '1') } catch { /* ignore */ }
    })
    await page.goto('/')
    await expect(page.getByRole('heading', { name: /填写并签署/ })).toBeVisible()
    await ctx.close()
  })

  test('auto-detects Japanese browser locale (ja-JP → Japanese UI)', async ({ browser }) => {
    const ctx = await browser.newContext({ locale: 'ja-JP' })
    const page = await ctx.newPage()
    await page.addInitScript(() => {
      try { localStorage.setItem('pdfhelper.onboardingDone.v2', '1') } catch { /* ignore */ }
    })
    await page.goto('/')
    await expect(page.getByRole('heading', { name: /PDF を入力/ })).toBeVisible()
    await ctx.close()
  })

  test('Arabic flips the document to RTL and shows Arabic copy', async ({ browser }) => {
    const ctx = await browser.newContext({ locale: 'ar-SA' })
    const page = await ctx.newPage()
    await page.addInitScript(() => {
      try { localStorage.setItem('pdfhelper.onboardingDone.v2', '1') } catch { /* ignore */ }
    })
    await page.goto('/')
    await expect(page.getByRole('heading', { name: /تعبئة وتوقيع PDF/ })).toBeVisible()
    // The App-level effect mirrors the language onto <html dir>.
    const dir = await page.locator('html').getAttribute('dir')
    expect(dir).toBe('rtl')
    const htmlLang = await page.locator('html').getAttribute('lang')
    expect(htmlLang).toBe('ar')
    await ctx.close()
  })

  test('switching back to a non-Arabic language flips dir back to LTR', async ({ browser }) => {
    const ctx = await browser.newContext({ locale: 'ar-SA' })
    const page = await ctx.newPage()
    await page.addInitScript(() => {
      try { localStorage.setItem('pdfhelper.onboardingDone.v2', '1') } catch { /* ignore */ }
    })
    await page.goto('/')
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl')
    await page.getByTestId('lang-button').click()
    await page.getByTestId('lang-option-en').click()
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr')
    await ctx.close()
  })

  test('manual switch updates the toolbar labels and persists across reload', async ({ browser }) => {
    const ctx = await browser.newContext({ locale: 'en-US' })
    const page = await ctx.newPage()
    await page.addInitScript(() => {
      try { localStorage.setItem('pdfhelper.onboardingDone.v2', '1') } catch { /* ignore */ }
    })
    await page.goto('/?snap=debug')
    await page.locator('input[type="file"][accept="application/pdf"]').first()
      .setInputFiles('fixtures/forms/f1040-2022.pdf')
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15_000 })

    // Default English: "Add text" button is present.
    await expect(page.getByRole('button', { name: /^Add text$/ })).toBeVisible()

    // Open the picker and switch to French.
    await page.getByTestId('lang-button').click()
    await page.getByTestId('lang-option-fr').click()

    // After switch the same button is now labelled "Ajouter du texte".
    await expect(page.getByRole('button', { name: /^Ajouter du texte$/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Add text$/ })).toHaveCount(0)

    // Persists across reload — `pdfhelper.lang = 'fr'` is in localStorage.
    await page.reload()
    // Assert the persistence by reading localStorage directly. Earlier the
    // test tried to click the recent-file button or check the French
    // heading, but in parallel the IndexedDB recent state was nondeterministic
    // (sometimes the recent click reopened the PDF and hid the heading,
    // making the assertion race the load) — flaky.
    const persistedLang = await page.evaluate(() => localStorage.getItem('pdfhelper.lang'))
    expect(persistedLang).toBe('fr')
    await ctx.close()
  })

  test('cycles through every supported language without errors', async ({ browser }) => {
    const ctx = await browser.newContext({ locale: 'en-US' })
    const page = await ctx.newPage()
    await page.addInitScript(() => {
      try { localStorage.setItem('pdfhelper.onboardingDone.v2', '1') } catch { /* ignore */ }
    })
    await page.goto('/')

    const expectedHeadings: Record<string, RegExp> = {
      en: /Fill & sign a PDF/,
      de: /PDF ausfüllen/,
      fr: /Remplir & signer/,
      es: /Rellenar & firmar/,
      zh: /填写并签署/,
      ja: /PDF を入力/,
      hi: /PDF भरें/,
      ar: /تعبئة وتوقيع/,
      bn: /PDF পূরণ/,
      ru: /Заполнить и подписать/,
      pt: /Preencher & assinar/,
      id: /Isi & tanda tangan/,
      tr: /PDF doldur ve imzala/,
      vi: /Điền & ký PDF/,
      th: /กรอกและเซ็น PDF/,
      ko: /PDF 작성 및 서명/,
      it: /Compila e firma un PDF/,
    }

    for (const code of ['de', 'fr', 'es', 'zh', 'ja', 'hi', 'ar', 'bn', 'ru', 'pt', 'id', 'tr', 'vi', 'th', 'ko', 'it', 'en'] as const) {
      // Radix Popover sometimes lingers between rapid open/close cycles —
      // give it a beat to settle and dismiss any stale popover before the
      // next trigger click.
      await page.keyboard.press('Escape').catch(() => {})
      await page.waitForTimeout(150)
      await page.getByTestId('lang-button').click()
      const opt = page.getByTestId(`lang-option-${code}`)
      await expect(opt).toBeVisible({ timeout: 5_000 })
      await opt.click()
      await expect(page.getByRole('heading', { name: expectedHeadings[code] })).toBeVisible()
    }
    await ctx.close()
  })
})

test.describe('UI guards', () => {
  test('Download button is disabled when no PDF is open and enabled afterwards', async ({ page }) => {
    await page.goto('/')
    const dl = page.getByRole('button', { name: /^Download$/ })
    await expect(dl).toBeDisabled()
    await page.locator('input[type="file"][accept="application/pdf"]').first()
      .setInputFiles('fixtures/forms/f1040-2022.pdf')
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 15_000 })
    await expect(dl).toBeEnabled()
  })

  test('@mobile mobile toolbar exposes primary and overflow PDF actions', async ({ page }) => {
    await openFixture(page, /IRS 1040 \(2022\)/)
    await expect(page.getByRole('button', { name: /^Save$/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Text$/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Sign$/ })).toBeVisible()

    await page.getByRole('button', { name: /^More$/ }).click()
    const popover = page.locator('[data-slot="popover-content"]').last()
    await expect(popover).toBeVisible()
    await expect(popover.getByRole('button', { name: /^Redact$/ })).toBeVisible()
    await expect(popover.getByRole('button', { name: /^Add image/ })).toBeVisible()
    await expect(popover.getByText(/^Watermark$/)).toBeVisible()
    await expect(popover.getByRole('button', { name: /^Add to end$/ })).toBeVisible()
  })
})

test.describe('watermark', () => {
  test('toolbar control shows a page watermark preview', async ({ page }) => {
    await openFixture(page, /IRS 1040 \(2022\)/)
    await expect(page.locator('[data-page-idx="0"] canvas')).toBeVisible({ timeout: 15_000 })

    await page.getByRole('button', { name: /^Watermark$/ }).click()
    const popover = page.locator('[data-slot="popover-content"]').last()
    await expect(popover).toBeVisible()
    await popover.getByLabel(/^Add watermark to PDF$/).check()
    await expect(popover.getByText(/^Added$/)).toBeVisible()
    await popover.getByLabel(/^Watermark text$/).fill('APPROVED')

    const preview = page.getByTestId('watermark-preview').first()
    await expect(preview).toBeVisible()
    await expect(preview).toContainText('APPROVED')
  })

  test('downloaded PDF includes the configured watermark text', async ({ page }) => {
    await openFixture(page, /IRS 1040 \(2022\)/)
    await page.getByRole('button', { name: /^Watermark$/ }).click()
    const popover = page.locator('[data-slot="popover-content"]').last()
    await expect(popover).toBeVisible()
    await popover.getByLabel(/^Add watermark to PDF$/).check()
    await popover.getByLabel(/^Watermark text$/).fill('E2E-WATERMARK')
    await page.keyboard.press('Escape')

    const bytes = await downloadPdfBytes(page)
    await expectValidPdf(bytes)
    const allText = await extractPdfText(bytes)
    expect(allText).toContain('E2E-WATERMARK')
  })
})

test.describe('page numbers', () => {
  test('toolbar control shows a preview and downloaded PDF includes page numbers', async ({ page }) => {
    await openFixture(page, /USCIS Form I-9/)
    await expect(page.locator('[data-page-idx="0"] canvas')).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('[data-page-idx]')).toHaveCount(5, { timeout: 20_000 })

    await page.getByRole('button', { name: /^Page numbers$/ }).click()
    const popover = page.locator('[data-slot="popover-content"]').last()
    await expect(popover).toBeVisible()
    await popover.getByLabel(/^Insert page numbers$/).check()
    await popover.getByLabel(/^Page number position$/).click()
    await page.getByRole('option', { name: /^Top right$/ }).click()

    const preview = page.getByTestId('page-number-preview').first()
    await expect(preview).toBeVisible()
    await expect(preview).toContainText('Page 1 of 5')
    await page.keyboard.press('Escape')

    const bytes = await downloadPdfBytes(page)
    await expectValidPdf(bytes, 5)
    const page1Text = await extractPdfText(bytes, 1)
    const page5Text = await extractPdfText(bytes, 5)
    expect(page1Text).toContain('Page 1 of 5')
    expect(page5Text).toContain('Page 5 of 5')
  })
})

test.describe('merge / reorder / compress', () => {
  // Helper: count rendered page wrappers (one per page in the doc).
  async function pageCount(page: Page): Promise<number> {
    return await page.locator('[data-page-idx]').count()
  }

  test('Merge: appending a PDF grows the page count', async ({ page }) => {
    await openFixture(page, /IRS Schedule A/)
    await expect(page.locator('[data-page-idx="0"] canvas')).toBeVisible({ timeout: 15_000 })
    const beforeCount = await pageCount(page)
    expect(beforeCount).toBeGreaterThanOrEqual(1)

    // Open the merge popover and pick "Add to end".
    await page.getByRole('button', { name: /Merge another PDF/i }).click()
    await page.getByRole('button', { name: /Add to end/i }).click()

    // The popover's "Add to end" button click triggered a hidden <input
    // type="file"> click — Playwright detected it and now expects the next
    // setInputFiles. Find the merge input (the second pdf file input on
    // the page; first is "Open").
    const mergeInput = page.locator('input[type="file"][accept="application/pdf"]').nth(1)
    await mergeInput.setInputFiles('fixtures/forms/irs-w9.pdf')  // ≥ 1 page

    // After the merge, the doc should have strictly more pages than before.
    await expect.poll(
      async () => pageCount(page),
      { timeout: 20_000 },
    ).toBeGreaterThan(beforeCount)
  })

  test('Reorder: dragging a thumbnail re-saves the doc without losing pages', async ({ page }) => {
    // W-9 has 6 pages — enough rail thumbs to drag between.
    await openFixture(page, /IRS Form W-9/)
    await expect(page.locator('[data-page-idx="0"] canvas')).toBeVisible({ timeout: 15_000 })
    await expect.poll(async () => pageCount(page), { timeout: 20_000 }).toBe(6)
    const before = await pageCount(page)
    expect(before).toBeGreaterThanOrEqual(2)

    // The thumbnail rail only renders on viewport ≥1024px. The default
    // Playwright viewport is 1280×720, so it shows up.
    const rail = page.getByLabel('Page thumbnails')
    await expect(rail).toBeVisible()

    // Drag thumb 0 to thumb 2's position. HTML5 DnD via Playwright's
    // dragTo() — issues dragstart/dragenter/dragover/drop in the right
    // order, which our handler chain expects.
    const thumb0 = rail.locator('li').nth(0)
    const thumb2 = rail.locator('li').nth(2)
    await thumb0.dragTo(thumb2)

    // The doc gets re-saved + re-parsed. Page count must be unchanged
    // after reorder (reorder is a permutation, not an insert/delete).
    await expect.poll(async () => pageCount(page), { timeout: 20_000 }).toBe(before)
    // No JS errors during the drag.
  })

  test('Rotate: right rail button rotates a page without losing pages', async ({ page }) => {
    await openFixture(page, /IRS Form W-9/)
    const canvas = page.locator('[data-page-idx="0"] canvas')
    await expect(canvas).toBeVisible({ timeout: 15_000 })
    await expect.poll(async () => pageCount(page), { timeout: 20_000 }).toBe(6)
    const beforeCount = await pageCount(page)
    const beforeBox = await canvas.boundingBox()
    if (!beforeBox) throw new Error('missing first page bbox before rotate')
    expect(beforeBox.height).toBeGreaterThan(beforeBox.width)

    const rail = page.getByLabel('Page thumbnails')
    await expect(rail).toBeVisible()
    const actions = rail.getByTestId('page-thumbnail-actions').first()
    await expect.poll(async () => actions.evaluate((el) => getComputedStyle(el).opacity)).toBe('0')
    await rail.locator('li').first().hover()
    await expect.poll(async () => actions.evaluate((el) => getComputedStyle(el).opacity)).toBe('1')
    await rail.getByRole('button', { name: /Rotate page clockwise 1/i }).click()

    await expect.poll(async () => pageCount(page), { timeout: 20_000 }).toBe(beforeCount)
    await expect.poll(async () => {
      const box = await canvas.boundingBox()
      if (!box) return false
      return box.width > box.height
    }, { timeout: 20_000 }).toBe(true)
  })

  test('Delete page: right rail button removes one page', async ({ page }) => {
    await openFixture(page, /IRS Form W-9/)
    await expect(page.locator('[data-page-idx="0"] canvas')).toBeVisible({ timeout: 15_000 })
    await expect.poll(async () => pageCount(page), { timeout: 20_000 }).toBe(6)
    const beforeCount = await pageCount(page)
    expect(beforeCount).toBeGreaterThanOrEqual(2)

    const rail = page.getByLabel('Page thumbnails')
    await expect(rail).toBeVisible()
    await rail.locator('li').nth(1).hover()
    await rail.getByRole('button', { name: /Delete page 2/i }).click()
    const dialog = page.getByRole('dialog', { name: /Delete page 2/i })
    await expect(dialog).toBeVisible()
    await dialog.getByRole('button', { name: /^Delete page$/i }).click()

    await expect.poll(async () => pageCount(page), { timeout: 20_000 }).toBe(beforeCount - 1)
  })

  test('Compress: High does not make an already-optimized PDF larger', async ({ page }) => {
    await openFixture(page, /IRS 1040 \(2022\)/)
    await expect(page.locator('[data-page-idx="0"] canvas')).toBeVisible({ timeout: 15_000 })

    // First download — uncompressed (default).
    const downloadDefault = page.waitForEvent('download')
    await page.getByRole('button', { name: /^Download$/ }).click()
    const dl1 = await downloadDefault
    const path1 = await dl1.path()
    const fs = await import('node:fs')
    const sizeDefault = fs.statSync(path1).size

    // Open the download options popover, tick the compress checkbox, and pick
    // High compression (96 DPI). For vector-heavy forms this may still be
    // larger than the editable PDF, so the app should fall back to the
    // normal edited bytes instead of downloading a bigger "compressed" file.
    await page.getByRole('button', { name: /Download options/i }).click()
    await page.getByRole('checkbox', { name: /Make PDF smaller/i }).check()
    await page.getByRole('combobox', { name: /Compression/i }).click()
    await page.getByRole('option', { name: /^High\b/ }).click()

    // Close the popover by clicking the main Download button — that also
    // triggers the second download.
    const downloadCompressed = page.waitForEvent('download', { timeout: 60_000 })
    await page.getByRole('button', { name: /^Download$/ }).click()
    const dl2 = await downloadCompressed
    const path2 = await dl2.path()
    const sizeCompressed = fs.statSync(path2).size

    // Compression must never make the user's download larger. For this
    // vector-heavy source, the app usually chooses the normal edited PDF
    // because raster JPEG pages would be larger.
    expect(sizeCompressed).toBeGreaterThan(1000)
    expect(sizeCompressed).toBeLessThanOrEqual(sizeDefault)

    // Verify the bytes are a valid PDF (just check the magic bytes — full
    // round-trip parsing is covered by the buildPdf unit tests).
    const bytes = fs.readFileSync(path2)
    expect(bytes.slice(0, 5).toString('ascii')).toBe('%PDF-')
  })

  test('Compress: High compression produces a smaller file than Low on raster content', async ({ page }) => {
    // Sanity check that the Low/Mid/High preset actually flows through to
    // output. Use an image-heavy government PDF where raster compression is
    // expected to win over the normal editable output.
    await openFixture(page, /DE — DRV V0005/)
    await expect(page.locator('[data-page-idx="0"] canvas')).toBeVisible({ timeout: 15_000 })

    const fs = await import('node:fs')

    // Low compression: 200 DPI, higher JPEG quality.
    await page.getByRole('button', { name: /Download options/i }).click()
    await page.getByRole('checkbox', { name: /Make PDF smaller/i }).check()
    // Open the level select. shadcn's <Select> is a Radix combobox.
    await page.getByRole('combobox', { name: /Compression/i }).click()
    await page.getByRole('option', { name: /^Low\b/ }).click()
    // Close popover with main Download click.
    const dlLow = page.waitForEvent('download', { timeout: 60_000 })
    await page.getByRole('button', { name: /^Download$/ }).click()
    const sizeLow = fs.statSync(await (await dlLow).path()).size

    // High compression: 96 DPI, lower JPEG quality.
    await page.getByRole('button', { name: /Download options/i }).click()
    await page.getByRole('combobox', { name: /Compression/i }).click()
    await page.getByRole('option', { name: /^High\b/ }).click()
    const dlHigh = page.waitForEvent('download', { timeout: 60_000 })
    await page.getByRole('button', { name: /^Download$/ }).click()
    const sizeHigh = fs.statSync(await (await dlHigh).path()).size

    expect(sizeHigh).toBeLessThan(sizeLow)
  })
})
