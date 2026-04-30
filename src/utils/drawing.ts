import type { DrawingAnnotation } from '@/types'

// Build an SVG path d-string from a sequence of points using quadratic Bezier
// smoothing through midpoints. The result looks like real ink rather than a
// jagged polyline.
export function pointsToSmoothPath(points: Array<[number, number]>): string {
  if (points.length === 0) return ''
  const f = (n: number) => n.toFixed(2)
  if (points.length === 1) {
    return `M ${f(points[0][0])} ${f(points[0][1])}`
  }
  if (points.length === 2) {
    return `M ${f(points[0][0])} ${f(points[0][1])} L ${f(points[1][0])} ${f(points[1][1])}`
  }
  let d = `M ${f(points[0][0])} ${f(points[0][1])}`
  for (let i = 1; i < points.length - 1; i++) {
    const cx = points[i][0]
    const cy = points[i][1]
    const ex = (points[i][0] + points[i + 1][0]) / 2
    const ey = (points[i][1] + points[i + 1][1]) / 2
    d += ` Q ${f(cx)} ${f(cy)} ${f(ex)} ${f(ey)}`
  }
  const last = points[points.length - 1]
  d += ` L ${f(last[0])} ${f(last[1])}`
  return d
}

// Convert raw pointer-event coordinates (CSS px, top-left origin) to a
// DrawingAnnotation. Returns null if the stroke is too short to be useful.
export function strokeToDrawingAnnotation(
  cssPoints: Array<[number, number]>,
  scale: number,
  pageIdx: number,
  color: string,
  opacity: number,
  strokeWidth: number,
): DrawingAnnotation | null {
  if (cssPoints.length < 2) return null
  const pdfPoints: Array<[number, number]> = cssPoints.map(([x, y]) => [x / scale, y / scale])
  const margin = strokeWidth / 2 + 2
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [x, y] of pdfPoints) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  minX -= margin; minY -= margin
  maxX += margin; maxY += margin
  const w = maxX - minX
  const h = maxY - minY
  const local: Array<[number, number]> = pdfPoints.map(([x, y]) => [x - minX, y - minY])
  return {
    id: crypto.randomUUID(),
    type: 'drawing',
    pageIdx,
    x: minX, y: minY, w, h,
    points: local,
    color,
    opacity,
    strokeWidth,
  }
}

// Scale all stored points and the stroke width by a uniform factor — used
// when the user resizes a drawing annotation by dragging a corner handle.
export function scaleDrawing(d: DrawingAnnotation, factor: number): DrawingAnnotation {
  return {
    ...d,
    points: d.points.map(([x, y]) => [x * factor, y * factor]),
    strokeWidth: d.strokeWidth * factor,
  }
}
