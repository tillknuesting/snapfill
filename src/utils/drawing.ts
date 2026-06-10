import type { DrawingAnnotation, DrawingShape, DrawingTool } from '@/types'

type Point = [number, number]

// Build an SVG path d-string from a sequence of points using quadratic Bezier
// smoothing through midpoints. The result looks like real ink rather than a
// jagged polyline.
export function pointsToSmoothPath(points: Point[]): string {
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

export function drawingToSvgPath(drawing: Pick<DrawingAnnotation, 'points' | 'shape'>): string {
  return pointsToShapePath(drawing.points, drawing.shape ?? 'freehand')
}

export function previewStrokePath(points: Point[], tool: DrawingTool): string {
  if (points.length === 0 || tool === 'eraser') return ''
  if (tool === 'line' || tool === 'arrow') {
    return pointsToShapePath([points[0], points[points.length - 1]], tool)
  }
  return pointsToSmoothPath(smoothStrokePoints(points))
}

function pointsToShapePath(points: Point[], shape: DrawingShape): string {
  if (points.length === 0) return ''
  const f = (n: number) => n.toFixed(2)
  if (shape === 'line' && points.length >= 2) {
    const [start, end] = [points[0], points[points.length - 1]]
    return `M ${f(start[0])} ${f(start[1])} L ${f(end[0])} ${f(end[1])}`
  }
  if (shape === 'arrow' && points.length >= 2) {
    const [start, end] = [points[0], points[points.length - 1]]
    const [headA, headB] = arrowHeadPoints(start, end)
    return [
      `M ${f(start[0])} ${f(start[1])} L ${f(end[0])} ${f(end[1])}`,
      `M ${f(headA[0])} ${f(headA[1])} L ${f(end[0])} ${f(end[1])} L ${f(headB[0])} ${f(headB[1])}`,
    ].join(' ')
  }
  if (shape === 'rectangle' && points.length >= 2) {
    const box = bounds(points)
    return [
      `M ${f(box.minX)} ${f(box.minY)}`,
      `L ${f(box.maxX)} ${f(box.minY)}`,
      `L ${f(box.maxX)} ${f(box.maxY)}`,
      `L ${f(box.minX)} ${f(box.maxY)}`,
      'Z',
    ].join(' ')
  }
  if (shape === 'ellipse' && points.length >= 2) {
    const box = bounds(points)
    const cx = (box.minX + box.maxX) / 2
    const cy = (box.minY + box.maxY) / 2
    const rx = Math.max(0.01, (box.maxX - box.minX) / 2)
    const ry = Math.max(0.01, (box.maxY - box.minY) / 2)
    const k = 0.552284749831
    return [
      `M ${f(cx + rx)} ${f(cy)}`,
      `C ${f(cx + rx)} ${f(cy + ry * k)} ${f(cx + rx * k)} ${f(cy + ry)} ${f(cx)} ${f(cy + ry)}`,
      `C ${f(cx - rx * k)} ${f(cy + ry)} ${f(cx - rx)} ${f(cy + ry * k)} ${f(cx - rx)} ${f(cy)}`,
      `C ${f(cx - rx)} ${f(cy - ry * k)} ${f(cx - rx * k)} ${f(cy - ry)} ${f(cx)} ${f(cy - ry)}`,
      `C ${f(cx + rx * k)} ${f(cy - ry)} ${f(cx + rx)} ${f(cy - ry * k)} ${f(cx + rx)} ${f(cy)}`,
      'Z',
    ].join(' ')
  }
  if (shape === 'check' && points.length >= 3) {
    return `M ${f(points[0][0])} ${f(points[0][1])} L ${f(points[1][0])} ${f(points[1][1])} L ${f(points[2][0])} ${f(points[2][1])}`
  }
  return pointsToSmoothPath(points)
}

// Convert raw pointer-event coordinates (CSS px, top-left origin) to a
// DrawingAnnotation. Returns null if the stroke is too short to be useful.
export function strokeToDrawingAnnotation(
  cssPoints: Point[],
  scale: number,
  pageIdx: number,
  color: string,
  opacity: number,
  strokeWidth: number,
  tool: DrawingTool = 'pen',
): DrawingAnnotation | null {
  if (cssPoints.length < 2 || tool === 'eraser') return null
  const pdfPoints: Point[] = cssPoints.map(([x, y]) => [x / scale, y / scale])
  const prepared = prepareDrawingPoints(pdfPoints, tool)
  if (prepared.points.length < 2) return null
  const margin = strokeWidth / 2 + 2 + (prepared.shape === 'arrow' ? arrowHeadLength(prepared.points[0], prepared.points[prepared.points.length - 1]) : 0)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [x, y] of prepared.points) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  minX -= margin; minY -= margin
  maxX += margin; maxY += margin
  const w = maxX - minX
  const h = maxY - minY
  const local: Point[] = prepared.points.map(([x, y]) => [x - minX, y - minY])
  return {
    id: crypto.randomUUID(),
    type: 'drawing',
    pageIdx,
    x: minX, y: minY, w, h,
    points: local,
    shape: prepared.shape === 'freehand' ? undefined : prepared.shape,
    color,
    opacity,
    strokeWidth,
  }
}

export function findTopmostDrawingAtPoint(drawings: DrawingAnnotation[], point: { x: number; y: number }): DrawingAnnotation | null {
  for (let i = drawings.length - 1; i >= 0; i--) {
    if (drawingContainsPoint(drawings[i], point)) return drawings[i]
  }
  return null
}

function drawingContainsPoint(drawing: DrawingAnnotation, point: { x: number; y: number }): boolean {
  const threshold = Math.max(6, drawing.strokeWidth * 1.75)
  const local: Point = [point.x - drawing.x, point.y - drawing.y]
  if (
    local[0] < -threshold ||
    local[1] < -threshold ||
    local[0] > drawing.w + threshold ||
    local[1] > drawing.h + threshold
  ) return false
  return drawingSegments(drawing).some(([a, b]) => pointToSegmentDistance(local, a, b) <= threshold)
}

function drawingSegments(drawing: Pick<DrawingAnnotation, 'points' | 'shape'>): Array<[Point, Point]> {
  const shape = drawing.shape ?? 'freehand'
  const points = drawing.points
  if (points.length < 2) return []
  if (shape === 'rectangle') {
    const box = bounds(points)
    const corners: Point[] = [
      [box.minX, box.minY],
      [box.maxX, box.minY],
      [box.maxX, box.maxY],
      [box.minX, box.maxY],
    ]
    return segmentsFromPoints([...corners, corners[0]])
  }
  if (shape === 'ellipse') {
    const box = bounds(points)
    const cx = (box.minX + box.maxX) / 2
    const cy = (box.minY + box.maxY) / 2
    const rx = Math.max(0.01, (box.maxX - box.minX) / 2)
    const ry = Math.max(0.01, (box.maxY - box.minY) / 2)
    const ellipse = Array.from({ length: 33 }, (_, i): Point => {
      const angle = (i / 32) * Math.PI * 2
      return [cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry]
    })
    return segmentsFromPoints(ellipse)
  }
  if (shape === 'arrow') {
    const [start, end] = [points[0], points[points.length - 1]]
    const [headA, headB] = arrowHeadPoints(start, end)
    return [[start, end], [headA, end], [headB, end]]
  }
  if (shape === 'line') return [[points[0], points[points.length - 1]]]
  return segmentsFromPoints(points)
}

function prepareDrawingPoints(points: Point[], tool: DrawingTool): { points: Point[]; shape: DrawingShape } {
  const start = points[0]
  const end = points[points.length - 1]
  if (tool === 'line') return { points: [start, end], shape: 'line' }
  if (tool === 'arrow') return { points: [start, end], shape: 'arrow' }
  const smoothed = smoothStrokePoints(points)
  return assistShape(smoothed)
}

function assistShape(points: Point[]): { points: Point[]; shape: DrawingShape } {
  if (points.length < 2) return { points, shape: 'freehand' }
  const box = bounds(points)
  const width = box.maxX - box.minX
  const height = box.maxY - box.minY
  const diagonal = Math.hypot(width, height)
  const length = pathLength(points)
  const direct = distance(points[0], points[points.length - 1])
  if (diagonal < 8 || length < 8) return { points, shape: 'freehand' }

  const check = detectCheck(points, diagonal)
  if (check) return { points: check, shape: 'check' }

  if (direct / Math.max(length, 0.001) > 0.92 && direct > 14) {
    return { points: [points[0], points[points.length - 1]], shape: 'line' }
  }

  const closed = direct < Math.max(10, diagonal * 0.26)
  if (closed && width > 12 && height > 12) {
    const perimeter = 2 * (width + height)
    const perimeterRatio = length / Math.max(perimeter, 0.001)
    if (perimeterRatio > 0.65 && perimeterRatio < 1.55 && looksRectangular(points, box)) {
      return { points: [[box.minX, box.minY], [box.maxX, box.maxY]], shape: 'rectangle' }
    }
    const ellipsePerimeter = Math.PI * (3 * (width / 2 + height / 2) - Math.sqrt((3 * width / 2 + height / 2) * (width / 2 + 3 * height / 2)))
    const ellipseRatio = length / Math.max(ellipsePerimeter, 0.001)
    if (ellipseRatio > 0.55 && ellipseRatio < 1.75) {
      return { points: [[box.minX, box.minY], [box.maxX, box.maxY]], shape: 'ellipse' }
    }
  }

  return { points, shape: 'freehand' }
}

function detectCheck(points: Point[], diagonal: number): Point[] | null {
  const simplified = simplifyRdp(points, Math.max(1.5, diagonal * 0.04))
  if (simplified.length < 3 || simplified.length > 6) return null
  const start = simplified[0]
  const end = simplified[simplified.length - 1]
  let corner = simplified[1]
  for (const point of simplified.slice(1, -1)) {
    if (point[1] > corner[1]) corner = point
  }
  const box = bounds([start, corner, end])
  const width = box.maxX - box.minX
  const height = box.maxY - box.minY
  if (width < 14 || height < 8) return null
  if (start[0] > corner[0] || corner[0] > end[0]) return null
  if (corner[1] < start[1] + height * 0.25) return null
  if (corner[1] < end[1] + height * 0.25) return null
  if (end[1] > corner[1] - height * 0.2) return null
  return [start, corner, end]
}

function looksRectangular(points: Point[], box: ReturnType<typeof bounds>): boolean {
  const width = box.maxX - box.minX
  const height = box.maxY - box.minY
  const tol = Math.max(4, Math.min(width, height) * 0.18)
  let top = 0, right = 0, bottom = 0, left = 0
  for (const [x, y] of points) {
    if (Math.abs(y - box.minY) <= tol) top++
    if (Math.abs(x - box.maxX) <= tol) right++
    if (Math.abs(y - box.maxY) <= tol) bottom++
    if (Math.abs(x - box.minX) <= tol) left++
  }
  const minHits = Math.max(2, Math.floor(points.length * 0.08))
  return top >= minHits && right >= minHits && bottom >= minHits && left >= minHits
}

function smoothStrokePoints(points: Point[]): Point[] {
  if (points.length <= 3) return points
  const deduped: Point[] = [points[0]]
  for (const point of points.slice(1)) {
    if (distance(point, deduped[deduped.length - 1]) >= 0.75) deduped.push(point)
  }
  if (deduped.length <= 2) return deduped
  return deduped.map((point, index) => {
    if (index === 0 || index === deduped.length - 1) return point
    const prev = deduped[index - 1]
    const next = deduped[index + 1]
    return [
      prev[0] * 0.22 + point[0] * 0.56 + next[0] * 0.22,
      prev[1] * 0.22 + point[1] * 0.56 + next[1] * 0.22,
    ]
  })
}

function simplifyRdp(points: Point[], epsilon: number): Point[] {
  if (points.length <= 2) return points
  let maxDistance = 0
  let index = 0
  const start = points[0]
  const end = points[points.length - 1]
  for (let i = 1; i < points.length - 1; i++) {
    const d = pointToSegmentDistance(points[i], start, end)
    if (d > maxDistance) {
      maxDistance = d
      index = i
    }
  }
  if (maxDistance <= epsilon) return [start, end]
  const left = simplifyRdp(points.slice(0, index + 1), epsilon)
  const right = simplifyRdp(points.slice(index), epsilon)
  return [...left.slice(0, -1), ...right]
}

function segmentsFromPoints(points: Point[]): Array<[Point, Point]> {
  const segments: Array<[Point, Point]> = []
  for (let i = 1; i < points.length; i++) segments.push([points[i - 1], points[i]])
  return segments
}

function bounds(points: Point[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [x, y] of points) {
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  return { minX, minY, maxX, maxY }
}

function pathLength(points: Point[]): number {
  let total = 0
  for (let i = 1; i < points.length; i++) total += distance(points[i - 1], points[i])
  return total
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1])
}

function pointToSegmentDistance(point: Point, a: Point, b: Point): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const lengthSq = dx * dx + dy * dy
  if (lengthSq === 0) return distance(point, a)
  const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSq))
  return distance(point, [a[0] + dx * t, a[1] + dy * t])
}

function arrowHeadLength(start: Point, end: Point): number {
  return Math.min(22, Math.max(8, distance(start, end) * 0.18))
}

function arrowHeadPoints(start: Point, end: Point): [Point, Point] {
  const angle = Math.atan2(end[1] - start[1], end[0] - start[0])
  const length = arrowHeadLength(start, end)
  const spread = 0.55
  return [
    [end[0] - Math.cos(angle - spread) * length, end[1] - Math.sin(angle - spread) * length],
    [end[0] - Math.cos(angle + spread) * length, end[1] - Math.sin(angle + spread) * length],
  ]
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
