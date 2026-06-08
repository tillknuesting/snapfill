export type GeneratedSignatureStyle = 'flowing' | 'quick' | 'formal'

export interface GeneratedSignatureSettings {
  seed: number
  style: GeneratedSignatureStyle
  legibility: number
  flourish: number
  width?: number
  height?: number
}

export interface SignaturePoint {
  x: number
  y: number
}

export interface SignatureStroke {
  points: SignaturePoint[]
  width: number
}

export interface SignaturePlan {
  strokes: SignatureStroke[]
  width: number
  height: number
}

const TALL = new Set('bdfhklt')
const DESC = new Set('gjpqyz')
const ROUND = new Set('aceo')
const HUMPS: Record<string, number> = { m: 3, n: 2, u: 2, w: 3 }

export function generateSignaturePlan(name: string, settings: GeneratedSignatureSettings): SignaturePlan {
  const width = settings.width ?? 500
  const height = settings.height ?? 200
  const cleaned = name.replace(/\s+/g, ' ').trim()
  if (!cleaned) return { strokes: [], width, height }

  const rng = mulberry32(hashSeed(cleaned, settings.seed))
  const style = styleProfile(settings.style)
  const legibility = clamp(settings.legibility, 0, 1)
  const flourish = clamp(settings.flourish, 0, 1)
  const chars = cleaned.replace(/\s/g, '').length
  const advance = clamp(12, 30, (width - 100) / Math.max(7, chars + cleaned.split(' ').length * 1.5))
  const baseline = height * (0.57 + (rng() - 0.5) * 0.08)
  const smallH = advance * (1.15 + legibility * 0.55)
  const baseWidth = style.weight + (1 - legibility) * 0.6
  const strokes: SignatureStroke[] = []
  const crossbars: SignatureStroke[] = []
  const dots: SignatureStroke[] = []
  let x = 36 + rng() * 10

  for (const word of cleaned.split(' ')) {
    if (!word) continue
    const points: SignaturePoint[] = []
    const wordBaseline = baseline + (rng() - 0.5) * 10
    const initialH = smallH * (1.9 + rng() * 0.45)
    const initialW = advance * (1.35 + flourish * 0.45)
    addInitial(points, x, wordBaseline, initialW, initialH, rng, flourish)
    x += initialW * 0.62

    for (let i = 1; i < word.length; i++) {
      const ch = word[i].toLowerCase()
      const y = wordBaseline + Math.sin(i * 1.4 + rng()) * 2.4
      const readable = rng() < legibility
      const charAdv = advance * (0.68 + rng() * 0.35)
      const startX = x
      if (!readable) {
        addFastMark(points, x, y, charAdv, smallH, rng)
      } else if (TALL.has(ch)) {
        addTall(points, x, y, charAdv, smallH, rng)
      } else if (DESC.has(ch)) {
        addDescender(points, x, y, charAdv, smallH, rng)
      } else if (ROUND.has(ch)) {
        addRound(points, x, y, charAdv, smallH, rng)
      } else {
        addHumps(points, x, y, charAdv, smallH, HUMPS[ch] ?? 1, rng)
      }
      if (ch === 'i' || ch === 'j') addDot(dots, startX + charAdv * 0.45, y - smallH * 0.75, baseWidth, rng)
      if (ch === 't' || ch === 'f') addCrossbar(crossbars, startX, y - smallH * 0.55, charAdv, baseWidth, rng)
      x += charAdv * (style.tightness - (1 - legibility) * 0.12)
    }

    addTerminal(points, x, wordBaseline, advance, smallH, rng, flourish)
    strokes.push({ points, width: baseWidth })
    x += advance * (1.4 + rng())
  }

  const plan = fitPlan({
    strokes: [...strokes, ...crossbars, ...dots],
    width,
    height,
  }, style.slant)
  return plan
}

export function renderSignaturePlan(canvas: HTMLCanvasElement, plan: SignaturePlan, color: string) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = color
  for (const stroke of plan.strokes) {
    drawVariableStroke(ctx, stroke)
  }
}

function addInitial(points: SignaturePoint[], x: number, b: number, w: number, h: number, rng: () => number, flourish: number) {
  push(points, x + w * 0.2, b + h * 0.08)
  cubic(points, x - w * 0.45 * flourish, b - h * 0.2, x + w * 0.02, b - h * 0.95, x + w * 0.58, b - h * 0.88, 12, rng)
  cubic(points, x + w * 1.16, b - h * 0.82, x + w * 0.82, b + h * 0.08, x + w * 0.32, b - h * 0.03, 12, rng)
  cubic(points, x - w * 0.06, b - h * 0.12, x + w * 0.6, b - h * 0.42, x + w * 1.05, b - h * 0.05, 10, rng)
}

function addTall(points: SignaturePoint[], x: number, b: number, w: number, h: number, rng: () => number) {
  cubic(points, x + w * 0.12, b - h * 0.06, x + w * 0.16, b - h * 1.25, x + w * 0.52, b - h * 1.1, 8, rng)
  cubic(points, x + w * 0.88, b - h * 0.92, x + w * 0.36, b + h * 0.14, x + w * 0.94, b - h * 0.1, 10, rng)
}

function addDescender(points: SignaturePoint[], x: number, b: number, w: number, h: number, rng: () => number) {
  cubic(points, x + w * 0.14, b - h * 0.36, x + w * 0.88, b - h * 0.44, x + w * 0.62, b + h * 0.72, 10, rng)
  cubic(points, x + w * 0.36, b + h * 1.1, x - w * 0.05, b + h * 0.46, x + w * 0.96, b - h * 0.08, 10, rng)
}

function addRound(points: SignaturePoint[], x: number, b: number, w: number, h: number, rng: () => number) {
  cubic(points, x + w * 0.08, b - h * 0.25, x + w * 0.42, b - h * 0.72, x + w * 0.76, b - h * 0.42, 7, rng)
  cubic(points, x + w * 1.02, b - h * 0.16, x + w * 0.42, b + h * 0.1, x + w * 0.98, b - h * 0.08, 8, rng)
}

function addHumps(points: SignaturePoint[], x: number, b: number, w: number, h: number, count: number, rng: () => number) {
  for (let i = 0; i < count; i++) {
    const sx = x + (w / count) * i
    const ex = x + (w / count) * (i + 1)
    cubic(points, sx + w * 0.05, b + h * 0.02, sx + (ex - sx) * 0.42, b - h * (0.65 + rng() * 0.2), ex, b - h * 0.05, 6, rng)
  }
}

function addFastMark(points: SignaturePoint[], x: number, b: number, w: number, h: number, rng: () => number) {
  const high = h * (0.25 + rng() * 0.35)
  cubic(points, x + w * 0.08, b - high, x + w * 0.34, b + h * 0.08, x + w * 0.92, b - high * 0.4, 5, rng)
}

function addTerminal(points: SignaturePoint[], x: number, b: number, advance: number, h: number, rng: () => number, flourish: number) {
  const len = advance * (1.6 + flourish * 4.8)
  cubic(points, x + advance * 0.1, b - h * 0.05, x + len * 0.42, b + h * (0.16 + flourish * 0.08), x + len, b - h * (0.04 + rng() * 0.12), 16, rng)
}

function addCrossbar(strokes: SignatureStroke[], x: number, y: number, w: number, width: number, rng: () => number) {
  const points = [
    { x: x + w * 0.02, y: y + (rng() - 0.5) * 3 },
    { x: x + w * 1.12, y: y + (rng() - 0.5) * 3 },
  ]
  strokes.push({ points, width: width * 0.82 })
}

function addDot(strokes: SignatureStroke[], x: number, y: number, width: number, rng: () => number) {
  const r = width * (0.85 + rng() * 0.35)
  strokes.push({
    points: [
      { x: x - r * 0.1, y },
      { x: x + r * 0.1, y },
    ],
    width: r,
  })
}

function cubic(points: SignaturePoint[], c1x: number, c1y: number, c2x: number, c2y: number, ex: number, ey: number, steps: number, rng: () => number) {
  const start = points[points.length - 1]
  if (!start) return
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const mt = 1 - t
    push(points,
      mt ** 3 * start.x + 3 * mt ** 2 * t * c1x + 3 * mt * t ** 2 * c2x + t ** 3 * ex,
      mt ** 3 * start.y + 3 * mt ** 2 * t * c1y + 3 * mt * t ** 2 * c2y + t ** 3 * ey,
      (rng() - 0.5) * 0.9,
    )
  }
}

function push(points: SignaturePoint[], x: number, y: number, jitter = 0) {
  points.push({ x: x + jitter, y: y + jitter * 0.55 })
}

function fitPlan(plan: SignaturePlan, slant: number): SignaturePlan {
  const all = plan.strokes.flatMap((s) => s.points)
  const baseline = plan.height * 0.57
  for (const p of all) p.x += (baseline - p.y) * slant
  const b = bounds(all)
  if (!b) return plan
  const pad = 16
  const scale = Math.min(1, (plan.width - pad * 2) / Math.max(1, b.maxX - b.minX), (plan.height - pad * 2) / Math.max(1, b.maxY - b.minY))
  const dx = (plan.width - (b.maxX - b.minX) * scale) / 2 - b.minX * scale
  const dy = (plan.height - (b.maxY - b.minY) * scale) / 2 - b.minY * scale
  for (const p of all) {
    p.x = p.x * scale + dx
    p.y = p.y * scale + dy
  }
  return plan
}

function drawVariableStroke(ctx: CanvasRenderingContext2D, stroke: SignatureStroke) {
  for (let i = 1; i < stroke.points.length; i++) {
    const a = stroke.points[i - 1]
    const b = stroke.points[i]
    const t = i / Math.max(1, stroke.points.length - 1)
    const taper = Math.min(1, t * 8, (1 - t) * 8)
    const pressure = 0.82 + Math.sin(t * Math.PI * 4.5 + stroke.width) * 0.16
    ctx.lineWidth = Math.max(0.35, stroke.width * taper * pressure)
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
  }
}

function bounds(points: SignaturePoint[]) {
  if (points.length === 0) return null
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const p of points) {
    minX = Math.min(minX, p.x)
    minY = Math.min(minY, p.y)
    maxX = Math.max(maxX, p.x)
    maxY = Math.max(maxY, p.y)
  }
  return { minX, minY, maxX, maxY }
}

function styleProfile(style: GeneratedSignatureStyle) {
  switch (style) {
    case 'quick': return { slant: 0.12, weight: 2.45, tightness: 0.78 }
    case 'formal': return { slant: 0.2, weight: 1.95, tightness: 0.98 }
    case 'flowing': return { slant: 0.27, weight: 2.15, tightness: 0.9 }
  }
}

function hashSeed(text: string, seed: number): number {
  let h = 2166136261 ^ seed
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function mulberry32(seed: number) {
  return function next() {
    let t = seed += 0x6d2b79f5
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function clamp(min: number, max: number, value: number): number {
  return Math.max(min, Math.min(max, value))
}
