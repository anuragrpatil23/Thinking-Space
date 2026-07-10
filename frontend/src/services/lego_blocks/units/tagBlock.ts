export function normalizeTagBlock(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

const TAG_COLOR_PALETTE_BLOCK = [
  {
    solid: 'border-emerald-200/80 bg-emerald-100/75 text-emerald-800 dark:border-transparent dark:bg-[hsl(158_26%_31%)] dark:text-[hsl(158_62%_80%)]',
    subtle: 'border-emerald-200/70 bg-emerald-50/70 text-emerald-800/80 dark:border-transparent dark:bg-[hsl(158_26%_27%)] dark:text-[hsl(158_62%_78%)]',
    selected: 'border-emerald-300 bg-emerald-100/80 text-emerald-800 dark:border-transparent dark:bg-[hsl(158_26%_36%)] dark:text-[hsl(158_62%_82%)]',
    unselected: 'border-emerald-200/80 text-emerald-700/70 dark:border-[hsl(158_20%_40%)] dark:text-[hsl(158_62%_66%)] hover:bg-emerald-50/60 dark:hover:bg-[hsl(158_24%_22%)]',
  },
  {
    solid: 'border-sky-200/80 bg-sky-100/75 text-sky-800 dark:border-transparent dark:bg-[hsl(199_26%_31%)] dark:text-[hsl(199_62%_80%)]',
    subtle: 'border-sky-200/70 bg-sky-50/70 text-sky-800/80 dark:border-transparent dark:bg-[hsl(199_26%_27%)] dark:text-[hsl(199_62%_78%)]',
    selected: 'border-sky-300 bg-sky-100/80 text-sky-800 dark:border-transparent dark:bg-[hsl(199_26%_36%)] dark:text-[hsl(199_62%_82%)]',
    unselected: 'border-sky-200/80 text-sky-700/70 dark:border-[hsl(199_20%_40%)] dark:text-[hsl(199_62%_66%)] hover:bg-sky-50/60 dark:hover:bg-[hsl(199_24%_22%)]',
  },
  {
    solid: 'border-amber-200/80 bg-amber-100/75 text-amber-800 dark:border-transparent dark:bg-[hsl(40_30%_31%)] dark:text-[hsl(43_74%_80%)]',
    subtle: 'border-amber-200/70 bg-amber-50/70 text-amber-800/80 dark:border-transparent dark:bg-[hsl(40_30%_27%)] dark:text-[hsl(43_74%_78%)]',
    selected: 'border-amber-300 bg-amber-100/80 text-amber-800 dark:border-transparent dark:bg-[hsl(40_30%_36%)] dark:text-[hsl(43_74%_82%)]',
    unselected: 'border-amber-200/80 text-amber-700/70 dark:border-[hsl(40_20%_40%)] dark:text-[hsl(43_74%_66%)] hover:bg-amber-50/60 dark:hover:bg-[hsl(40_24%_22%)]',
  },
  {
    solid: 'border-rose-200/80 bg-rose-100/75 text-rose-800 dark:border-transparent dark:bg-[hsl(345_26%_31%)] dark:text-[hsl(345_62%_80%)]',
    subtle: 'border-rose-200/70 bg-rose-50/70 text-rose-800/80 dark:border-transparent dark:bg-[hsl(345_26%_27%)] dark:text-[hsl(345_62%_78%)]',
    selected: 'border-rose-300 bg-rose-100/80 text-rose-800 dark:border-transparent dark:bg-[hsl(345_26%_36%)] dark:text-[hsl(345_62%_82%)]',
    unselected: 'border-rose-200/80 text-rose-700/70 dark:border-[hsl(345_20%_40%)] dark:text-[hsl(345_62%_66%)] hover:bg-rose-50/60 dark:hover:bg-[hsl(345_24%_22%)]',
  },
  {
    solid: 'border-violet-200/80 bg-violet-100/75 text-violet-800 dark:border-transparent dark:bg-[hsl(262_26%_31%)] dark:text-[hsl(262_62%_80%)]',
    subtle: 'border-violet-200/70 bg-violet-50/70 text-violet-800/80 dark:border-transparent dark:bg-[hsl(262_26%_27%)] dark:text-[hsl(262_62%_78%)]',
    selected: 'border-violet-300 bg-violet-100/80 text-violet-800 dark:border-transparent dark:bg-[hsl(262_26%_36%)] dark:text-[hsl(262_62%_82%)]',
    unselected: 'border-violet-200/80 text-violet-700/70 dark:border-[hsl(262_20%_40%)] dark:text-[hsl(262_62%_66%)] hover:bg-violet-50/60 dark:hover:bg-[hsl(262_24%_22%)]',
  },
  {
    solid: 'border-cyan-200/80 bg-cyan-100/75 text-cyan-800 dark:border-transparent dark:bg-[hsl(189_26%_31%)] dark:text-[hsl(189_62%_80%)]',
    subtle: 'border-cyan-200/70 bg-cyan-50/70 text-cyan-800/80 dark:border-transparent dark:bg-[hsl(189_26%_27%)] dark:text-[hsl(189_62%_78%)]',
    selected: 'border-cyan-300 bg-cyan-100/80 text-cyan-800 dark:border-transparent dark:bg-[hsl(189_26%_36%)] dark:text-[hsl(189_62%_82%)]',
    unselected: 'border-cyan-200/80 text-cyan-700/70 dark:border-[hsl(189_20%_40%)] dark:text-[hsl(189_62%_66%)] hover:bg-cyan-50/60 dark:hover:bg-[hsl(189_24%_22%)]',
  },
] as const

export type TagColorVariantBlock = 'solid' | 'subtle' | 'selected' | 'unselected'
export type TagColorPaletteEntryBlock = (typeof TAG_COLOR_PALETTE_BLOCK)[number]

// Light-mode alphas only (dark uses opaque muted tones computed in
// tagColorStyleBlock, matching CHIP_COLOR_CLASS_BLOCK's Notion/Linear look).
const TAG_COLOR_FALLBACK_BY_VARIANT: Record<
  TagColorVariantBlock,
  { bgAlpha: number; borderAlpha: number; textAlpha: number }
> = {
  solid: { bgAlpha: 0.16, borderAlpha: 0.4, textAlpha: 1 },
  subtle: { bgAlpha: 0.1, borderAlpha: 0.3, textAlpha: 0.9 },
  selected: { bgAlpha: 0.22, borderAlpha: 0.5, textAlpha: 1 },
  unselected: { bgAlpha: 0.04, borderAlpha: 0.28, textAlpha: 0.82 },
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

// Muted "colored grey" tone: pins lightness and pulls saturation down into a
// low band so even a punchy user hex lands as an opaque Notion/Linear-style
// chip fill rather than a bright slab.
function mutedToneBlock(rgb: RGB, lightness: number, satFloor = 16, satCap = 34): RGB {
  const hsl = rgbToHslBlock(rgb)
  return hslToRgbBlock({
    h: hsl.h,
    s: Math.min(satCap, Math.max(satFloor, hsl.s * 0.5)),
    l: lightness,
  })
}

// Bright same-hue accent for the label on top of the muted fill.
function accentToneBlock(rgb: RGB, lightness: number): RGB {
  const hsl = rgbToHslBlock(rgb)
  return hslToRgbBlock({
    h: hsl.h,
    s: Math.min(88, Math.max(52, hsl.s)),
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
  // Dark chip = "opaque muted mid-dark": a fully-opaque, low-saturation, dark
  // fill (a "colored grey") with a bright same-hue accent label and no border.
  // `unselected` is a filter's OFF state, so it drops the fill and shows just a
  // muted outline + dimmer text.
  const isOff = variant === 'unselected'
  const fillL = variant === 'selected' ? 36 : variant === 'subtle' ? 27 : 31
  const darkFillRgb = mutedToneBlock(rgb, fillL)
  const darkText = isOff ? accentToneBlock(rgb, 66) : accentToneBlock(rgb, 80)
  const darkBg = isOff ? 'transparent' : rgbaBlock(darkFillRgb, 1)
  const darkBorder = isOff ? rgbaBlock(mutedToneBlock(rgb, 46), 0.4) : 'transparent'
  // light-dark() resolves per-element from color-scheme, which uiThemeOrch
  // sets on the root — inline styles cannot use Tailwind dark: variants
  return {
    backgroundColor: `light-dark(${rgbaBlock(rgb, tone.bgAlpha)}, ${darkBg})`,
    borderColor: `light-dark(${rgbaBlock(rgb, tone.borderAlpha)}, ${darkBorder})`,
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
