export interface ExtractedAccent {
  rgb: string      // 'r g b' — format used by --accent-rgb
  darkRgb: string
}

const cache = new Map<string, ExtractedAccent | null>()

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image load failed'))
    img.src = url
  })
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0))
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return [h * 60, s, l]
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r = 0; let g = 0; let b = 0
  if (h < 60)       { r = c; g = x }
  else if (h < 120) { r = x; g = c }
  else if (h < 180) { g = c; b = x }
  else if (h < 240) { g = x; b = c }
  else if (h < 300) { r = x; b = c }
  else              { r = c; b = x }
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)]
}

/**
 * Sample an album-art image and return its dominant vibrant colour as an
 * accent pair. Pixels are bucketed by hue and weighted by saturation and
 * mid-range lightness, so the result tracks the artwork's "colour way"
 * rather than its background. Returns null when the image is effectively
 * monochrome or can't be read (e.g. CORS-tainted canvas).
 */
export async function extractAccentFromImage(url: string): Promise<ExtractedAccent | null> {
  const cached = cache.get(url)
  if (cached !== undefined) return cached

  try {
    const img = await loadImage(url)
    const SIZE = 40
    const canvas = document.createElement('canvas')
    canvas.width = SIZE
    canvas.height = SIZE
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.drawImage(img, 0, 0, SIZE, SIZE)
    const { data } = ctx.getImageData(0, 0, SIZE, SIZE)

    const buckets = Array.from({ length: 36 }, () => ({ w: 0, h: 0, s: 0, l: 0 }))
    for (let i = 0; i < data.length; i += 4) {
      const [h, s, l] = rgbToHsl(data[i], data[i + 1], data[i + 2])
      if (l < 0.12 || l > 0.92 || s < 0.2) continue
      const w = s * (1 - Math.abs(l - 0.5) * 1.4)
      if (w <= 0) continue
      const bucket = buckets[Math.floor(h / 10)]
      bucket.w += w
      bucket.h += h * w
      bucket.s += s * w
      bucket.l += l * w
    }

    const best = buckets.reduce((a, b) => (b.w > a.w ? b : a))
    if (best.w < 4) {
      cache.set(url, null)
      return null
    }

    const hue = best.h / best.w
    // Pull saturation and lightness into a range that reads well as a UI accent
    const sat = Math.min(0.9, Math.max(0.55, best.s / best.w))
    const lig = Math.min(0.62, Math.max(0.52, best.l / best.w))

    const [r, g, b] = hslToRgb(hue, sat, lig)
    const [dr, dg, db] = hslToRgb(hue, sat, lig - 0.12)
    const result: ExtractedAccent = {
      rgb: `${r} ${g} ${b}`,
      darkRgb: `${dr} ${dg} ${db}`,
    }
    cache.set(url, result)
    return result
  } catch {
    cache.set(url, null)
    return null
  }
}
