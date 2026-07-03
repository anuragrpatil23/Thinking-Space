export function normalizeTagBlock(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

const TAG_COLOR_PALETTE_BLOCK = [
  {
    solid: 'border-emerald-200/80 dark:border-emerald-500/45 bg-emerald-100/75 dark:bg-emerald-500/25 text-emerald-800 dark:text-emerald-200',
    subtle: 'border-emerald-200/70 dark:border-emerald-500/40 bg-emerald-50/70 dark:bg-emerald-500/20 text-emerald-800/80 dark:text-emerald-200/80',
    selected: 'border-emerald-300 dark:border-emerald-500/55 bg-emerald-100/80 dark:bg-emerald-500/30 text-emerald-800 dark:text-emerald-200',
    unselected: 'border-emerald-200/80 dark:border-emerald-500/45 text-emerald-700/70 dark:text-emerald-300/70 hover:bg-emerald-50/60 dark:hover:bg-emerald-500/25',
  },
  {
    solid: 'border-sky-200/80 dark:border-sky-500/45 bg-sky-100/75 dark:bg-sky-500/25 text-sky-800 dark:text-sky-200',
    subtle: 'border-sky-200/70 dark:border-sky-500/40 bg-sky-50/70 dark:bg-sky-500/20 text-sky-800/80 dark:text-sky-200/80',
    selected: 'border-sky-300 dark:border-sky-500/55 bg-sky-100/80 dark:bg-sky-500/30 text-sky-800 dark:text-sky-200',
    unselected: 'border-sky-200/80 dark:border-sky-500/45 text-sky-700/70 dark:text-sky-300/70 hover:bg-sky-50/60 dark:hover:bg-sky-500/25',
  },
  {
    solid: 'border-amber-200/80 dark:border-amber-500/45 bg-amber-100/75 dark:bg-amber-500/25 text-amber-800 dark:text-amber-200',
    subtle: 'border-amber-200/70 dark:border-amber-500/40 bg-amber-50/70 dark:bg-amber-500/20 text-amber-800/80 dark:text-amber-200/80',
    selected: 'border-amber-300 dark:border-amber-500/55 bg-amber-100/80 dark:bg-amber-500/30 text-amber-800 dark:text-amber-200',
    unselected: 'border-amber-200/80 dark:border-amber-500/45 text-amber-700/70 dark:text-amber-300/70 hover:bg-amber-50/60 dark:hover:bg-amber-500/25',
  },
  {
    solid: 'border-rose-200/80 dark:border-rose-500/45 bg-rose-100/75 dark:bg-rose-500/25 text-rose-800 dark:text-rose-200',
    subtle: 'border-rose-200/70 dark:border-rose-500/40 bg-rose-50/70 dark:bg-rose-500/20 text-rose-800/80 dark:text-rose-200/80',
    selected: 'border-rose-300 dark:border-rose-500/55 bg-rose-100/80 dark:bg-rose-500/30 text-rose-800 dark:text-rose-200',
    unselected: 'border-rose-200/80 dark:border-rose-500/45 text-rose-700/70 dark:text-rose-300/70 hover:bg-rose-50/60 dark:hover:bg-rose-500/25',
  },
  {
    solid: 'border-violet-200/80 dark:border-violet-500/45 bg-violet-100/75 dark:bg-violet-500/25 text-violet-800 dark:text-violet-200',
    subtle: 'border-violet-200/70 dark:border-violet-500/40 bg-violet-50/70 dark:bg-violet-500/20 text-violet-800/80 dark:text-violet-200/80',
    selected: 'border-violet-300 dark:border-violet-500/55 bg-violet-100/80 dark:bg-violet-500/30 text-violet-800 dark:text-violet-200',
    unselected: 'border-violet-200/80 dark:border-violet-500/45 text-violet-700/70 dark:text-violet-300/70 hover:bg-violet-50/60 dark:hover:bg-violet-500/25',
  },
  {
    solid: 'border-cyan-200/80 dark:border-cyan-500/45 bg-cyan-100/75 dark:bg-cyan-500/25 text-cyan-800 dark:text-cyan-200',
    subtle: 'border-cyan-200/70 dark:border-cyan-500/40 bg-cyan-50/70 dark:bg-cyan-500/20 text-cyan-800/80 dark:text-cyan-200/80',
    selected: 'border-cyan-300 dark:border-cyan-500/55 bg-cyan-100/80 dark:bg-cyan-500/30 text-cyan-800 dark:text-cyan-200',
    unselected: 'border-cyan-200/80 dark:border-cyan-500/45 text-cyan-700/70 dark:text-cyan-300/70 hover:bg-cyan-50/60 dark:hover:bg-cyan-500/25',
  },
] as const

export type TagColorVariantBlock = 'solid' | 'subtle' | 'selected' | 'unselected'
export type TagColorPaletteEntryBlock = (typeof TAG_COLOR_PALETTE_BLOCK)[number]

const TAG_COLOR_FALLBACK_BY_VARIANT: Record<TagColorVariantBlock, { bgAlpha: number; borderAlpha: number; textAlpha: number }> = {
  solid: { bgAlpha: 0.2, borderAlpha: 0.46, textAlpha: 1 },
  subtle: { bgAlpha: 0.1, borderAlpha: 0.34, textAlpha: 0.9 },
  selected: { bgAlpha: 0.24, borderAlpha: 0.52, textAlpha: 1 },
  unselected: { bgAlpha: 0.04, borderAlpha: 0.3, textAlpha: 0.82 },
}

type RGB = { r: number; g: number; b: number }

function hashTagBlock(tag: string): number {
  const normalized = normalizeTagBlock(tag)
  let hash = 0
  for (let index = 0; index < normalized.length; index += 1) {
    hash = ((hash << 5) - hash) + normalized.charCodeAt(index)
    hash |= 0
  }
  return hash
}

export function tagPaletteBlock(tag: string): TagColorPaletteEntryBlock {
  const paletteIndex = Math.abs(hashTagBlock(tag)) % TAG_COLOR_PALETTE_BLOCK.length
  return TAG_COLOR_PALETTE_BLOCK[paletteIndex]
}

export function tagLookupKeyBlock(tag: string): string {
  return normalizeTagBlock(tag).toLowerCase()
}

export function normalizeHexColorBlock(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const compact = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed
  if (/^[0-9a-fA-F]{3}$/.test(compact)) {
    const [r, g, b] = compact.split('')
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase()
  }
  if (/^[0-9a-fA-F]{6}$/.test(compact)) return `#${compact}`.toLowerCase()
  return null
}

function parseHexRgbBlock(value: string): RGB {
  const compact = value.slice(1)
  const r = Number.parseInt(compact.slice(0, 2), 16)
  const g = Number.parseInt(compact.slice(2, 4), 16)
  const b = Number.parseInt(compact.slice(4, 6), 16)
  return { r, g, b }
}

function rgbaBlock(rgb: RGB, alpha: number): string {
  const clamped = Math.max(0, Math.min(1, alpha))
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${clamped})`
}

type HSL = { h: number; s: number; l: number }

function rgbToHslBlock(rgb: RGB): HSL {
  const r = rgb.r / 255
  const g = rgb.g / 255
  const b = rgb.b / 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const delta = max - min

  let h = 0
  if (delta !== 0) {
    if (max === r) h = ((g - b) / delta) % 6
    else if (max === g) h = ((b - r) / delta) + 2
    else h = ((r - g) / delta) + 4
    h *= 60
    if (h < 0) h += 360
  }

  const l = (max + min) / 2
  const s = delta === 0 ? 0 : delta / (1 - Math.abs((2 * l) - 1))
  return { h, s: s * 100, l: l * 100 }
}

function hslToRgbBlock(hsl: HSL): RGB {
  const h = ((hsl.h % 360) + 360) % 360
  const s = Math.max(0, Math.min(100, hsl.s)) / 100
  const l = Math.max(0, Math.min(100, hsl.l)) / 100
  const chroma = (1 - Math.abs((2 * l) - 1)) * s
  const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - (chroma / 2)

  let rPrime = 0
  let gPrime = 0
  let bPrime = 0

  if (h < 60) [rPrime, gPrime, bPrime] = [chroma, x, 0]
  else if (h < 120) [rPrime, gPrime, bPrime] = [x, chroma, 0]
  else if (h < 180) [rPrime, gPrime, bPrime] = [0, chroma, x]
  else if (h < 240) [rPrime, gPrime, bPrime] = [0, x, chroma]
  else if (h < 300) [rPrime, gPrime, bPrime] = [x, 0, chroma]
  else [rPrime, gPrime, bPrime] = [chroma, 0, x]

  return {
    r: Math.round((rPrime + m) * 255),
    g: Math.round((gPrime + m) * 255),
    b: Math.round((bPrime + m) * 255),
  }
}

function darkerTextColorBlock(rgb: RGB, alpha: number): string {
  const hsl = rgbToHslBlock(rgb)
  const darker = hslToRgbBlock({
    h: hsl.h,
    s: Math.min(100, hsl.s * 1.08),
    l: Math.max(12, Math.min(32, hsl.l * 0.38)),
  })
  return rgbaBlock(darker, alpha)
}

// Pins lightness so any user hex (even navy/black) stays visible on dark surfaces
function toneAtLightnessBlock(rgb: RGB, lightness: number, satBoost = 1.08): RGB {
  const hsl = rgbToHslBlock(rgb)
  return hslToRgbBlock({
    h: hsl.h,
    s: Math.min(100, Math.max(45, hsl.s * satBoost)),
    l: lightness,
  })
}

export function tagColorClassBlock(tag: string, variant: TagColorVariantBlock = 'solid'): string {
  return tagPaletteBlock(tag)[variant]
}

export function tagColorStyleBlock(
  _tag: string,
  variant: TagColorVariantBlock = 'solid',
  customHexColor?: string | null,
): Record<string, string> | undefined {
  const normalized = normalizeHexColorBlock(customHexColor)
  if (!normalized) return undefined
  const rgb = parseHexRgbBlock(normalized)
  const tone = TAG_COLOR_FALLBACK_BY_VARIANT[variant]
  const darkBase = toneAtLightnessBlock(rgb, 58)
  const darkText = toneAtLightnessBlock(rgb, 80, 1.2)
  // light-dark() resolves per-element from color-scheme, which uiThemeOrch
  // sets on the root — inline styles cannot use Tailwind dark: variants
  return {
    backgroundColor: `light-dark(${rgbaBlock(rgb, tone.bgAlpha)}, ${rgbaBlock(darkBase, Math.min(0.34, tone.bgAlpha * 1.6))})`,
    borderColor: `light-dark(${rgbaBlock(rgb, tone.borderAlpha)}, ${rgbaBlock(darkBase, Math.min(0.7, tone.borderAlpha * 1.25))})`,
    color: `light-dark(${darkerTextColorBlock(rgb, tone.textAlpha)}, ${rgbaBlock(darkText, tone.textAlpha)})`,
  }
}

export function normalizeTagListBlock(tags: string[]): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []
  for (const tag of tags) {
    const next = normalizeTagBlock(tag)
    if (!next) continue
    const dedupeKey = next.toLowerCase()
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    normalized.push(next)
  }
  return normalized
}

export function splitTagInputBlock(value: string): string[] {
  return normalizeTagListBlock(
    value
      .split(/[,\n]/)
      .map(segment => segment.trim())
      .filter(Boolean),
  )
}

export function hasTagBlock(tags: string[], tag: string): boolean {
  const lookup = normalizeTagBlock(tag).toLowerCase()
  if (!lookup) return false
  return tags.some(item => normalizeTagBlock(item).toLowerCase() === lookup)
}

export function tagsEqualBlock(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  for (let index = 0; index < a.length; index += 1) {
    if (normalizeTagBlock(a[index]).toLowerCase() !== normalizeTagBlock(b[index]).toLowerCase()) return false
  }
  return true
}
