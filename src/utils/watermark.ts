import type { WatermarkSettings } from '@/types'

export const DEFAULT_WATERMARK: WatermarkSettings = {
  enabled: false,
  text: 'DRAFT',
  fontSize: 72,
  opacity: 0.16,
  rotation: -35,
  color: '#0a1f3d',
}

export function normalizeWatermark(
  watermark: Partial<WatermarkSettings> | null | undefined,
): WatermarkSettings {
  const merged = { ...DEFAULT_WATERMARK, ...(watermark ?? {}) }
  return {
    enabled: !!merged.enabled,
    text: String(merged.text ?? '').slice(0, 80),
    fontSize: clampNumber(merged.fontSize, 12, 160, DEFAULT_WATERMARK.fontSize),
    opacity: clampNumber(merged.opacity, 0.05, 0.6, DEFAULT_WATERMARK.opacity),
    rotation: clampNumber(merged.rotation, -90, 90, DEFAULT_WATERMARK.rotation),
    color: /^#[0-9a-f]{6}$/i.test(merged.color) ? merged.color : DEFAULT_WATERMARK.color,
  }
}

export function watermarkIsVisible(watermark: WatermarkSettings): boolean {
  return watermark.enabled && watermark.text.trim().length > 0
}

function clampNumber(value: number, min: number, max: number, fallback: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}
