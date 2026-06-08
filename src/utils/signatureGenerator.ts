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

type Rng = () => number

interface StyleProfile {
  slant: number
  weight: number
  tightness: number
  wobble: number
  simplification: number
  baselineJitter: number
}

interface GlyphContext {
  marks: SignatureStroke[]
  rng: Rng
  width: number
  wobble: number
  legibility: number
  flourish: number
}

interface GlyphBox {
  x: number
  b: number
  w: number
  h: number
}

const WIDE = new Set('mw')
const NARROW = new Set('fijlt')
const TALL = new Set('bdfhklt')
const DESC = new Set('gjpqy')
const ROUND = new Set('abcdegoq')
const TEXT_GUIDED_FONTS: Record<GeneratedSignatureStyle, string[]> = {
  flowing: ['Caveat', 'Kalam', 'Patrick Hand'],
  quick: ['Reenie Beanie', 'Just Another Hand', 'Shadows Into Light'],
  formal: ['Kalam', 'Patrick Hand', 'Architects Daughter'],
}

export function generateSignaturePlan(name: string, settings: GeneratedSignatureSettings): SignaturePlan {
  const width = settings.width ?? 500
  const height = settings.height ?? 200
  const cleaned = name.replace(/\s+/g, ' ').trim()
  if (!cleaned) return { strokes: [], width, height }

  const rng = mulberry32(hashSeed(cleaned, settings.seed))
  const style = styleProfile(settings.style)
  const legibility = clamp(0, 1, settings.legibility)
  const flourish = clamp(0, 1, settings.flourish)
  const units = signatureUnits(cleaned)
  const advance = clamp(10, 27, (width - 92) / Math.max(6, units))
  const smallH = advance * (1.18 + legibility * 0.36)
  const baseline = height * (0.61 + (rng() - 0.5) * 0.035)
  const baseWidth = style.weight + (1 - legibility) * 0.38
  const wobble = style.wobble * (0.28 + (1 - legibility) * 1.15)
  const strokes: SignatureStroke[] = []
  const marks: SignatureStroke[] = []
  let x = 34 + rng() * 8

  for (const word of cleaned.split(' ')) {
    if (!word) continue
    const wordStrokes: SignatureStroke[] = []
    let lastLetterPoints: SignaturePoint[] | null = null
    const chars = Array.from(word)
    const wordBaseline = baseline + (rng() - 0.5) * style.baselineJitter
    const wordStart = x

    for (let i = 0; i < chars.length; i++) {
      const raw = chars[i]
      const ch = normalizeLetter(raw)
      if (!ch) {
        if (raw === '-' || raw === '–') addHyphen(marks, x, wordBaseline, advance, baseWidth, rng, wobble)
        x += advance * 0.55
        continue
      }

      const initial = i === 0
      const capital = isUppercaseLetter(raw)
      const h = smallH * (capital ? 1.74 : initial ? 1.18 : 1)
      const charWidth = advance * glyphUnits(ch, capital)
      const b = wordBaseline + (rng() - 0.5) * style.baselineJitter * 0.22
      const box = { x, b, w: charWidth, h }
      const ctx: GlyphContext = { marks, rng, width: baseWidth, wobble, legibility, flourish }
      const points: SignaturePoint[] = []

      if (initial && flourish > 0.12) {
        addEntryFlourish(points, box, ctx)
      }

      const simplify = !capital && rng() < (1 - legibility) * style.simplification
      if (simplify) {
        addFastGlyph(points, box, ctx, ch)
      } else if (capital) {
        addCapitalGlyph(points, box, ctx, ch)
      } else {
        addLowercaseGlyph(points, box, ctx, ch)
      }

      if (points.length > 1) {
        wordStrokes.push({ points, width: baseWidth })
        lastLetterPoints = points
      }
      x += charWidth * style.tightness * (0.98 + (rng() - 0.5) * 0.045)
    }

    if (lastLetterPoints) {
      addExitFlourish(lastLetterPoints, x, wordBaseline, advance, smallH, ctxForMarks(marks, rng, baseWidth, wobble, legibility, flourish))
      strokes.push(...wordStrokes)
    }
    x = Math.max(x + advance * (1.05 + flourish * 0.45), wordStart + advance * 2)
  }

  return fitPlan({ strokes: [...strokes, ...marks], width, height }, style.slant)
}

export function renderSignaturePlan(canvas: HTMLCanvasElement, plan: SignaturePlan, color: string) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.strokeStyle = color
  drawSignaturePlan(ctx, plan)
}

export async function renderTextGuidedSignature(
  canvas: HTMLCanvasElement,
  name: string,
  settings: GeneratedSignatureSettings,
  color: string,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const cleaned = name.replace(/\s+/g, ' ').trim()
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  if (!cleaned) return

  const rng = mulberry32(hashSeed(cleaned, settings.seed))
  const style = styleProfile(settings.style)
  const legibility = clamp(0, 1, settings.legibility)
  const flourish = clamp(0, 1, settings.flourish)
  const fonts = TEXT_GUIDED_FONTS[settings.style]
  const font = fonts[Math.floor(rng() * fonts.length) % fonts.length]
  let size = Math.min(82, canvas.height * 0.5)

  await loadCanvasFont(font, size)
  if (!isCurrent()) return

  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.save()
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  ctx.font = `${size}px "${font}", cursive`
  while (ctx.measureText(cleaned).width > canvas.width - 44 && size > 22) {
    size -= 2
    ctx.font = `${size}px "${font}", cursive`
  }

  const measured = ctx.measureText(cleaned)
  const textWidth = measured.width
  const x = (canvas.width - textWidth) / 2
  const baseline = canvas.height * (0.58 + (rng() - 0.5) * 0.025)
  const looseness = 1 - legibility
  const shear = style.slant * 0.16 + looseness * 0.08 + (rng() - 0.5) * 0.025
  const jitterScale = 0.7 + looseness * 2.3

  ctx.translate(0, baseline)
  ctx.transform(1, 0, -shear, 1, 0, 0)
  ctx.fillStyle = color
  ctx.strokeStyle = color
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  const passes = settings.style === 'quick' ? 2 : 3
  for (let i = 0; i < passes; i++) {
    ctx.globalAlpha = i === 0 ? 0.92 : 0.28
    ctx.fillText(cleaned, x + (rng() - 0.5) * 1.4 * jitterScale, (rng() - 0.5) * 1.2 * jitterScale)
  }

  ctx.globalAlpha = 0.2 + looseness * 0.18
  ctx.lineWidth = Math.max(0.45, style.weight * 0.28)
  ctx.strokeText(cleaned, x + (rng() - 0.5) * 0.9 * jitterScale, (rng() - 0.5) * 0.8 * jitterScale)
  ctx.restore()

  if (looseness > 0.04) {
    ctx.save()
    ctx.globalAlpha = Math.min(0.26, looseness * 0.36)
    ctx.strokeStyle = color
    drawSignaturePlan(ctx, generateSignaturePlan(cleaned, {
      ...settings,
      seed: settings.seed + 97,
      legibility: Math.max(0.45, legibility),
      width: canvas.width,
      height: canvas.height,
    }))
    ctx.restore()
  }

  addInkTexture(ctx, canvas, rng, 0.035 + looseness * 0.08)

  if (flourish > 0.08) {
    ctx.save()
    ctx.strokeStyle = color
    ctx.globalAlpha = 0.82
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineWidth = Math.max(0.55, style.weight * 0.42)
    const y = baseline + size * (0.08 + flourish * 0.04)
    ctx.beginPath()
    ctx.moveTo(x + textWidth * 0.72, y)
    ctx.bezierCurveTo(
      x + textWidth * (0.84 + flourish * 0.05),
      y + size * 0.12,
      x + textWidth + size * flourish * 0.55,
      y + size * 0.06,
      x + textWidth + size * (0.28 + flourish * 0.44),
      y - size * 0.02,
    )
    ctx.stroke()
    ctx.restore()
  }
}

function drawSignaturePlan(ctx: CanvasRenderingContext2D, plan: SignaturePlan) {
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  for (const stroke of plan.strokes) {
    drawVariableStroke(ctx, stroke)
  }
}

async function loadCanvasFont(font: string, size: number): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) return
  try {
    await document.fonts.load(`${size}px "${font}"`)
  } catch {
    // Browser fallback cursive is still usable if a web font fails to load.
  }
}

function addInkTexture(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement, rng: Rng, alpha: number) {
  const sampleCount = Math.round((canvas.width * canvas.height) / 1800)
  ctx.save()
  ctx.globalCompositeOperation = 'destination-out'
  ctx.globalAlpha = alpha
  ctx.strokeStyle = '#000'
  ctx.lineWidth = 0.8
  for (let i = 0; i < sampleCount; i++) {
    const x = rng() * canvas.width
    const y = rng() * canvas.height
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + (rng() - 0.5) * 3, y + (rng() - 0.5) * 1.6)
    ctx.stroke()
  }
  ctx.restore()
}

function addLowercaseGlyph(points: SignaturePoint[], box: GlyphBox, ctx: GlyphContext, ch: string) {
  switch (ch) {
    case 'a': return addA(points, box, ctx)
    case 'b': return addB(points, box, ctx)
    case 'c': return addC(points, box, ctx)
    case 'd': return addD(points, box, ctx)
    case 'e': return addE(points, box, ctx)
    case 'f': return addF(points, box, ctx)
    case 'g': return addG(points, box, ctx)
    case 'h': return addH(points, box, ctx)
    case 'i': return addI(points, box, ctx)
    case 'j': return addJ(points, box, ctx)
    case 'k': return addK(points, box, ctx)
    case 'l': return addL(points, box, ctx)
    case 'm': return addM(points, box, ctx)
    case 'n': return addN(points, box, ctx)
    case 'o': return addO(points, box, ctx)
    case 'p': return addP(points, box, ctx)
    case 'q': return addQ(points, box, ctx)
    case 'r': return addR(points, box, ctx)
    case 's': return addS(points, box, ctx)
    case 't': return addT(points, box, ctx)
    case 'u': return addU(points, box, ctx)
    case 'v': return addV(points, box, ctx)
    case 'w': return addW(points, box, ctx)
    case 'x': return addX(points, box, ctx)
    case 'y': return addY(points, box, ctx)
    case 'z': return addZ(points, box, ctx)
    default: return addFallback(points, box, ctx)
  }
}

function addCapitalGlyph(points: SignaturePoint[], box: GlyphBox, ctx: GlyphContext, ch: string) {
  switch (ch) {
    case 'a': return addCapitalA(points, box, ctx)
    case 'b': return addCapitalB(points, box, ctx)
    case 'c': return addCapitalC(points, box, ctx)
    case 'd': return addCapitalD(points, box, ctx)
    case 'e': return addCapitalE(points, box, ctx)
    case 'f': return addCapitalF(points, box, ctx)
    case 'g': return addCapitalG(points, box, ctx)
    case 'h': return addCapitalH(points, box, ctx)
    case 'i': return addCapitalI(points, box, ctx)
    case 'j': return addCapitalJ(points, box, ctx)
    case 'k': return addCapitalK(points, box, ctx)
    case 'l': return addCapitalL(points, box, ctx)
    case 'm': return addCapitalM(points, box, ctx)
    case 'n': return addCapitalN(points, box, ctx)
    case 'o': return addCapitalO(points, box, ctx)
    case 'p': return addCapitalP(points, box, ctx)
    case 'q': return addCapitalQ(points, box, ctx)
    case 'r': return addCapitalR(points, box, ctx)
    case 's': return addCapitalS(points, box, ctx)
    case 't': return addCapitalT(points, box, ctx)
    case 'u': return addCapitalU(points, box, ctx)
    case 'v': return addCapitalV(points, box, ctx)
    case 'w': return addCapitalW(points, box, ctx)
    case 'x': return addCapitalX(points, box, ctx)
    case 'y': return addCapitalY(points, box, ctx)
    case 'z': return addCapitalZ(points, box, ctx)
    default: return addLowercaseGlyph(points, box, ctx, ch)
  }
}

function addA(points: SignaturePoint[], { x, b, w, h }: GlyphBox, ctx: GlyphContext) {
  connectTo(points, x + w * 0.14, b - h * 0.2, ctx)
  cubic(points, x + w * 0.04, b - h * 0.68, x + w * 0.58, b - h * 0.78, x + w * 0.68, b - h * 0.42, 8, ctx)
  cubic(points, x + w * 0.82, b - h * 0.04, x + w * 0.15, b + h * 0.08, x + w * 0.16, b - h * 0.22, 8, ctx)
  cubic(points, x + w * 0.28, b - h * 0.56, x + w * 0.74, b - h * 0.52, x + w * 0.78, b - h * 0.15, 7, ctx)
  cubic(points, x + w * 0.86, b + h * 0.02, x + w * 0.96, b - h * 0.1, x + w, b - h * 0.18, 4, ctx)
}

function addB(points: SignaturePoint[], { x, b, w, h }: GlyphBox, ctx: GlyphContext) {
  connectTo(points, x + w * 0.18, b - h * 0.05, ctx)
  cubic(points, x + w * 0.12, b - h * 1.42, x + w * 0.58, b - h * 1.36, x + w * 0.44, b - h * 0.74, 8, ctx)
  cubic(points, x + w * 0.28, b + h * 0.05, x + w * 0.82, b - h * 0.08, x + w * 0.84, b - h * 0.46, 8, ctx)
  cubic(points, x + w * 0.9, b - h * 0.82, x + w * 0.44, b - h * 0.72, x + w * 0.56, b - h * 0.34, 6, ctx)
  cubic(points, x + w * 0.67, b - h * 0.02, x + w * 0.92, b - h * 0.04, x + w, b - h * 0.18, 4, ctx)
}

function addC(points: SignaturePoint[], { x, b, w, h }: GlyphBox, ctx: GlyphContext) {
  connectTo(points, x + w * 0.86, b - h * 0.54, ctx)
  cubic(points, x + w * 0.48, b - h * 0.86, x + w * 0.08, b - h * 0.55, x + w * 0.18, b - h * 0.2, 8, ctx)
  cubic(points, x + w * 0.26, b + h * 0.08, x + w * 0.72, b + h * 0.02, x + w, b - h * 0.18, 8, ctx)
}

function addD(points: SignaturePoint[], { x, b, w, h }: GlyphBox, ctx: GlyphContext) {
  addA(points, { x, b, w: w * 0.78, h }, ctx)
  cubic(points, x + w * 0.88, b - h * 0.06, x + w * 0.5, b - h * 1.34, x + w * 0.58, b - h * 1.38, 8, ctx)
  cubic(points, x + w * 0.8, b - h * 1.0, x + w * 0.86, b - h * 0.24, x + w, b - h * 0.18, 8, ctx)
}

function addE(points: SignaturePoint[], { x, b, w, h }: GlyphBox, ctx: GlyphContext) {
  connectTo(points, x + w * 0.1, b - h * 0.2, ctx)
  cubic(points, x + w * 0.32, b - h * 0.76, x + w * 0.88, b - h * 0.58, x + w * 0.55, b - h * 0.33, 8, ctx)
  cubic(points, x + w * 0.26, b - h * 0.18, x + w * 0.58, b + h * 0.06, x + w, b - h * 0.18, 8, ctx)
}

function addF(points: SignaturePoint[], box: GlyphBox, ctx: GlyphContext) {
  const { x, b, w, h } = box
  connectTo(points, x + w * 0.6, b - h * 1.2, ctx)
  cubic(points, x + w * 0.18, b - h * 1.38, x + w * 0.26, b - h * 0.38, x + w * 0.4, b + h * 0.44, 12, ctx)
  cubic(points, x + w * 0.54, b + h * 0.9, x + w * 0.82, b + h * 0.18, x + w, b - h * 0.18, 10, ctx)
  addCrossbar(ctx.marks, x + w * 0.08, b - h * 0.55, w * 0.95, ctx.width, ctx.rng, ctx.wobble)
}

function addG(points: SignaturePoint[], { x, b, w, h }: GlyphBox, ctx: GlyphContext) {
  connectTo(points, x + w * 0.8, b - h * 0.5, ctx)
  cubic(points, x + w * 0.42, b - h * 0.78, x + w * 0.08, b - h * 0.45, x + w * 0.22, b - h * 0.12, 8, ctx)
  cubic(points, x + w * 0.42, b + h * 0.12, x + w * 0.78, b - h * 0.04, x + w * 0.64, b - h * 0.45, 8, ctx)
  cubic(points, x + w * 0.72, b + h * 0.62, x + w * 0.16, b + h * 0.74, x + w * 0.36, b + h * 0.2, 10, ctx)
  cubic(points, x + w * 0.48, b - h * 0.02, x + w * 0.88, b - h * 0.02, x + w, b - h * 0.18, 6, ctx)
}

function addH(points: SignaturePoint[], { x, b, w, h }: GlyphBox, ctx: GlyphContext) {
  connectTo(points, x + w * 0.15, b - h * 0.04, ctx)
  cubic(points, x + w * 0.08, b - h * 1.38, x + w * 0.58, b - h * 1.28, x + w * 0.42, b - h * 0.7, 8, ctx)
  cubic(points, x + w * 0.25, b + h * 0.08, x + w * 0.55, b - h * 0.52, x + w * 0.76, b - h * 0.48, 8, ctx)
  cubic(points, x + w * 1.02, b - h * 0.38, x + w * 0.72, b + h * 0.04, x + w, b - h * 0.18, 8, ctx)
}

function addI(points: SignaturePoint[], { x, b, w, h }: GlyphBox, ctx: GlyphContext) {
  connectTo(points, x + w * 0.18, b - h * 0.1, ctx)
  cubic(points, x + w * 0.34, b - h * 0.42, x + w * 0.56, b - h * 0.38, x + w * 0.72, b - h * 0.16, 6, ctx)
  cubic(points, x + w * 0.86, b + h * 0.02, x + w * 0.96, b - h * 0.12, x + w, b - h * 0.18, 4, ctx)
  addDot(ctx.marks, x + w * 0.46, b - h * 0.92, ctx.width, ctx.rng, ctx.wobble)
}

function addJ(points: SignaturePoint[], { x, b, w, h }: GlyphBox, ctx: GlyphContext) {
  connectTo(points, x + w * 0.3, b - h * 0.08, ctx)
  cubic(points, x + w * 0.52, b - h * 0.36, x + w * 0.64, b + h * 0.6, x + w * 0.36, b + h * 0.7, 10, ctx)
  cubic(points, x + w * 0.12, b + h * 0.68, x + w * 0.44, b + h * 0.12, x + w, b - h * 0.18, 10, ctx)
  addDot(ctx.marks, x + w * 0.48, b - h * 0.94, ctx.width, ctx.rng, ctx.wobble)
}

function addK(points: SignaturePoint[], { x, b, w, h }: GlyphBox, ctx: GlyphContext) {
  connectTo(points, x + w * 0.14, b - h * 0.04, ctx)
  cubic(points, x + w * 0.1, b - h * 1.38, x + w * 0.55, b - h * 1.18, x + w * 0.44, b - h * 0.7, 8, ctx)
  cubic(points, x + w * 0.3, b - h * 0.1, x + w * 0.62, b - h * 0.54, x + w * 0.78, b - h * 0.46, 7, ctx)
  cubic(points, x + w * 1.02, b - h * 0.34, x + w * 0.72, b + h * 0.02, x + w, b - h * 0.18, 8, ctx)
  addStrokeMark(ctx.marks, [
    { x: x + w * 0.44, y: b - h * 0.68 },
    { x: x + w * 0.98, y: b - h * 1.02 },
  ], ctx.width * 0.78, ctx.rng, ctx.wobble)
}

function addL(points: SignaturePoint[], { x, b, w, h }: GlyphBox, ctx: GlyphContext) {
  connectTo(points, x + w * 0.24, b - h * 0.06, ctx)
  cubic(points, x + w * 0.18, b - h * 1.48, x + w * 0.68, b - h * 1.38, x + w * 0.54, b - h * 0.72, 10, ctx)
  cubic(points, x + w * 0.38, b - h * 0.18, x + w * 0.68, b + h * 0.02, x + w, b - h * 0.18, 8, ctx)
}

function addM(points: SignaturePoint[], box: GlyphBox, ctx: GlyphContext) {
  addHumps(points, box, ctx, 3)
}

function addN(points: SignaturePoint[], box: GlyphBox, ctx: GlyphContext) {
  addHumps(points, box, ctx, 2)
}

function addO(points: SignaturePoint[], { x, b, w, h }: GlyphBox, ctx: GlyphContext) {
  connectTo(points, x + w * 0.78, b - h * 0.5, ctx)
  cubic(points, x + w * 0.48, b - h * 0.82, x + w * 0.12, b - h * 0.54, x + w * 0.22, b - h * 0.2, 8, ctx)
  cubic(points, x + w * 0.34, b + h * 0.12, x + w * 0.84, b + h * 0.0, x + w * 0.78, b - h * 0.48, 8, ctx)
  cubic(points, x + w * 0.88, b - h * 0.28, x + w * 0.96, b - h * 0.18, x + w, b - h * 0.18, 4, ctx)
}

function addP(points: SignaturePoint[], { x, b, w, h }: GlyphBox, ctx: GlyphContext) {
  connectTo(points, x + w * 0.2, b - h * 0.08, ctx)
  cubic(points, x + w * 0.16, b + h * 0.7, x + w * 0.42, b + h * 0.72, x + w * 0.36, b + h * 0.18, 8, ctx)
  cubic(points, x + w * 0.24, b - h * 0.52, x + w * 0.86, b - h * 0.48, x + w * 0.72, b - h * 0.18, 8, ctx)
  cubic(points, x + w * 0.64, b + h * 0.02, x + w * 0.92, b - h * 0.02, x + w, b - h * 0.18, 6, ctx)
}

function addQ(points: SignaturePoint[], box: GlyphBox, ctx: GlyphContext) {
  addO(points, box, ctx)
  const { x, b, w, h } = box
  cubic(points, x + w * 0.72, b + h * 0.4, x + w * 0.18, b + h * 0.66, x + w * 0.46, b + h * 0.18, 8, ctx)
  cubic(points, x + w * 0.58, b - h * 0.02, x + w * 0.9, b - h * 0.04, x + w, b - h * 0.18, 5, ctx)
}

function addR(points: SignaturePoint[], { x, b, w, h }: GlyphBox, ctx: GlyphContext) {
  connectTo(points, x + w * 0.14, b - h * 0.1, ctx)
  cubic(points, x + w * 0.32, b - h * 0.7, x + w * 0.68, b - h * 0.62, x + w * 0.56, b - h * 0.35, 7, ctx)
  cubic(points, x + w * 0.48, b - h * 0.16, x + w * 0.74, b - h * 0.06, x + w, b - h * 0.18, 7, ctx)
}

function addS(points: SignaturePoint[], { x, b, w, h }: GlyphBox, ctx: GlyphContext) {
  connectTo(points, x + w * 0.84, b - h * 0.6, ctx)
  cubic(points, x + w * 0.28, b - h * 0.84, x + w * 0.12, b - h * 0.42, x + w * 0.55, b - h * 0.3, 8, ctx)
  cubic(points, x + w * 1.05, b - h * 0.14, x + w * 0.56, b + h * 0.15, x + w * 0.2, b - h * 0.02, 8, ctx)
  cubic(points, x + w * 0.52, b + h * 0.02, x + w * 0.8, b - h * 0.08, x + w, b - h * 0.18, 5, ctx)
}

function addT(points: SignaturePoint[], { x, b, w, h }: GlyphBox, ctx: GlyphContext) {
  connectTo(points, x + w * 0.46, b - h * 1.08, ctx)
  cubic(points, x + w * 0.3, b - h * 0.5, x + w * 0.42, b + h * 0.02, x + w * 0.66, b - h * 0.08, 8, ctx)
  cubic(points, x + w * 0.8, b - h * 0.14, x + w * 0.88, b - h * 0.16, x + w, b - h * 0.18, 4, ctx)
  addCrossbar(ctx.marks, x + w * 0.1, b - h * 0.72, w * 0.92, ctx.width, ctx.rng, ctx.wobble)
}

function addU(points: SignaturePoint[], { x, b, w, h }: GlyphBox, ctx: GlyphContext) {
  connectTo(points, x + w * 0.12, b - h * 0.56, ctx)
  cubic(points, x + w * 0.18, b + h * 0.14, x + w * 0.56, b + h * 0.1, x + w * 0.6, b - h * 0.46, 8, ctx)
  cubic(points, x + w * 0.62, b - h * 0.08, x + w * 0.84, b + h * 0.0, x + w, b - h * 0.18, 6, ctx)
}

function addV(points: SignaturePoint[], { x, b, w, h }: GlyphBox, ctx: GlyphContext) {
  connectTo(points, x + w * 0.12, b - h * 0.62, ctx)
  cubic(points, x + w * 0.34, b + h * 0.1, x + w * 0.54, b + h * 0.1, x + w * 0.74, b - h * 0.58, 8, ctx)
  cubic(points, x + w * 0.82, b - h * 0.26, x + w * 0.92, b - h * 0.18, x + w, b - h * 0.18, 4, ctx)
}

function addW(points: SignaturePoint[], box: GlyphBox, ctx: GlyphContext) {
  const { x, b, w, h } = box
  connectTo(points, x + w * 0.08, b - h * 0.58, ctx)
  cubic(points, x + w * 0.22, b + h * 0.08, x + w * 0.34, b + h * 0.08, x + w * 0.48, b - h * 0.5, 7, ctx)
  cubic(points, x + w * 0.58, b + h * 0.1, x + w * 0.74, b + h * 0.08, x + w * 0.86, b - h * 0.56, 7, ctx)
  cubic(points, x + w * 0.9, b - h * 0.28, x + w * 0.96, b - h * 0.2, x + w, b - h * 0.18, 4, ctx)
}

function addX(points: SignaturePoint[], { x, b, w, h }: GlyphBox, ctx: GlyphContext) {
  connectTo(points, x + w * 0.1, b - h * 0.58, ctx)
  cubic(points, x + w * 0.42, b - h * 0.24, x + w * 0.68, b - h * 0.02, x + w, b - h * 0.18, 8, ctx)
  addStrokeMark(ctx.marks, [
    { x: x + w * 0.88, y: b - h * 0.64 },
    { x: x + w * 0.18, y: b + h * 0.02 },
  ], ctx.width * 0.72, ctx.rng, ctx.wobble)
}

function addY(points: SignaturePoint[], { x, b, w, h }: GlyphBox, ctx: GlyphContext) {
  connectTo(points, x + w * 0.12, b - h * 0.54, ctx)
  cubic(points, x + w * 0.24, b + h * 0.08, x + w * 0.55, b + h * 0.06, x + w * 0.68, b - h * 0.5, 8, ctx)
  cubic(points, x + w * 0.58, b + h * 0.7, x + w * 0.18, b + h * 0.72, x + w * 0.36, b + h * 0.2, 8, ctx)
  cubic(points, x + w * 0.5, b - h * 0.04, x + w * 0.88, b - h * 0.04, x + w, b - h * 0.18, 6, ctx)
}

function addZ(points: SignaturePoint[], { x, b, w, h }: GlyphBox, ctx: GlyphContext) {
  connectTo(points, x + w * 0.12, b - h * 0.62, ctx)
  cubic(points, x + w * 0.42, b - h * 0.72, x + w * 0.68, b - h * 0.65, x + w * 0.92, b - h * 0.58, 4, ctx)
  cubic(points, x + w * 0.62, b - h * 0.28, x + w * 0.34, b - h * 0.02, x + w * 0.18, b + h * 0.02, 5, ctx)
  cubic(points, x + w * 0.45, b + h * 0.04, x + w * 0.76, b - h * 0.08, x + w, b - h * 0.18, 5, ctx)
}

function addFallback(points: SignaturePoint[], box: GlyphBox, ctx: GlyphContext) {
  if (ROUND.has('a')) {
    addA(points, box, ctx)
  }
}

function addCapitalA(points: SignaturePoint[], box: GlyphBox, ctx: GlyphContext) {
  const { x, b, w, h } = box
  connectTo(points, x + w * 0.06, b + h * 0.02, ctx)
  cubic(points, x + w * 0.18, b - h * 1.1, x + w * 0.5, b - h * 1.18, x + w * 0.62, b - h * 0.42, 10, ctx)
  cubic(points, x + w * 0.72, b + h * 0.0, x + w * 0.88, b - h * 0.1, x + w, b - h * 0.18, 7, ctx)
  addCrossbar(ctx.marks, x + w * 0.25, b - h * 0.46, w * 0.54, ctx.width, ctx.rng, ctx.wobble)
}

function addCapitalB(points: SignaturePoint[], box: GlyphBox, ctx: GlyphContext) {
  const { x, b, w, h } = box
  connectTo(points, x + w * 0.2, b + h * 0.02, ctx)
  cubic(points, x + w * 0.1, b - h * 1.12, x + w * 0.2, b - h * 1.14, x + w * 0.24, b - h * 0.56, 8, ctx)
  cubic(points, x + w * 0.74, b - h * 0.92, x + w * 0.98, b - h * 0.52, x + w * 0.42, b - h * 0.47, 8, ctx)
  cubic(points, x + w * 1.06, b - h * 0.36, x + w * 0.82, b + h * 0.08, x + w * 0.26, b - h * 0.06, 10, ctx)
  cubic(points, x + w * 0.54, b + h * 0.04, x + w * 0.82, b - h * 0.08, x + w, b - h * 0.18, 5, ctx)
}

function addCapitalC(points: SignaturePoint[], box: GlyphBox, ctx: GlyphContext) {
  const { x, b, w, h } = box
  connectTo(points, x + w * 0.94, b - h * 0.84, ctx)
  cubic(points, x + w * 0.44, b - h * 1.26, x + w * 0.04, b - h * 0.72, x + w * 0.16, b - h * 0.26, 12, ctx)
  cubic(points, x + w * 0.28, b + h * 0.12, x + w * 0.76, b + h * 0.04, x + w, b - h * 0.18, 10, ctx)
}

function addCapitalD(points: SignaturePoint[], box: GlyphBox, ctx: GlyphContext) {
  const { x, b, w, h } = box
  connectTo(points, x + w * 0.18, b + h * 0.02, ctx)
  cubic(points, x + w * 0.12, b - h * 1.2, x + w * 0.18, b - h * 1.2, x + w * 0.24, b - h * 0.66, 8, ctx)
  cubic(points, x + w * 1.06, b - h * 1.08, x + w * 1.1, b - h * 0.02, x + w * 0.25, b - h * 0.06, 14, ctx)
  cubic(points, x + w * 0.52, b + h * 0.02, x + w * 0.8, b - h * 0.08, x + w, b - h * 0.18, 5, ctx)
}

function addCapitalE(points: SignaturePoint[], box: GlyphBox, ctx: GlyphContext) {
  const { x, b, w, h } = box
  connectTo(points, x + w * 0.98, b - h * 1.02, ctx)
  cubic(points, x + w * 0.42, b - h * 1.18, x + w * 0.12, b - h * 0.84, x + w * 0.3, b - h * 0.56, 9, ctx)
  cubic(points, x + w * 0.5, b - h * 0.32, x + w * 0.72, b - h * 0.5, x + w * 0.86, b - h * 0.52, 5, ctx)
  cubic(points, x + w * 0.44, b - h * 0.48, x + w * 0.16, b + h * 0.02, x + w, b - h * 0.18, 10, ctx)
}

function addCapitalF(points: SignaturePoint[], box: GlyphBox, ctx: GlyphContext) {
  const { x, b, w, h } = box
  connectTo(points, x + w * 0.94, b - h * 1.06, ctx)
  cubic(points, x + w * 0.42, b - h * 1.18, x + w * 0.22, b - h * 0.74, x + w * 0.28, b - h * 0.08, 12, ctx)
  cubic(points, x + w * 0.5, b + h * 0.02, x + w * 0.78, b - h * 0.08, x + w, b - h * 0.18, 5, ctx)
  addCrossbar(ctx.marks, x + w * 0.24, b - h * 0.55, w * 0.72, ctx.width, ctx.rng, ctx.wobble)
}

function addCapitalG(points: SignaturePoint[], box: GlyphBox, ctx: GlyphContext) {
  addCapitalC(points, box, ctx)
  const { x, b, w, h } = box
  cubic(points, x + w * 0.82, b - h * 0.5, x + w * 0.58, b - h * 0.38, x + w * 0.84, b - h * 0.34, 6, ctx)
}

function addCapitalH(points: SignaturePoint[], box: GlyphBox, ctx: GlyphContext) {
  const { x, b, w, h } = box
  connectTo(points, x + w * 0.18, b + h * 0.02, ctx)
  cubic(points, x + w * 0.14, b - h * 1.08, x + w * 0.24, b - h * 1.18, x + w * 0.28, b - h * 0.5, 9, ctx)
  cubic(points, x + w * 0.48, b - h * 0.78, x + w * 0.74, b - h * 0.78, x + w * 0.92, b - h * 1.08, 8, ctx)
  cubic(points, x + w * 0.82, b - h * 0.52, x + w * 0.82, b + h * 0.02, x + w, b - h * 0.18, 9, ctx)
}

function addCapitalI(points: SignaturePoint[], box: GlyphBox, ctx: GlyphContext) {
  const { x, b, w, h } = box
  addStrokeMark(ctx.marks, [
    { x: x + w * 0.22, y: b - h * 1.02 },
    { x: x + w * 0.86, y: b - h * 1.02 },
  ], ctx.width * 0.82, ctx.rng, ctx.wobble)
  connectTo(points, x + w * 0.56, b - h * 1.06, ctx)
  cubic(points, x + w * 0.52, b - h * 0.56, x + w * 0.48, b + h * 0.02, x + w, b - h * 0.18, 10, ctx)
}

function addCapitalJ(points: SignaturePoint[], box: GlyphBox, ctx: GlyphContext) {
  const { x, b, w, h } = box
  connectTo(points, x + w * 0.84, b - h * 1.02, ctx)
  cubic(points, x + w * 0.58, b - h * 0.74, x + w * 0.68, b + h * 0.1, x + w * 0.36, b + h * 0.12, 12, ctx)
  cubic(points, x + w * 0.1, b + h * 0.08, x + w * 0.34, b - h * 0.26, x + w, b - h * 0.18, 10, ctx)
}

function addCapitalK(points: SignaturePoint[], box: GlyphBox, ctx: GlyphContext) {
  const { x, b, w, h } = box
  connectTo(points, x + w * 0.22, b + h * 0.02, ctx)
  cubic(points, x + w * 0.1, b - h * 1.12, x + w * 0.28, b - h * 1.16, x + w * 0.32, b - h * 0.5, 10, ctx)
  cubic(points, x + w * 0.58, b - h * 0.72, x + w * 0.8, b - h * 0.98, x + w * 0.94, b - h * 1.02, 6, ctx)
  connectTo(points, x + w * 0.48, b - h * 0.55, ctx)
  cubic(points, x + w * 0.7, b - h * 0.28, x + w * 0.86, b - h * 0.06, x + w, b - h * 0.18, 8, ctx)
}

function addCapitalL(points: SignaturePoint[], box: GlyphBox, ctx: GlyphContext) {
  const { x, b, w, h } = box
  connectTo(points, x + w * 0.32, b - h * 1.08, ctx)
  cubic(points, x + w * 0.06, b - h * 0.62, x + w * 0.12, b + h * 0.04, x + w * 0.64, b - h * 0.08, 12, ctx)
  cubic(points, x + w * 0.82, b - h * 0.12, x + w * 0.94, b - h * 0.16, x + w, b - h * 0.18, 4, ctx)
}

function addCapitalM(points: SignaturePoint[], box: GlyphBox, ctx: GlyphContext) {
  const { x, b, w, h } = box
  connectTo(points, x + w * 0.08, b + h * 0.02, ctx)
  cubic(points, x + w * 0.12, b - h * 1.0, x + w * 0.24, b - h * 1.08, x + w * 0.36, b - h * 0.28, 8, ctx)
  cubic(points, x + w * 0.46, b - h * 1.02, x + w * 0.6, b - h * 1.02, x + w * 0.7, b - h * 0.28, 8, ctx)
  cubic(points, x + w * 0.78, b - h * 0.98, x + w * 0.88, b - h * 0.88, x + w, b - h * 0.18, 8, ctx)
}

function addCapitalN(points: SignaturePoint[], box: GlyphBox, ctx: GlyphContext) {
  const { x, b, w, h } = box
  connectTo(points, x + w * 0.1, b + h * 0.02, ctx)
  cubic(points, x + w * 0.12, b - h * 1.0, x + w * 0.3, b - h * 1.0, x + w * 0.46, b - h * 0.32, 8, ctx)
  cubic(points, x + w * 0.58, b - h * 1.0, x + w * 0.84, b - h * 0.94, x + w, b - h * 0.18, 10, ctx)
}

function addCapitalO(points: SignaturePoint[], box: GlyphBox, ctx: GlyphContext) {
  const { x, b, w, h } = box
  connectTo(points, x + w * 0.82, b - h * 0.86, ctx)
  cubic(points, x + w * 0.44, b - h * 1.22, x + w * 0.08, b - h * 0.72, x + w * 0.18, b - h * 0.28, 12, ctx)
  cubic(points, x + w * 0.3, b + h * 0.16, x + w * 0.96, b + h * 0.02, x + w * 0.82, b - h * 0.86, 12, ctx)
  cubic(points, x + w * 0.9, b - h * 0.38, x + w * 0.96, b - h * 0.18, x + w, b - h * 0.18, 4, ctx)
}

function addCapitalP(points: SignaturePoint[], box: GlyphBox, ctx: GlyphContext) {
  const { x, b, w, h } = box
  connectTo(points, x + w * 0.22, b + h * 0.02, ctx)
  cubic(points, x + w * 0.12, b - h * 1.12, x + w * 0.26, b - h * 1.12, x + w * 0.3, b - h * 0.58, 9, ctx)
  cubic(points, x + w * 0.94, b - h * 0.98, x + w * 1.04, b - h * 0.42, x + w * 0.36, b - h * 0.42, 10, ctx)
  cubic(points, x + w * 0.62, b - h * 0.32, x + w * 0.82, b - h * 0.16, x + w, b - h * 0.18, 5, ctx)
}

function addCapitalQ(points: SignaturePoint[], box: GlyphBox, ctx: GlyphContext) {
  addCapitalO(points, box, ctx)
  const { x, b, w, h } = box
  addStrokeMark(ctx.marks, [
    { x: x + w * 0.55, y: b - h * 0.24 },
    { x: x + w * 0.98, y: b + h * 0.08 },
  ], ctx.width * 0.82, ctx.rng, ctx.wobble)
}

function addCapitalR(points: SignaturePoint[], box: GlyphBox, ctx: GlyphContext) {
  const { x, b, w, h } = box
  addCapitalP(points, box, ctx)
  cubic(points, x + w * 0.55, b - h * 0.38, x + w * 0.76, b - h * 0.02, x + w, b - h * 0.18, 8, ctx)
}

function addCapitalS(points: SignaturePoint[], box: GlyphBox, ctx: GlyphContext) {
  const { x, b, w, h } = box
  connectTo(points, x + w * 0.86, b - h * 0.98, ctx)
  cubic(points, x + w * 0.2, b - h * 1.16, x + w * 0.12, b - h * 0.56, x + w * 0.58, b - h * 0.46, 11, ctx)
  cubic(points, x + w * 1.08, b - h * 0.34, x + w * 0.66, b + h * 0.18, x + w * 0.16, b - h * 0.04, 11, ctx)
  cubic(points, x + w * 0.42, b + h * 0.04, x + w * 0.78, b - h * 0.12, x + w, b - h * 0.18, 6, ctx)
}

function addCapitalT(points: SignaturePoint[], box: GlyphBox, ctx: GlyphContext) {
  const { x, b, w, h } = box
  connectTo(points, x + w * 0.02, b - h * 0.92, ctx)
  cubic(points, x + w * 0.34, b - h * 1.16, x + w * 0.82, b - h * 1.08, x + w * 1.04, b - h * 0.94, 9, ctx)
  cubic(points, x + w * 0.78, b - h * 1.02, x + w * 0.52, b - h * 1.0, x + w * 0.52, b - h * 0.72, 5, ctx)
  cubic(points, x + w * 0.46, b - h * 0.26, x + w * 0.58, b + h * 0.02, x + w, b - h * 0.18, 10, ctx)
}

function addCapitalU(points: SignaturePoint[], box: GlyphBox, ctx: GlyphContext) {
  const { x, b, w, h } = box
  connectTo(points, x + w * 0.14, b - h * 0.96, ctx)
  cubic(points, x + w * 0.18, b + h * 0.16, x + w * 0.72, b + h * 0.16, x + w * 0.8, b - h * 0.96, 12, ctx)
  cubic(points, x + w * 0.82, b - h * 0.36, x + w * 0.88, b - h * 0.12, x + w, b - h * 0.18, 7, ctx)
}

function addCapitalV(points: SignaturePoint[], box: GlyphBox, ctx: GlyphContext) {
  const { x, b, w, h } = box
  connectTo(points, x + w * 0.12, b - h * 1.0, ctx)
  cubic(points, x + w * 0.32, b + h * 0.16, x + w * 0.5, b + h * 0.16, x + w * 0.82, b - h * 0.96, 12, ctx)
  cubic(points, x + w * 0.84, b - h * 0.36, x + w * 0.92, b - h * 0.16, x + w, b - h * 0.18, 5, ctx)
}

function addCapitalW(points: SignaturePoint[], box: GlyphBox, ctx: GlyphContext) {
  const { x, b, w, h } = box
  connectTo(points, x + w * 0.08, b - h * 0.98, ctx)
  cubic(points, x + w * 0.2, b + h * 0.12, x + w * 0.34, b + h * 0.12, x + w * 0.46, b - h * 0.92, 8, ctx)
  cubic(points, x + w * 0.56, b + h * 0.12, x + w * 0.72, b + h * 0.12, x + w * 0.9, b - h * 0.98, 8, ctx)
  cubic(points, x + w * 0.92, b - h * 0.36, x + w * 0.96, b - h * 0.18, x + w, b - h * 0.18, 5, ctx)
}

function addCapitalX(points: SignaturePoint[], box: GlyphBox, ctx: GlyphContext) {
  const { x, b, w, h } = box
  connectTo(points, x + w * 0.12, b - h * 0.98, ctx)
  cubic(points, x + w * 0.42, b - h * 0.52, x + w * 0.72, b - h * 0.14, x + w, b - h * 0.18, 10, ctx)
  addStrokeMark(ctx.marks, [
    { x: x + w * 0.9, y: b - h * 1.02 },
    { x: x + w * 0.18, y: b + h * 0.02 },
  ], ctx.width * 0.78, ctx.rng, ctx.wobble)
}

function addCapitalY(points: SignaturePoint[], box: GlyphBox, ctx: GlyphContext) {
  const { x, b, w, h } = box
  connectTo(points, x + w * 0.12, b - h * 0.98, ctx)
  cubic(points, x + w * 0.32, b - h * 0.4, x + w * 0.52, b - h * 0.4, x + w * 0.82, b - h * 0.98, 8, ctx)
  cubic(points, x + w * 0.64, b - h * 0.5, x + w * 0.42, b + h * 0.08, x + w * 0.18, b + h * 0.08, 9, ctx)
  cubic(points, x + w * 0.42, b + h * 0.04, x + w * 0.8, b - h * 0.08, x + w, b - h * 0.18, 6, ctx)
}

function addCapitalZ(points: SignaturePoint[], box: GlyphBox, ctx: GlyphContext) {
  addZ(points, box, ctx)
}

function addHumps(points: SignaturePoint[], { x, b, w, h }: GlyphBox, ctx: GlyphContext, count: number) {
  connectTo(points, x + w * 0.08, b - h * 0.08, ctx)
  for (let i = 0; i < count; i++) {
    const sx = x + (w / count) * i
    const ex = x + (w / count) * (i + 1)
    cubic(points, sx + (ex - sx) * 0.18, b + h * 0.08, sx + (ex - sx) * 0.34, b - h * 0.72, sx + (ex - sx) * 0.52, b - h * 0.58, 5, ctx)
    cubic(points, sx + (ex - sx) * 0.78, b - h * 0.34, ex - w * 0.02, b + h * 0.02, ex, b - h * 0.18, 5, ctx)
  }
}

function addFastGlyph(points: SignaturePoint[], box: GlyphBox, ctx: GlyphContext, ch: string) {
  const { x, b, w, h } = box
  if (TALL.has(ch)) {
    connectTo(points, x + w * 0.14, b - h * 0.04, ctx)
    cubic(points, x + w * 0.16, b - h * 1.04, x + w * 0.5, b - h * 0.78, x + w, b - h * 0.18, 8, ctx)
    return
  }
  if (DESC.has(ch)) {
    connectTo(points, x + w * 0.12, b - h * 0.32, ctx)
    cubic(points, x + w * 0.66, b + h * 0.76, x + w * 0.22, b + h * 0.54, x + w, b - h * 0.18, 9, ctx)
    return
  }
  if (ROUND.has(ch)) {
    addO(points, box, ctx)
    return
  }
  connectTo(points, x + w * 0.08, b - h * 0.26, ctx)
  cubic(points, x + w * 0.34, b - h * 0.55, x + w * 0.62, b + h * 0.02, x + w, b - h * 0.18, 7, ctx)
}

function addEntryFlourish(points: SignaturePoint[], { x, b, w, h }: GlyphBox, ctx: GlyphContext) {
  const len = w * (0.28 + ctx.flourish * 0.55)
  push(points, x - len, b + h * 0.05, ctx)
  cubic(points, x - len * 0.52, b - h * 0.16, x - len * 0.14, b - h * 0.08, x + w * 0.06, b - h * 0.12, 7, ctx)
}

function addExitFlourish(points: SignaturePoint[], x: number, b: number, advance: number, h: number, ctx: GlyphContext) {
  if (ctx.flourish < 0.08) return
  const last = points[points.length - 1]
  if (!last) return
  const len = advance * (0.95 + ctx.flourish * 2.3)
  cubic(points, last.x + len * 0.28, last.y + h * 0.14, x + len * 0.58, b + h * (0.14 + ctx.flourish * 0.06), x + len, b - h * (0.05 + ctx.rng() * 0.1), 14, ctx)
}

function addHyphen(strokes: SignatureStroke[], x: number, b: number, advance: number, width: number, rng: Rng, wobble: number) {
  addStrokeMark(strokes, [
    { x: x + advance * 0.1, y: b - advance * 0.68 },
    { x: x + advance * 0.62, y: b - advance * 0.72 },
  ], width * 0.75, rng, wobble)
}

function addCrossbar(strokes: SignatureStroke[], x: number, y: number, w: number, width: number, rng: Rng, wobble: number) {
  addStrokeMark(strokes, [
    { x, y },
    { x: x + w, y: y + (rng() - 0.5) * 2.4 },
  ], width * 0.78, rng, wobble)
}

function addDot(strokes: SignatureStroke[], x: number, y: number, width: number, rng: Rng, wobble: number) {
  const r = width * (0.82 + rng() * 0.25)
  addStrokeMark(strokes, [
    { x: x - r * 0.12, y },
    { x: x + r * 0.12, y: y + (rng() - 0.5) * wobble },
  ], r, rng, wobble)
}

function addStrokeMark(strokes: SignatureStroke[], points: SignaturePoint[], width: number, rng: Rng, wobble: number) {
  strokes.push({
    points: points.map((p) => ({
      x: p.x + (rng() - 0.5) * wobble,
      y: p.y + (rng() - 0.5) * wobble,
    })),
    width,
  })
}

function connectTo(points: SignaturePoint[], x: number, y: number, ctx: GlyphContext) {
  const last = points[points.length - 1]
  if (!last) {
    push(points, x, y, ctx)
    return
  }
  const dx = x - last.x
  cubic(points, last.x + dx * 0.34, last.y + (y - last.y) * 0.12, x - dx * 0.25, y + (last.y - y) * 0.08, x, y, 4, ctx)
}

function cubic(points: SignaturePoint[], c1x: number, c1y: number, c2x: number, c2y: number, ex: number, ey: number, steps: number, ctx: GlyphContext) {
  const start = points[points.length - 1]
  if (!start) return
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const mt = 1 - t
    push(points,
      mt ** 3 * start.x + 3 * mt ** 2 * t * c1x + 3 * mt * t ** 2 * c2x + t ** 3 * ex,
      mt ** 3 * start.y + 3 * mt ** 2 * t * c1y + 3 * mt * t ** 2 * c2y + t ** 3 * ey,
      ctx,
    )
  }
}

function push(points: SignaturePoint[], x: number, y: number, ctx: GlyphContext) {
  const jitter = (ctx.rng() - 0.5) * ctx.wobble
  points.push({ x: x + jitter, y: y + jitter * 0.55 })
}

function fitPlan(plan: SignaturePlan, slant: number): SignaturePlan {
  const all = plan.strokes.flatMap((s) => s.points)
  const baseline = plan.height * 0.6
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
    const pressure = 0.86 + Math.sin(t * Math.PI * 3.2 + stroke.width) * 0.12
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

function ctxForMarks(marks: SignatureStroke[], rng: Rng, width: number, wobble: number, legibility: number, flourish: number): GlyphContext {
  return { marks, rng, width, wobble, legibility, flourish }
}

function glyphUnits(ch: string, capital: boolean): number {
  if (capital) {
    if (ch === 'm' || ch === 'w') return 1.9
    if (ch === 'i' || ch === 'j' || ch === 'l') return 1.05
    return 1.38
  }
  if (WIDE.has(ch)) return 1.38
  if (NARROW.has(ch)) return 0.66
  if (ch === 'r' || ch === 's' || ch === 'v' || ch === 'x' || ch === 'z') return 0.84
  return 1
}

function signatureUnits(text: string): number {
  let units = 0
  for (const raw of Array.from(text)) {
    const ch = normalizeLetter(raw)
    if (!ch) {
      units += raw === ' ' ? 0.9 : 0.55
      continue
    }
    units += glyphUnits(ch, isUppercaseLetter(raw))
  }
  return units
}

function normalizeLetter(char: string): string {
  const normalized = char.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  return /^[a-z]$/.test(normalized) ? normalized : ''
}

function isUppercaseLetter(char: string): boolean {
  const normalized = char.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  return /^[A-Z]$/.test(normalized)
}

function styleProfile(style: GeneratedSignatureStyle): StyleProfile {
  switch (style) {
    case 'quick': return { slant: 0.1, weight: 2.35, tightness: 0.82, wobble: 2.3, simplification: 0.72, baselineJitter: 8 }
    case 'formal': return { slant: 0.16, weight: 1.9, tightness: 1, wobble: 1.1, simplification: 0.18, baselineJitter: 3 }
    case 'flowing': return { slant: 0.22, weight: 2.08, tightness: 0.92, wobble: 1.55, simplification: 0.38, baselineJitter: 5 }
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
