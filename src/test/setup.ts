// Test setup — runs before each test file. Three things:
//   1. localStorage polyfill (jsdom's gets shadowed by Node 25's built-in Web Storage).
//   2. fake-indexeddb so the IndexedDB-backed Recent files cache is testable.
//   3. @testing-library/jest-dom matchers (`toBeInTheDocument`, etc.).

import 'fake-indexeddb/auto'
import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach } from 'vitest'
import { cleanup } from '@testing-library/react'

const store = new Map<string, string>()

const localStoragePolyfill: Storage = {
  get length() { return store.size },
  clear() { store.clear() },
  getItem(key: string) { return store.get(key) ?? null },
  key(index: number) { return Array.from(store.keys())[index] ?? null },
  removeItem(key: string) { store.delete(key) },
  setItem(key: string, value: string) { store.set(key, String(value)) },
}

Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: localStoragePolyfill,
})

// jsdom doesn't ship `document.execCommand` / `queryCommandState` (deprecated
// in browsers but still supported by all current engines); shim them so
// vi.spyOn works and components that read state from them don't crash.
if (typeof document !== 'undefined') {
  if (!('execCommand' in document)) {
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      writable: true,
      value: () => true,
    })
  }
  if (!('queryCommandState' in document)) {
    Object.defineProperty(document, 'queryCommandState', {
      configurable: true,
      writable: true,
      value: () => false,
    })
  }
}

// `matchMedia` is missing in jsdom — ThemeToggle uses it to detect the OS
// dark-mode preference. Stub returns "no preference" + ignores listeners.
if (typeof window !== 'undefined' && !window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent() { return false },
    }),
  })
}

// Radix UI's tooltip / popover internals use ResizeObserver, which jsdom
// doesn't ship. A no-op shim is enough — none of our component tests assert
// on resize behaviour.
if (typeof globalThis.ResizeObserver === 'undefined') {
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    value: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  })
}

// `Element.hasPointerCapture` / `setPointerCapture` are also missing in jsdom
// but Radix's primitives call them. Stub.
if (typeof window !== 'undefined' && !window.HTMLElement.prototype.hasPointerCapture) {
  Object.defineProperty(window.HTMLElement.prototype, 'hasPointerCapture', {
    configurable: true,
    value: function () { return false },
  })
  Object.defineProperty(window.HTMLElement.prototype, 'setPointerCapture', {
    configurable: true,
    value: function () {},
  })
  Object.defineProperty(window.HTMLElement.prototype, 'releasePointerCapture', {
    configurable: true,
    value: function () {},
  })
}

// `scrollIntoView` (used by some Radix primitives + our PdfPage code) is
// also missing in jsdom.
if (typeof window !== 'undefined' && !window.HTMLElement.prototype.scrollIntoView) {
  Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: function () {},
  })
}

beforeEach(() => { store.clear() })
afterEach(() => { cleanup() })
