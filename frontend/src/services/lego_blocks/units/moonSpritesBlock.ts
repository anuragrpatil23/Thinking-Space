/* The moon scene's characters and the renderer that draws them: pixel rows
   turned into box-shadow pixels, no image assets. Shared by the Home scene
   (MoonSceneBlock) and the explorer's header (ExplorerMoonHeaderBlock), so
   both places draw the same astronaut and Clawd. Rendered by
   MoonPixelSpriteBlock. */

export const PX = 5

export const PALETTE: Record<string, string> = {
  W: '#f1f5f9', // suit white / bubble
  G: '#94a3b8', // suit gray
  V: '#38bdf8', // visor / blue accent
  D: '#0c4a6e', // visor shade
  O: '#e8855d', // clawd coral
  K: '#1e293b', // dark (eyes / glyphs / deck)
  R: '#f87171', // flag red / red accent
  S: '#cbd5e1', // pole silver / records
  P: '#8b5cf6', // wizard purple
  Y: '#fbbf24', // sparkle gold
}

// Arms live in separate overlays so they can move while thinking / DJing.
export const ASTRONAUT = [
  '....WWWW....',
  '...WWWWWW...',
  '..WWVVVVWW..',
  '..WWVVDDWW..',
  '..WWWWWWWW..',
  '...WWWWWW...',
  '...WWWWWW...',
  '...WWWWWW...',
  '...WWWWWW...',
  '...WWWWWW...',
  '...WWWWWW...',
  '...WWW.WWW..',
  '...GGW.WGG..',
  '...GG...GG..',
]

export const ASTRONAUT_ARM_L = [
  '............',
  '............',
  '............',
  '............',
  '............',
  '............',
  '..G.........',
  '.WG.........',
  '.WG.........',
  '.W..........',
]

export const ASTRONAUT_ARM_R = [
  '............',
  '............',
  '............',
  '............',
  '............',
  '............',
  '.........G..',
  '.........GW.',
  '.........GW.',
  '..........W.',
]

// Clawd — decoded from the reference sprite: inset ears, 1x2 slit eyes,
// arm band extending past the body, leg pairs under each side.
export const CLAWD = [
  '....OO.....OO...',
  '...OOOOOOOOOOO..',
  '...OOOOOOOOOOO..',
  '...OOKOOOOOKOO..',
  '...OOKOOOOOKOO..',
  '...OOOOOOOOOOO..',
  '...OOOOOOOOOOO..',
  '...OOOOOOOOOOO..',
  '...OOOOOOOOOOO..',
  '....O.O...O.O...',
  '....O.O...O.O...',
]

// Clawd's nub arms, separate so they can flap.
export const CLAWD_ARM_L = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '.OO.............',
  '.OO.............',
]

export const CLAWD_ARM_R = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '..............OO',
  '..............OO',
]

// Coral pixels covering Clawd's eye slits — flashed briefly to blink.
export const CLAWD_EYELIDS = [
  '................',
  '................',
  '................',
  '.....O.....O....',
  '.....O.....O....',
]

export const FLAG = [
  'SRRRRRR',
  'SRRKKRR',
  'SRRRRRR',
  'S......',
  'S......',
  'S......',
  'S......',
  'S......',
]

/** A sprite as one SVG path per colour, in pixel units (1 = one sprite
    pixel). Runs of same-coloured pixels on a row merge into one rectangle.

    Replaces drawing each pixel as its own CSS box-shadow square: at any
    fractional scale (a zoomed Home canvas, the shrunk explorer Clawd) each
    square was antialiased on its own and faint gridlines showed between
    neighbouring pixels. One shape per colour has no internal edges to seam. */
export function spritePathsBlock(rows: readonly string[]): Array<{ color: string; d: string }> {
  const byColor = new Map<string, string[]>()
  rows.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      const key = row[x]
      const color = PALETTE[key]
      if (!color) {
        x += 1
        continue
      }
      let end = x + 1
      while (end < row.length && row[end] === key) end += 1
      const parts = byColor.get(color) ?? []
      parts.push(`M${x} ${y}h${end - x}v1h-${end - x}z`)
      byColor.set(color, parts)
      x = end
    }
  })
  return [...byColor].map(([color, parts]) => ({ color, d: parts.join('') }))
}

// Empty thought bubble — the three dots are separate overlays so they can
// appear one at a time.
export const THINK_BUBBLE = [
  '.WWWWWWWWW.',
  'WWWWWWWWWWW',
  'WWWWWWWWWWW',
  'WWWWWWWWWWW',
  '.WWWWWWWWW.',
  '..W........',
  '.W.........',
]

export const THINK_DOT = ['K']

// Clawd's thought: a tiny terminal prompt `>_`.
export const PROMPT_BUBBLE = [
  '.WWWWWWWW.',
  'WWKWWWWWWW',
  'WWWKWWWWWW',
  'WWKWWKKWWW',
  '.WWWWWWWW.',
  '...W......',
  '..W.......',
]

// DJ deck: two records flanking a mixer with buttons; stubby legs.
export const DJ_DECK = [
  '.KKKKKKKKKKKKKKKKK.',
  '.KSSSSSKRVRKSSSSSK.',
  '.KSSSSSKVRVKSSSSSK.',
  '.KKKKKKKKKKKKKKKKK.',
  '..KK...........KK..',
  '..KK...........KK..',
]

// Record center dots — separate overlay that jitters side to side so the
// records look like they're being scratched.
export const DJ_DISC_DOTS = [
  '...................',
  '...................',
  '....K..........K...',
]

// Skateboard with upturned tips and silver wheels (message animation: skate).
export const SKATEBOARD = [
  'R..........R',
  'RRRRRRRRRRRR',
  '..S......S..',
]

// Wizard hat — purple cone with a gold star tip and brim (message animation:
// wizard), inspired by the Claude Code wizard-Clawd promo.
export const WIZARD_HAT = [
  '......YY......',
  '......PP......',
  '.....PPPP.....',
  '....PPPPPP....',
  '...PPPPPPPP...',
  '..PPPPPPPPPP..',
  'PPPPPPPPPPPPPP',
]

// Wand: gold star tip on a gray stick, held out to the right.
export const WIZARD_WAND = [
  '....Y',
  '...YG',
  '..G..',
  '.G...',
]

// Plus-shaped sparkle, parameterized by color letter (gold for the wizard
// wand, mixed colors for disco glints).
export function sparkleRows(c: string): string[] {
  return [`.${c}.`, `${c}${c}${c}`, `.${c}.`]
}

export const SPARKLE = sparkleRows('Y')

// Disco ball — checkerboard facets; a white shine column sweeps across it
// (clipped by an overflow-hidden wrapper) to fake rotation.
export const DISCO_BALL = [
  '..SGSGS..',
  '.GSGSGSG.',
  'SGSGSGSGS',
  'GSGSGSGSG',
  'SGSGSGSGS',
  'GSGSGSGSG',
  '.SGSGSGS.',
  '..GSGSG..',
]

export const DISCO_SHINE = ['W', 'W', 'W', 'W']

// Headphones worn in DJ mode — band arcs one row above each head with wide
// 3-column cups hanging from its ends, poking out past the head sides.
export const HEADPHONES_ASTRO = [
  '.KKKKKKKKKK.',
  'KK........KK',
  'KK........KK',
  'KK........KK',
]

export const HEADPHONES_CLAWD = [
  '..KKKKKKKKKKKKK.',
  '.KK...........KK',
  '.KK...........KK',
  '.KK...........KK',
]

// Tiny pixel "Z" — three of these rise while a sprite sleeps.
export const SLEEP_Z = [
  'WWW',
  '..W',
  '.W.',
  'W..',
  'WWW',
]

// Stubby diagonal tail for the wag walk, parameterized by color letter so it
// matches each sprite (coral for Clawd, suit gray for the astronaut). It sits
// inside the flipping body so it swaps sides with the walk direction.
export function tailRows(c: string): string[] {
  return [
    `${c}..`,
    `${c}${c}.`,
    `.${c}${c}`,
  ]
}

// Double eighth-note, parameterized by color letter.
export function noteRows(c: string): string[] {
  return [
    `.${c}${c}${c}${c}`,
    `.${c}..${c}`,
    `.${c}..${c}`,
    `.${c}..${c}`,
    `${c}${c}.${c}${c}`,
    `${c}${c}.${c}${c}`,
  ]
}
