// Image-upload validation for the session-only "Add image" feature.
// Both file extension and MIME type are checked — `file.type` can be empty
// or wrong on some platforms, and an extension-only check would let through
// renamed files. Belt-and-braces.

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024  // 10 MB

const ALLOWED_MIMES = new Set<string>([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
])

const ALLOWED_EXTS = new Set<string>([
  'png', 'jpg', 'jpeg', 'gif', 'webp',
])

export type AllowedImageMime = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'

export interface ImageValidationOk {
  ok: true
  mime: AllowedImageMime
}
export interface ImageValidationErr {
  ok: false
  reason: string
}

export function validateImageFile(file: File): ImageValidationOk | ImageValidationErr {
  if (file.size === 0) return { ok: false, reason: 'File is empty.' }
  if (file.size > MAX_IMAGE_BYTES) {
    const mb = (file.size / 1024 / 1024).toFixed(1)
    return { ok: false, reason: `Image is too large (${mb} MB). Max 10 MB.` }
  }
  const lower = file.name.toLowerCase()
  const dotIdx = lower.lastIndexOf('.')
  const ext = dotIdx >= 0 ? lower.slice(dotIdx + 1) : ''
  if (!ALLOWED_EXTS.has(ext)) {
    return { ok: false, reason: `Unsupported file extension (.${ext || 'unknown'}). Allowed: png, jpg, jpeg, gif, webp.` }
  }
  // Browsers sometimes report empty mime; fall back to extension-derived guess
  // but reject if `file.type` is set and contradicts.
  const mime = (file.type || mimeFromExt(ext)).toLowerCase()
  if (file.type && !ALLOWED_MIMES.has(file.type)) {
    return { ok: false, reason: `Unsupported file type (${file.type}). Allowed: PNG, JPG, GIF, WebP.` }
  }
  if (!ALLOWED_MIMES.has(mime)) {
    return { ok: false, reason: `Unsupported file type (${mime || 'unknown'}). Allowed: PNG, JPG, GIF, WebP.` }
  }
  return { ok: true, mime: mime as AllowedImageMime }
}

function mimeFromExt(ext: string): string {
  switch (ext) {
    case 'png': return 'image/png'
    case 'jpg':
    case 'jpeg': return 'image/jpeg'
    case 'gif': return 'image/gif'
    case 'webp': return 'image/webp'
    default: return ''
  }
}

// Read a File as a base64 data URL.
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error('Unexpected reader result'))
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

// Resolve the natural pixel size of an image data URL (used to pick a
// sensible default placement size).
export function probeImageDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => reject(new Error('Could not decode image'))
    img.src = dataUrl
  })
}
