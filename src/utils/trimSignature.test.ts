import { describe, expect, it } from 'vitest'
import { trimCanvas } from './trimSignature'

// jsdom doesn't include a real 2D canvas implementation. trimCanvas is small
// enough that we can stub the parts of HTMLCanvasElement we touch.

interface FakePixel { a: number }
function makeCanvasWithPixels(width: number, height: number, pixels: FakePixel[]): HTMLCanvasElement {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < pixels.length; i++) {
    data[i * 4 + 3] = pixels[i].a
  }
  // Provide a minimal canvas shim: we just need .width/.height, getContext('2d').getImageData,
  // toDataURL. Anything trimCanvas calls that we don't stub will throw.
  const canvas = {
    width, height,
    getContext: ((id: string) => {
      if (id !== '2d') return null
      return {
        getImageData: () => ({ data, width, height, colorSpace: 'srgb' }),
        drawImage: () => {},
      }
    }) as unknown as HTMLCanvasElement['getContext'],
    toDataURL: () => 'data:image/png;base64,FAKE',
  }
  return canvas as unknown as HTMLCanvasElement
}

describe('trimCanvas', () => {
  it('returns a data URL', () => {
    // 2x2 canvas, all transparent → no content found → returns toDataURL()
    const canvas = makeCanvasWithPixels(2, 2, [
      { a: 0 }, { a: 0 },
      { a: 0 }, { a: 0 },
    ])
    expect(trimCanvas(canvas)).toBe('data:image/png;base64,FAKE')
  })

  // The "opaque pixel found" path requires creating a fresh canvas via
  // document.createElement and drawing onto it — jsdom's canvas backend is
  // a no-op stub. That path is exercised by the e2e suite (TODO).
})
