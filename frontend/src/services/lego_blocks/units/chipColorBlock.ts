// Single source of truth for the app's chip/badge color recipe, so every filled
// pill (status pills, semantic badges, future chips) reads the same in both
// themes.
//
// Dark look = "opaque muted mid-dark" (Notion / Linear style):
//   - Fill is FULLY OPAQUE but low-saturation and dark (~HSL sat 26%, light 31%)
//     — a "colored grey", not a bright pastel and not a translucent haze. Opaque
//     keeps it crisp; dark + desaturated keeps it from shouting.
//   - No border — the opaque fill already gives a clean edge (dark:border set
//     transparent so the shared shape stays borderless in dark).
//   - Text is a brighter same-hue accent (~sat 62%, light 80%) so the label
//     carries the color and stays legible.
// The precise fill/text tones use HSL arbitrary values because Tailwind's own
// dark shades (-800/-900) are far too saturated to read as muted.
//
// Light look = a pale tint + subtle colored border + deep text (unchanged).
//
// Tailwind can only see class names that appear as complete literals, so every
// combination is spelled out here rather than composed at runtime.

export type ChipColorBlock =
  | 'emerald'
  | 'green'
  | 'teal'
  | 'cyan'
  | 'sky'
  | 'blue'
  | 'indigo'
  | 'violet'
  | 'purple'
  | 'fuchsia'
  | 'rose'
  | 'red'
  | 'orange'
  | 'amber'
  | 'yellow'
  | 'slate'
  | 'zinc'

export const CHIP_COLOR_CLASS_BLOCK: Record<ChipColorBlock, string> = {
  emerald: 'border border-emerald-500/25 bg-emerald-500/12 text-emerald-700 dark:border-transparent dark:bg-[hsl(158_26%_31%)] dark:text-[hsl(158_62%_80%)]',
  green: 'border border-green-500/25 bg-green-500/12 text-green-700 dark:border-transparent dark:bg-[hsl(142_26%_31%)] dark:text-[hsl(142_62%_80%)]',
  teal: 'border border-teal-500/25 bg-teal-500/12 text-teal-700 dark:border-transparent dark:bg-[hsl(173_26%_31%)] dark:text-[hsl(173_62%_80%)]',
  cyan: 'border border-cyan-500/25 bg-cyan-500/12 text-cyan-700 dark:border-transparent dark:bg-[hsl(189_26%_31%)] dark:text-[hsl(189_62%_80%)]',
  sky: 'border border-sky-500/25 bg-sky-500/12 text-sky-700 dark:border-transparent dark:bg-[hsl(199_26%_31%)] dark:text-[hsl(199_62%_80%)]',
  blue: 'border border-blue-500/25 bg-blue-500/12 text-blue-700 dark:border-transparent dark:bg-[hsl(214_26%_31%)] dark:text-[hsl(214_62%_80%)]',
  indigo: 'border border-indigo-500/25 bg-indigo-500/12 text-indigo-700 dark:border-transparent dark:bg-[hsl(239_26%_31%)] dark:text-[hsl(239_62%_80%)]',
  violet: 'border border-violet-500/25 bg-violet-500/12 text-violet-700 dark:border-transparent dark:bg-[hsl(262_26%_31%)] dark:text-[hsl(262_62%_80%)]',
  purple: 'border border-purple-500/25 bg-purple-500/12 text-purple-700 dark:border-transparent dark:bg-[hsl(275_26%_31%)] dark:text-[hsl(275_62%_80%)]',
  fuchsia: 'border border-fuchsia-500/25 bg-fuchsia-500/12 text-fuchsia-700 dark:border-transparent dark:bg-[hsl(300_26%_31%)] dark:text-[hsl(300_62%_80%)]',
  rose: 'border border-rose-500/25 bg-rose-500/12 text-rose-700 dark:border-transparent dark:bg-[hsl(345_26%_31%)] dark:text-[hsl(345_62%_80%)]',
  red: 'border border-red-500/25 bg-red-500/12 text-red-700 dark:border-transparent dark:bg-[hsl(4_26%_31%)] dark:text-[hsl(4_62%_80%)]',
  orange: 'border border-orange-500/25 bg-orange-500/12 text-orange-700 dark:border-transparent dark:bg-[hsl(26_30%_31%)] dark:text-[hsl(30_70%_78%)]',
  amber: 'border border-amber-500/25 bg-amber-500/12 text-amber-700 dark:border-transparent dark:bg-[hsl(40_32%_31%)] dark:text-[hsl(43_78%_76%)]',
  yellow: 'border border-yellow-500/25 bg-yellow-500/12 text-yellow-700 dark:border-transparent dark:bg-[hsl(50_30%_30%)] dark:text-[hsl(50_70%_76%)]',
  slate: 'border border-slate-500/25 bg-slate-500/12 text-slate-600 dark:border-transparent dark:bg-[hsl(216_8%_30%)] dark:text-[hsl(216_12%_84%)]',
  zinc: 'border border-zinc-500/25 bg-zinc-500/12 text-zinc-600 dark:border-transparent dark:bg-[hsl(240_8%_30%)] dark:text-[hsl(240_12%_84%)]',
}

/** Chip classes for a semantic color; falls back to a neutral zinc chip. */
export function chipColorClassBlock(color: ChipColorBlock = 'zinc'): string {
  return CHIP_COLOR_CLASS_BLOCK[color] ?? CHIP_COLOR_CLASS_BLOCK.zinc
}
