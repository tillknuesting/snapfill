import { describe, expect, it } from 'vitest'
import {
  generateSignaturePlan,
  type GeneratedSignatureSettings,
  type SignaturePlan,
  type SignaturePoint,
} from './signatureGenerator'

const baseSettings: GeneratedSignatureSettings = {
  seed: 17,
  style: 'readable',
  legibility: 0.6,
  flourish: 0.72,
  width: 500,
  height: 200,
}

function points(plan: SignaturePlan): SignaturePoint[] {
  return plan.strokes.flatMap((stroke) => stroke.points)
}

describe('generateSignaturePlan', () => {
  it('returns an empty plan for blank names', () => {
    const plan = generateSignaturePlan('   ', baseSettings)

    expect(plan).toEqual({ strokes: [], width: 500, height: 200 })
  })

  it('is deterministic for the same name and settings', () => {
    const first = generateSignaturePlan('Tilo Knopfler', baseSettings)
    const second = generateSignaturePlan('Tilo Knopfler', baseSettings)

    expect(second).toEqual(first)
  })

  it('changes the result when shuffled with a different seed', () => {
    const first = generateSignaturePlan('Tilo Knopfler', baseSettings)
    const second = generateSignaturePlan('Tilo Knopfler', { ...baseSettings, seed: 18 })

    expect(second).not.toEqual(first)
  })

  it('changes the result between readable and formal styles', () => {
    const readable = generateSignaturePlan('Tilo Knopfler', { ...baseSettings, style: 'readable' })
    const formal = generateSignaturePlan('Tilo Knopfler', { ...baseSettings, style: 'formal' })

    expect(formal).not.toEqual(readable)
  })

  it('fits generated strokes inside the requested canvas', () => {
    const plan = generateSignaturePlan('Alexander Montgomery-Smith', {
      ...baseSettings,
      style: 'formal',
      legibility: 0.95,
      flourish: 1,
      width: 360,
      height: 120,
    })

    expect(plan.width).toBe(360)
    expect(plan.height).toBe(120)
    expect(plan.strokes.length).toBeGreaterThan(1)

    for (const point of points(plan)) {
      expect(point.x).toBeGreaterThanOrEqual(0)
      expect(point.x).toBeLessThanOrEqual(360)
      expect(point.y).toBeGreaterThanOrEqual(0)
      expect(point.y).toBeLessThanOrEqual(120)
    }
  })
})
