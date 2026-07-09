// Per-project color palette for Claude activity charts.
// Same color for the same project everywhere (chips, heatmap tint, stacked
// area, sparkline) so the eye learns the mapping over time.
//
// Two guarantees:
//  1. Fixed per project — a project prefers a color derived from a stable hash
//     of its name, not its activity rank, so it doesn't change just because it
//     got busier/quieter or the range changed.
//  2. No two active projects share a color — the visible set is registered
//     (busiest first) and assigned DISTINCT palette slots; on a hash collision
//     the busier project keeps the color and the other probes to the next free
//     slot. The palette holds 60 distinct colors, so this scales well past the
//     handful of projects most people have.
//
// Resolution order in getProjectColor: user override (Settings ▸ AI Activity) >
// noise/unknown buckets > registered slot > stable hash fallback.

import { resolveProjectColorOverrideBlock } from '@/services/lego_blocks/units/aiActivityMappingBlock'

export interface ProjectColorEntry {
  /** Primary stroke / chip text color. */
  stroke: string
  /** Filled area tint. */
  fill: string
  /** Soft chip background (for active chip). */
  chipBg: string
  /** Subtle muted dot (legend / inactive chip border). */
  dot: string
}

function paletteEntry(r: number, g: number, b: number): ProjectColorEntry {
  return {
    stroke: `rgb(${r},${g},${b})`,
    fill: `rgba(${r},${g},${b},0.45)`,
    chipBg: `rgba(${r},${g},${b},0.15)`,
    dot: `rgba(${r},${g},${b},0.6)`,
  }
}

/** HSL (all channels 0..1) → [r,g,b] 0..255. Used to synthesize the extended
 *  palette beyond the hand-picked leading colors. */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const v = Math.round(l * 255)
    return [v, v, v]
  }
  const hue2rgb = (p: number, q: number, t: number): number => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  ]
}

// Hand-picked leading colors — calm, cool tones first (sky blue at slot 0 so
// F9's forced preference lands on a recognizable blue). These keep the curated
// feel for the first several projects; the rest of the palette is generated.
const CURATED: ReadonlyArray<ProjectColorEntry> = [
  paletteEntry(56, 189, 248), // sky
  paletteEntry(52, 211, 153), // emerald
  paletteEntry(167, 139, 250), // violet
  paletteEntry(45, 212, 191), // teal
  paletteEntry(129, 140, 248), // indigo
  paletteEntry(251, 191, 36), // amber
  paletteEntry(251, 146, 60), // orange
  paletteEntry(251, 113, 133), // rose
  paletteEntry(232, 121, 249), // fuchsia
]

// Total distinct colors available. Generated slots extend the curated set using
// golden-angle hue stepping (maximizes separation between successive slots) with
// a small lightness cycle so nearby hues still read apart.
const PALETTE_SIZE = 60

const PALETTE: ReadonlyArray<ProjectColorEntry> = (() => {
  const out: ProjectColorEntry[] = [...CURATED]
  const GOLDEN_ANGLE = 137.508
  // Offset the generated hues off the curated ones so they don't near-duplicate.
  let hue = 24
  for (let i = out.length; i < PALETTE_SIZE; i += 1) {
    hue = (hue + GOLDEN_ANGLE) % 360
    const lightness = 0.6 + (i % 3) * 0.06 // 0.60 / 0.66 / 0.72
    const [r, g, b] = hslToRgb(hue / 360, 0.68, lightness)
    out.push(paletteEntry(r, g, b))
  }
  return out
})()

// Forced color preferences by project name. F9 → slot 0 (sky blue) per user
// request; still overridable in Settings. Extend here for any project that
// should own a specific color regardless of hashing.
const PREFERRED_SLOT: Record<string, number> = {
  F9: 0,
}

// Warm clay/terracotta — distinct from the grey empty-cell background so an
// unknown-project day actually shows up on the heatmap (previously it blended
// in with empty cells because both were grey).
const UNKNOWN_ENTRY: ProjectColorEntry = {
  stroke: 'rgb(217,119,87)',
  fill: 'rgba(217,119,87,0.45)',
  chipBg: 'rgba(217,119,87,0.15)',
  dot: 'rgba(217,119,87,0.6)',
}

// Dusty mauve — visible against the grey empty-cell background while still
// reading as a "noise / background activity" bucket (auto-commits, telegram
// pings, etc.). Previously a stone-grey that blended into empty cells.
const NOISE_ENTRY: ProjectColorEntry = {
  stroke: 'rgb(190,130,160)',
  fill: 'rgba(190,130,160,0.40)',
  chipBg: 'rgba(190,130,160,0.15)',
  dot: 'rgba(190,130,160,0.55)',
}

/** Parse `#rrggbb` into [r,g,b]; returns null if not a 6-digit hex. */
function hexToRgb(hex: string): [number, number, number] | null {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return null
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ]
}

/** Build a full ProjectColorEntry from a single hex, matching the opacity
 *  ramps used by the hand-picked palette so user colors read identically. */
function entryFromHex(hex: string): ProjectColorEntry | null {
  const rgb = hexToRgb(hex)
  if (!rgb) return null
  const [r, g, b] = rgb
  return {
    stroke: `rgb(${r},${g},${b})`,
    fill: `rgba(${r},${g},${b},0.45)`,
    chipBg: `rgba(${r},${g},${b},0.15)`,
    dot: `rgba(${r},${g},${b},0.6)`,
  }
}

function isBucketName(name: string): boolean {
  return (name.startsWith('[') && name.endsWith(']')) || name === '<unknown>'
}

/** Stable palette slot preferred by a project name (before collision probing). */
function hashSlot(name: string): number {
  let hash = 0
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) | 0
  return Math.abs(hash) % PALETTE.length
}

/** First unused slot at or after `preferred`, wrapping around. Falls back to
 *  `preferred` only when all 60 slots are taken (>60 registered projects). */
function firstFreeSlot(preferred: number, used: Set<number>): number {
  for (let i = 0; i < PALETTE.length; i += 1) {
    const slot = (preferred + i) % PALETTE.length
    if (!used.has(slot)) return slot
  }
  return preferred
}

// Resolved distinct-slot assignment for the currently-registered project set.
const slotByName = new Map<string, number>()

/**
 * Assign every visible project a DISTINCT palette slot. Call with the project
 * names ordered busiest-first so, on a hash collision, the busier project keeps
 * its preferred color and the quieter one is bumped — guaranteeing two active
 * projects never share a color. Buckets ([noise], <unknown>) and projects with
 * a user override are skipped (they have dedicated colors and don't consume a
 * palette slot).
 */
export function registerProjectColors(namesBusiestFirst: readonly string[]): void {
  slotByName.clear()
  const used = new Set<number>()
  const assignable = namesBusiestFirst.filter(
    n => !isBucketName(n) && !resolveProjectColorOverrideBlock(n),
  )
  // Pass 1: forced preferences (e.g. F9 → blue) claim their slot first.
  for (const name of assignable) {
    const pref = PREFERRED_SLOT[name]
    if (pref == null || slotByName.has(name)) continue
    const slot = firstFreeSlot(pref, used)
    slotByName.set(name, slot)
    used.add(slot)
  }
  // Pass 2: everyone else prefers their hashed slot, probing past collisions.
  for (const name of assignable) {
    if (slotByName.has(name)) continue
    const slot = firstFreeSlot(hashSlot(name), used)
    slotByName.set(name, slot)
    used.add(slot)
  }
}

export function getProjectColor(name: string): ProjectColorEntry {
  // User override wins over everything (including noise/unknown buckets).
  const override = resolveProjectColorOverrideBlock(name)
  if (override) {
    const entry = entryFromHex(override)
    if (entry) return entry
  }
  if (name.startsWith('[') && name.endsWith(']')) return NOISE_ENTRY
  if (name === '<unknown>') return UNKNOWN_ENTRY
  // Registered projects use their distinct assigned slot; anything not in the
  // current active set (or asked for before registration) falls back to its
  // stable hash slot so it still gets a consistent color.
  const assigned = slotByName.get(name)
  if (assigned != null) return PALETTE[assigned]
  return PALETTE[hashSlot(name)]
}
