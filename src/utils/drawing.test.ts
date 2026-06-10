import { describe, expect, it } from 'vitest'
import {
  drawingToSvgPath,
  findTopmostDrawingAtPoint,
  pointsToSmoothPath,
  previewStrokePath,
  scaleDrawing,
  strokeToDrawingAnnotation,
} from './drawing'
import type { DrawingAnnotation } from '@/types'

describe('pointsToSmoothPath', () => {
  it('returns empty string for no points', () => {
    expect(pointsToSmoothPath([])).toBe('')
  })

  it('emits a single moveTo for one point', () => {
    expect(pointsToSmoothPath([[1, 2]])).toBe('M 1.00 2.00')
  })

  it('emits a moveTo + lineTo for two points', () => {
    expect(pointsToSmoothPath([[0, 0], [10, 10]])).toBe('M 0.00 0.00 L 10.00 10.00')
  })

  it('uses quadratic curves through midpoints for ≥3 points', () => {
    const d = pointsToSmoothPath([[0, 0], [10, 0], [20, 0], [30, 0]])
    // Starts with moveTo
    expect(d).toMatch(/^M 0\.00 0\.00/)
    // Has at least one quadratic curve
    expect(d).toMatch(/\sQ\s/)
    // Ends with a line to the final point
    expect(d).toMatch(/L 30\.00 0\.00$/)
  })
})

describe('strokeToDrawingAnnotation', () => {
  it('returns null for too-short strokes', () => {
    expect(strokeToDrawingAnnotation([], 1, 0, '#000', 1, 2)).toBeNull()
    expect(strokeToDrawingAnnotation([[1, 1]], 1, 0, '#000', 1, 2)).toBeNull()
  })

  it('produces an annotation with a sane bbox', () => {
    const cssPoints: Array<[number, number]> = [[100, 100], [200, 100], [200, 200]]
    const a = strokeToDrawingAnnotation(cssPoints, 2, 0, '#dc2626', 0.8, 4)!
    expect(a.type).toBe('drawing')
    expect(a.color).toBe('#dc2626')
    expect(a.opacity).toBe(0.8)
    expect(a.strokeWidth).toBe(4)
    expect(a.pageIdx).toBe(0)
    // CSS coords divided by scale=2 → PDF coords 50..100
    // Plus margin (strokeWidth/2 + 2 = 4) on each side → bbox roughly 42..104
    expect(a.x).toBeLessThanOrEqual(50)
    expect(a.y).toBeLessThanOrEqual(50)
    expect(a.w).toBeGreaterThan(50)
    expect(a.h).toBeGreaterThan(50)
  })

  it('shifts points to local bbox coords (top-left at 0,0)', () => {
    const a = strokeToDrawingAnnotation([[10, 20], [30, 50]], 1, 0, '#000', 1, 2)!
    // The leftmost x and topmost y should map to roughly the margin (~3pt)
    const minX = Math.min(...a.points.map((p) => p[0]))
    const minY = Math.min(...a.points.map((p) => p[1]))
    expect(minX).toBeGreaterThanOrEqual(2)
    expect(minY).toBeGreaterThanOrEqual(2)
    // And the local coords should not exceed bbox dimensions
    const maxX = Math.max(...a.points.map((p) => p[0]))
    const maxY = Math.max(...a.points.map((p) => p[1]))
    expect(maxX).toBeLessThanOrEqual(a.w)
    expect(maxY).toBeLessThanOrEqual(a.h)
  })

  it('forces a clean line when the line tool is selected', () => {
    const a = strokeToDrawingAnnotation([[10, 10], [20, 15], [80, 20]], 1, 0, '#000', 1, 2, 'line')!

    expect(a.shape).toBe('line')
    expect(a.points).toHaveLength(2)
    expect(drawingToSvgPath(a)).toMatch(/^M .* L /)
  })

  it('forces a clean arrow when the arrow tool is selected', () => {
    const a = strokeToDrawingAnnotation([[10, 10], [80, 10]], 1, 0, '#000', 1, 2, 'arrow')!

    expect(a.shape).toBe('arrow')
    expect(drawingToSvgPath(a)).toContain(' L ')
    expect(drawingToSvgPath(a).match(/M/g)).toHaveLength(2)
  })

  it('cleans rough closed strokes into rectangles', () => {
    const roughRect: Array<[number, number]> = [
      [10, 10], [45, 9], [80, 12], [82, 38], [78, 70], [42, 72], [10, 68], [8, 40], [10, 10],
    ]
    const a = strokeToDrawingAnnotation(roughRect, 1, 0, '#000', 1, 2)!

    expect(a.shape).toBe('rectangle')
    expect(drawingToSvgPath(a)).toContain(' Z')
  })

  it('cleans checkmark-like strokes into a check shape', () => {
    const check: Array<[number, number]> = [[10, 28], [25, 45], [58, 10]]
    const a = strokeToDrawingAnnotation(check, 1, 0, '#000', 1, 2)!

    expect(a.shape).toBe('check')
    expect(a.points).toHaveLength(3)
  })
})

describe('previewStrokePath', () => {
  it('renders tool previews for line and arrow', () => {
    expect(previewStrokePath([[0, 0], [20, 10]], 'line')).toBe('M 0.00 0.00 L 20.00 10.00')
    expect(previewStrokePath([[0, 0], [20, 10]], 'arrow')).toContain('M')
  })
})

describe('findTopmostDrawingAtPoint', () => {
  it('returns the topmost drawing near a stroke', () => {
    const bottom: DrawingAnnotation = {
      id: 'bottom',
      type: 'drawing',
      pageIdx: 0,
      x: 0,
      y: 0,
      w: 50,
      h: 50,
      points: [[0, 0], [50, 50]],
      color: '#000',
      opacity: 1,
      strokeWidth: 2,
    }
    const top: DrawingAnnotation = { ...bottom, id: 'top', color: '#dc2626' }

    expect(findTopmostDrawingAtPoint([bottom, top], { x: 24, y: 25 })?.id).toBe('top')
    expect(findTopmostDrawingAtPoint([bottom, top], { x: 80, y: 80 })).toBeNull()
  })
})

describe('scaleDrawing', () => {
  const base: DrawingAnnotation = {
    id: '1',
    type: 'drawing',
    pageIdx: 0,
    x: 10,
    y: 20,
    w: 100,
    h: 50,
    points: [[0, 0], [50, 25], [100, 50]],
    color: '#000',
    opacity: 1,
    strokeWidth: 2,
  }

  it('scales points and stroke width uniformly', () => {
    const scaled = scaleDrawing(base, 2)
    expect(scaled.strokeWidth).toBe(4)
    expect(scaled.points).toEqual([[0, 0], [100, 50], [200, 100]])
  })

  it('preserves the rest of the annotation', () => {
    const scaled = scaleDrawing(base, 1.5)
    expect(scaled.id).toBe(base.id)
    expect(scaled.color).toBe(base.color)
    expect(scaled.x).toBe(base.x)
    expect(scaled.y).toBe(base.y)
  })
})
