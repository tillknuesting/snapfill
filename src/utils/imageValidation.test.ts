import { describe, expect, it } from 'vitest'
import { MAX_IMAGE_BYTES, validateImageFile } from './imageValidation'

function makeFile(name: string, mime: string, size: number): File {
  // We don't need real bytes — only `.size`, `.type`, `.name` are read by the
  // validator. Synthesize a tiny Blob and patch the size via Object.defineProperty.
  const blob = new Blob(['x'], { type: mime })
  const f = new File([blob], name, { type: mime })
  Object.defineProperty(f, 'size', { value: size })
  return f
}

describe('validateImageFile', () => {
  it('accepts a typical PNG', () => {
    const f = makeFile('photo.png', 'image/png', 100_000)
    const r = validateImageFile(f)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.mime).toBe('image/png')
  })

  it('accepts a JPEG with .jpg extension', () => {
    const r = validateImageFile(makeFile('photo.jpg', 'image/jpeg', 100_000))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.mime).toBe('image/jpeg')
  })

  it('accepts a JPEG with .jpeg extension', () => {
    const r = validateImageFile(makeFile('photo.jpeg', 'image/jpeg', 100_000))
    expect(r.ok).toBe(true)
  })

  it('accepts GIF and WebP', () => {
    expect(validateImageFile(makeFile('a.gif', 'image/gif', 1_000)).ok).toBe(true)
    expect(validateImageFile(makeFile('a.webp', 'image/webp', 1_000)).ok).toBe(true)
  })

  it('rejects empty files', () => {
    const r = validateImageFile(makeFile('a.png', 'image/png', 0))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/empty/i)
  })

  it('rejects files larger than the cap', () => {
    const r = validateImageFile(makeFile('huge.png', 'image/png', MAX_IMAGE_BYTES + 1))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/too large/i)
  })

  it('rejects unsupported extensions', () => {
    const r = validateImageFile(makeFile('a.svg', 'image/svg+xml', 1_000))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/extension/i)
  })

  it('rejects unsupported extensions even with a permitted MIME', () => {
    // Pretending an SVG is a PNG via mime spoof — extension still wrong
    const r = validateImageFile(makeFile('shenanigan.bmp', 'image/png', 1_000))
    expect(r.ok).toBe(false)
  })

  it('rejects mismatched MIME (allowed extension, hostile MIME)', () => {
    // Renamed-to-png file but the browser tagged its MIME as something not allowed.
    const r = validateImageFile(makeFile('renamed.png', 'image/svg+xml', 1_000))
    expect(r.ok).toBe(false)
  })

  it('handles missing extensions gracefully', () => {
    const r = validateImageFile(makeFile('noext', 'image/png', 1_000))
    expect(r.ok).toBe(false)
  })

  it('falls back to extension when MIME is missing', () => {
    const r = validateImageFile(makeFile('photo.png', '', 1_000))
    expect(r.ok).toBe(true)
  })
})
