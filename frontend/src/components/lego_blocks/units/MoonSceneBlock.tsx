/**
 * MoonSceneBlock — decorative pixel-art moon scene (astronaut + Clawd, the
 * Claude Code mascot) rendered in canvas world-space so it pans/zooms with
 * the board. Sprites are code-drawn via box-shadow pixels: no image assets.
 *
 * Day/golden: idle life — the astronaut periodically "thinks" (dot-by-dot
 * thought bubble) and rarely does a big moon hop; Clawd blinks, thinks in
 * terminal (`>_` bubble), and occasionally wiggles.
 *
 * Late night (23:00–05:00 via useTimeOfDayBlock, NOT dark mode — people run
 * dark mode all day): the two of them DJ — deck with scratching records,
 * beat-bobbing, floating notes, and a pulsing "take a break" sign. Evening
 * ('night' phase) keeps the idle scene on the night backdrop. All motion is
 * pure CSS keyframes.
 */

import { useTimeOfDayBlock, isDarkPhaseBlock } from '@/components/lego_blocks/hooks/shared/useTimeOfDayBlock'
import { useMoonSceneMessagesBlock } from '@/components/lego_blocks/hooks/shared/useMoonSceneMessagesBlock'
import { useMoonSceneIdleAnimationsBlock } from '@/components/lego_blocks/hooks/shared/useMoonSceneIdleAnimationsBlock'
import type { MoonSceneAnimationBlock } from '@/services/lego_blocks/units/vaultUiPreferencesBlock'
import { quoteForDay } from '@/services/lego_blocks/units/breakQuotesBlock'

const PX = 5

const PALETTE: Record<string, string> = {
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
const ASTRONAUT = [
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

const ASTRONAUT_ARM_L = [
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

const ASTRONAUT_ARM_R = [
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
const CLAWD = [
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
const CLAWD_ARM_L = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '.OO.............',
  '.OO.............',
]

const CLAWD_ARM_R = [
  '................',
  '................',
  '................',
  '................',
  '................',
  '..............OO',
  '..............OO',
]

// Coral pixels covering Clawd's eye slits — flashed briefly to blink.
const CLAWD_EYELIDS = [
  '................',
  '................',
  '................',
  '.....O.....O....',
  '.....O.....O....',
]

const FLAG = [
  'SRRRRRR',
  'SRRKKRR',
  'SRRRRRR',
  'S......',
  'S......',
  'S......',
  'S......',
  'S......',
]

// Empty thought bubble — the three dots are separate overlays so they can
// appear one at a time.
const THINK_BUBBLE = [
  '.WWWWWWWWW.',
  'WWWWWWWWWWW',
  'WWWWWWWWWWW',
  'WWWWWWWWWWW',
  '.WWWWWWWWW.',
  '..W........',
  '.W.........',
]

const THINK_DOT = ['K']

// Clawd's thought: a tiny terminal prompt `>_`.
const PROMPT_BUBBLE = [
  '.WWWWWWWW.',
  'WWKWWWWWWW',
  'WWWKWWWWWW',
  'WWKWWKKWWW',
  '.WWWWWWWW.',
  '...W......',
  '..W.......',
]

// DJ deck: two records flanking a mixer with buttons; stubby legs.
const DJ_DECK = [
  '.KKKKKKKKKKKKKKKKK.',
  '.KSSSSSKRVRKSSSSSK.',
  '.KSSSSSKVRVKSSSSSK.',
  '.KKKKKKKKKKKKKKKKK.',
  '..KK...........KK..',
  '..KK...........KK..',
]

// Record center dots — separate overlay that jitters side to side so the
// records look like they're being scratched.
const DJ_DISC_DOTS = [
  '...................',
  '...................',
  '....K..........K...',
]

// Skateboard with upturned tips and silver wheels (message animation: skate).
const SKATEBOARD = [
  'R..........R',
  'RRRRRRRRRRRR',
  '..S......S..',
]

// Wizard hat — purple cone with a gold star tip and brim (message animation:
// wizard), inspired by the Claude Code wizard-Clawd promo.
const WIZARD_HAT = [
  '......YY......',
  '......PP......',
  '.....PPPP.....',
  '....PPPPPP....',
  '...PPPPPPPP...',
  '..PPPPPPPPPP..',
  'PPPPPPPPPPPPPP',
]

// Wand: gold star tip on a gray stick, held out to the right.
const WIZARD_WAND = [
  '....Y',
  '...YG',
  '..G..',
  '.G...',
]

// Plus-shaped sparkle, parameterized by color letter (gold for the wizard
// wand, mixed colors for disco glints).
function sparkleRows(c: string): string[] {
  return [`.${c}.`, `${c}${c}${c}`, `.${c}.`]
}

const SPARKLE = sparkleRows('Y')

// Disco ball — checkerboard facets; a white shine column sweeps across it
// (clipped by an overflow-hidden wrapper) to fake rotation.
const DISCO_BALL = [
  '..SGSGS..',
  '.GSGSGSG.',
  'SGSGSGSGS',
  'GSGSGSGSG',
  'SGSGSGSGS',
  'GSGSGSGSG',
  '.SGSGSGS.',
  '..GSGSG..',
]

const DISCO_SHINE = ['W', 'W', 'W', 'W']

// Headphones worn in DJ mode — band arcs one row above each head with wide
// 3-column cups hanging from its ends, poking out past the head sides.
const HEADPHONES_ASTRO = [
  '.KKKKKKKKKK.',
  'KK........KK',
  'KK........KK',
  'KK........KK',
]

const HEADPHONES_CLAWD = [
  '..KKKKKKKKKKKKK.',
  '.KK...........KK',
  '.KK...........KK',
  '.KK...........KK',
]

// Tiny pixel "Z" — three of these rise while a sprite sleeps.
const SLEEP_Z = [
  'WWW',
  '..W',
  '.W.',
  'W..',
  'WWW',
]

// Stubby diagonal tail for the wag walk, parameterized by color letter so it
// matches each sprite (coral for Clawd, suit gray for the astronaut). It sits
// inside the flipping body so it swaps sides with the walk direction.
function tailRows(c: string): string[] {
  return [
    `${c}..`,
    `${c}${c}.`,
    `.${c}${c}`,
  ]
}

// Double eighth-note, parameterized by color letter.
function noteRows(c: string): string[] {
  return [
    `.${c}${c}${c}${c}`,
    `.${c}..${c}`,
    `.${c}..${c}`,
    `.${c}..${c}`,
    `${c}${c}.${c}${c}`,
    `${c}${c}.${c}${c}`,
  ]
}

function spriteShadow(rows: string[], px: number): string {
  const shadows: string[] = []
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const color = PALETTE[row[x]]
      if (color) shadows.push(`${x * px}px ${y * px}px 0 ${color}`)
    }
  })
  return shadows.join(',')
}

function PixelSprite({ rows, px = PX }: { rows: string[]; px?: number }) {
  return (
    <div
      style={{
        width: px,
        height: px,
        boxShadow: spriteShadow(rows, px),
        // reserve full sprite bounds so parent sizing works
        marginRight: (rows[0].length - 1) * px,
        marginBottom: (rows.length - 1) * px,
      }}
    />
  )
}

// Pixel-styled speech bubble for scheduled messages; anchored above a sprite
// and grows upward with the text.
function SpeechBubbleBlock({ text }: { text: string }) {
  return (
    <div style={{ position: 'relative', width: 'max-content', maxWidth: 160 }}>
      <div
        style={{
          background: PALETTE.W,
          color: PALETTE.K,
          fontFamily: 'ui-monospace, monospace',
          fontSize: 10,
          fontWeight: 600,
          lineHeight: 1.45,
          padding: '6px 9px',
          border: `3px solid ${PALETTE.K}`,
          boxShadow: '0 3px 0 rgba(0,0,0,0.35)',
        }}
      >
        {text}
      </div>
      {/* tail */}
      <div
        style={{
          position: 'absolute',
          left: 10,
          bottom: -7,
          width: 10,
          height: 10,
          background: PALETTE.W,
          borderLeft: `3px solid ${PALETTE.K}`,
          borderBottom: `3px solid ${PALETTE.K}`,
          transform: 'rotate(-45deg)',
        }}
      />
    </div>
  )
}

// Body-level animations replace the idle bob/wiggle; arm-level ones (wave,
// cheer) keep the body idle and only override the arm overlays. Skate/run
// additionally shuttle the outer wrapper so the speech bubble travels along.
const MSG_BODY_ANIMATION: Partial<Record<MoonSceneAnimationBlock, string>> = {
  dance: 'moon-msg-dance 0.9s ease-in-out infinite',
  hop: 'moon-msg-hop 1.6s ease-in-out infinite',
  spin: 'moon-msg-spin 2.4s linear infinite',
  skate: 'moon-msg-skate-tilt 1.25s ease-in-out infinite alternate',
  run: 'moon-msg-run-face 3.2s steps(1) infinite',
  float: 'moon-msg-float 4s ease-in-out infinite alternate',
  sleep: 'moon-msg-sleep 5s ease-in-out infinite alternate',
  hang: 'moon-msg-hang 2.8s ease-in-out infinite',
  wag: 'moon-msg-wag-walk 6s steps(1) infinite',
  nod: 'moon-msg-nod 1.1s ease-in-out infinite',
  wobble: 'moon-msg-wobble 0.7s ease-in-out infinite alternate',
  stretch: 'moon-msg-stretch 2.4s ease-in-out infinite',
  backflip: 'moon-msg-backflip 1.4s ease-in-out infinite',
}

const MSG_OUTER_ANIMATION: Partial<Record<MoonSceneAnimationBlock, string>> = {
  skate: 'moon-msg-skate-shuttle 5s ease-in-out infinite',
  run: 'moon-msg-run-shuttle 3.2s linear infinite',
  wag: 'moon-msg-wag-shuttle 6s linear infinite',
}

// Hat, wand, and popping sparkles for the wizard animation; skateboard for
// skate. Offsets differ per sprite, so they're passed in.
function MessageOverlaysBlock({
  anim,
  skateboardLeft,
  skateboardTop,
  hatLeft,
  hatTop,
  wandLeft,
  wandTop,
  tailLeft,
  tailTop,
  tailColor,
}: {
  anim: MoonSceneAnimationBlock
  skateboardLeft: number
  skateboardTop: number
  hatLeft: number
  hatTop: number
  wandLeft: number
  wandTop: number
  tailLeft: number
  tailTop: number
  tailColor: string
}) {
  if (anim === 'wag') {
    return (
      <div
        style={{
          position: 'absolute',
          left: tailLeft,
          top: tailTop,
          animation: 'moon-msg-wag-tail 0.35s ease-in-out infinite alternate',
          transformOrigin: 'top right',
        }}
      >
        <PixelSprite rows={tailRows(tailColor)} px={4} />
      </div>
    )
  }
  if (anim === 'skate') {
    return (
      <div style={{ position: 'absolute', left: skateboardLeft, top: skateboardTop }}>
        <PixelSprite rows={SKATEBOARD} px={4} />
      </div>
    )
  }
  if (anim === 'sleep') {
    // Rising zzz above the head; reuses the DJ-mode note-rise keyframe.
    return (
      <>
        {[0, 1, 2].map(i => (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: wandLeft - 4 + i * 9,
              top: hatTop - 4 - i * 6,
              animation: `moon-note-rise 3s ease-out ${i * 1}s infinite`,
              opacity: 0,
            }}
          >
            <PixelSprite rows={SLEEP_Z} px={2} />
          </div>
        ))}
      </>
    )
  }
  if (anim === 'wizard') {
    return (
      <>
        <div style={{ position: 'absolute', left: hatLeft, top: hatTop }}>
          <PixelSprite rows={WIZARD_HAT} px={4} />
        </div>
        <div style={{ position: 'absolute', left: wandLeft, top: wandTop }}>
          <PixelSprite rows={WIZARD_WAND} px={4} />
        </div>
        {[0, 1, 2].map(i => (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: wandLeft + 14 + i * 8,
              top: wandTop - 8 - i * 8,
              animation: `moon-msg-sparkle 1.2s ease-in-out ${i * 0.4}s infinite`,
              opacity: 0,
            }}
          >
            <PixelSprite rows={SPARKLE} px={3} />
          </div>
        ))}
      </>
    )
  }
  return null
}

export default function MoonSceneBlock({ x, y }: { x: number; y: number }) {
  const phase = useTimeOfDayBlock()
  const dj = phase === 'late'
  const darkBackdrop = isDarkPhaseBlock(phase)
  // One quote per calendar day, fixed for the whole day (see breakQuotesBlock).
  const breakQuote = quoteForDay()
  const activeMessages = useMoonSceneMessagesBlock()
  const { animations: idleAnimations, playBurst } = useMoonSceneIdleAnimationsBlock()
  const astroMsg = activeMessages.astronaut
  const clawdMsg = activeMessages.clawd
  // Scheduled messages take priority; otherwise the idle rotation (or a
  // click-triggered burst) may play a random animation. Night DJ mode keeps
  // its own show.
  const astroAnim: MoonSceneAnimationBlock = astroMsg
    ? astroMsg.animation
    : dj ? 'none' : idleAnimations.astronaut
  const clawdAnim: MoonSceneAnimationBlock = clawdMsg
    ? clawdMsg.animation
    : dj ? 'none' : idleAnimations.clawd
  const astroBodyMsgAnimation = MSG_BODY_ANIMATION[astroAnim]
  const clawdBodyMsgAnimation = MSG_BODY_ANIMATION[clawdAnim]
  const astroOuterMsgAnimation = MSG_OUTER_ANIMATION[astroAnim]
  const clawdOuterMsgAnimation = MSG_OUTER_ANIMATION[clawdAnim]

  const surfaceW = 520
  const surfaceH = 110

  return (
    <div
      aria-hidden
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width: surfaceW,
        height: surfaceH + 130,
        pointerEvents: 'none',
        zIndex: 1,
      }}
    >
      <style>{`
        @keyframes moon-bob {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(-7px); }
        }
        @keyframes moon-bob-slow {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(-4px); }
        }
        @keyframes moon-flag-wave {
          0%, 100% { transform: skewY(0deg); }
          50%      { transform: skewY(-3deg); }
        }
        /* Quick double-blink, long pause. */
        @keyframes moon-blink {
          0%, 91.5%, 93.5%, 95.5%, 97.5%, 100% { opacity: 0; }
          92%, 93%, 96%, 97% { opacity: 1; }
        }
        /* Thought bubble: hidden most of the cycle, fades in, holds, fades. */
        @keyframes moon-think-bubble {
          0%, 33%  { opacity: 0; }
          36%, 76% { opacity: 1; }
          79%, 100% { opacity: 0; }
        }
        /* Dots inside the bubble pop in one at a time (staggered by delay). */
        @keyframes moon-think-dot {
          0%, 40%  { opacity: 0; }
          42%, 74% { opacity: 1; }
          77%, 100% { opacity: 0; }
        }
        /* Rare big low-gravity hop near the end of the idle cycle. */
        @keyframes moon-rare-hop {
          0%, 84% { transform: translateY(0); }
          88%     { transform: translateY(-18px); }
          93%     { transform: translateY(0); }
          95%     { transform: translateY(-5px); }
          97%, 100% { transform: translateY(0); }
        }
        /* Arms raise and waggle while the thought bubble is up (36%-76%). */
        @keyframes moon-arm-think-l {
          0%, 34%   { transform: rotate(0deg); }
          40%       { transform: rotate(-18deg); }
          48%       { transform: rotate(-10deg); }
          56%       { transform: rotate(-18deg); }
          64%       { transform: rotate(-10deg); }
          72%       { transform: rotate(-16deg); }
          78%, 100% { transform: rotate(0deg); }
        }
        @keyframes moon-arm-think-r {
          0%, 34%   { transform: rotate(0deg); }
          40%       { transform: rotate(18deg); }
          48%       { transform: rotate(10deg); }
          56%       { transform: rotate(18deg); }
          64%       { transform: rotate(10deg); }
          72%       { transform: rotate(16deg); }
          78%, 100% { transform: rotate(0deg); }
        }
        /* Clawd's nubs flap up and down while his bubble is up. */
        @keyframes moon-nub-think {
          0%, 36%   { transform: translateY(0); }
          41%       { transform: translateY(-5px); }
          46%       { transform: translateY(0); }
          51%       { transform: translateY(-5px); }
          56%       { transform: translateY(0); }
          61%       { transform: translateY(-5px); }
          66%       { transform: translateY(0); }
          71%       { transform: translateY(-4px); }
          76%, 100% { transform: translateY(0); }
        }
        /* Occasional happy wiggle. */
        @keyframes moon-wiggle {
          0%, 70% { transform: rotate(0deg); }
          74%     { transform: rotate(-7deg); }
          78%     { transform: rotate(7deg); }
          82%     { transform: rotate(-5deg); }
          86%, 100% { transform: rotate(0deg); }
        }

        /* --- night / DJ mode --- */
        @keyframes moon-dj-bob {
          from { transform: translateY(0); }
          to   { transform: translateY(-5px); }
        }
        @keyframes moon-arm-pump-l {
          from { transform: rotate(-8deg); }
          to   { transform: rotate(-30deg); }
        }
        @keyframes moon-arm-scratch {
          from { transform: rotate(6deg); }
          to   { transform: rotate(22deg); }
        }
        @keyframes moon-nub-flap {
          from { transform: translateY(0); }
          to   { transform: translateY(-5px); }
        }
        @keyframes moon-disc-scratch {
          0%, 48%  { transform: translateX(-${PX}px); }
          50%, 100% { transform: translateX(${PX}px); }
        }
        @keyframes moon-note-rise {
          0%   { transform: translateY(0); opacity: 0; }
          12%  { opacity: 1; }
          75%  { opacity: 1; }
          100% { transform: translateY(-48px); opacity: 0; }
        }
        @keyframes moon-sign-pulse {
          0%, 100% { opacity: 0.55; }
          50%      { opacity: 1; }
        }
        /* Disco ball: gentle pendulum sway from the string anchor, plus a
           shine column stepping across the facets to read as rotation. */
        @keyframes moon-disco-sway {
          from { transform: rotate(-4deg); }
          to   { transform: rotate(4deg); }
        }
        @keyframes moon-disco-spin {
          from { transform: translateX(-4px); }
          to   { transform: translateX(36px); }
        }

        /* --- scheduled-message animation library --- */
        @keyframes moon-msg-dance {
          0%, 100% { transform: translateX(0) rotate(0deg); }
          25%      { transform: translateX(-4px) rotate(-6deg); }
          75%      { transform: translateX(4px) rotate(6deg); }
        }
        @keyframes moon-msg-hop {
          0%, 60%, 100% { transform: translateY(0); }
          30%           { transform: translateY(-14px); }
        }
        @keyframes moon-msg-spin {
          0%   { transform: scaleX(1); }
          25%  { transform: scaleX(0.1); }
          50%  { transform: scaleX(-1); }
          75%  { transform: scaleX(0.1); }
          100% { transform: scaleX(1); }
        }
        @keyframes moon-msg-wave {
          from { transform: rotate(15deg); }
          to   { transform: rotate(50deg); }
        }
        @keyframes moon-msg-cheer-l {
          from { transform: rotate(-35deg); }
          to   { transform: rotate(-58deg); }
        }
        @keyframes moon-msg-cheer-r {
          from { transform: rotate(35deg); }
          to   { transform: rotate(58deg); }
        }
        @keyframes moon-msg-bubble-float {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(-4px); }
        }
        /* skate: the outer wrapper shuttles across the surface while the body
           tilts; run: faster shuttle with a face flip at each turn. */
        @keyframes moon-msg-skate-shuttle {
          0%, 100% { transform: translateX(-80px); }
          50%      { transform: translateX(80px); }
        }
        @keyframes moon-msg-skate-tilt {
          from { transform: rotate(-7deg); }
          to   { transform: rotate(7deg); }
        }
        @keyframes moon-msg-run-shuttle {
          0%, 100% { transform: translateX(-70px); }
          50%      { transform: translateX(70px); }
        }
        @keyframes moon-msg-run-face {
          0%, 49.9% { transform: scaleX(1); }
          50%, 100% { transform: scaleX(-1); }
        }
        @keyframes moon-msg-float {
          from { transform: translateY(0) rotate(0deg); }
          to   { transform: translateY(-18px) rotate(8deg); }
        }
        @keyframes moon-msg-sparkle {
          0%, 100% { opacity: 0; transform: scale(0.4); }
          50%      { opacity: 1; transform: scale(1); }
        }
        @keyframes moon-msg-sleep {
          from { transform: translateY(0) rotate(0deg); }
          to   { transform: translateY(-6px) rotate(-3deg); }
        }
        /* hang: flipped about the body center (transform-origin overridden to
           center for this anim), lifted off the ground, gently swinging. */
        @keyframes moon-msg-hang {
          0%, 100% { transform: translateY(-34px) rotate(174deg); }
          50%      { transform: translateY(-34px) rotate(186deg); }
        }
        /* wag: relaxed walk shuttle; the body waddle + face flip is stepped so
           the tilt jumps pixel-art style instead of easing. */
        @keyframes moon-msg-wag-shuttle {
          0%, 100% { transform: translateX(-60px); }
          50%      { transform: translateX(60px); }
        }
        @keyframes moon-msg-wag-walk {
          0%    { transform: scaleX(1) rotate(-3deg); }
          12.5% { transform: scaleX(1) rotate(3deg); }
          25%   { transform: scaleX(1) rotate(-3deg); }
          37.5% { transform: scaleX(1) rotate(3deg); }
          50%   { transform: scaleX(-1) rotate(-3deg); }
          62.5% { transform: scaleX(-1) rotate(3deg); }
          75%   { transform: scaleX(-1) rotate(-3deg); }
          87.5% { transform: scaleX(-1) rotate(3deg); }
          100%  { transform: scaleX(1) rotate(-3deg); }
        }
        @keyframes moon-msg-wag-tail {
          from { transform: rotate(-14deg); }
          to   { transform: rotate(16deg); }
        }
        /* nod: gentle forward bow + dip, pivoting at the feet — reads as a
           friendly "yes"/greeting. */
        @keyframes moon-msg-nod {
          0%, 100% { transform: rotate(0deg) translateY(0); }
          25%      { transform: rotate(9deg) translateY(2px); }
          50%      { transform: rotate(0deg) translateY(0); }
          75%      { transform: rotate(9deg) translateY(2px); }
        }
        /* wobble: pendulum sway from the feet, more pronounced than the idle
           wiggle — a playful tipsy lean. Paired with alternate. */
        @keyframes moon-msg-wobble {
          from { transform: rotate(-11deg); }
          to   { transform: rotate(11deg); }
        }
        /* stretch: a slow yawn-and-stretch — grows upward from the feet then
           settles, with a tiny squash at the bottom of the cycle. */
        @keyframes moon-msg-stretch {
          0%, 100% { transform: scaleY(1) scaleX(1); }
          40%      { transform: scaleY(1.18) scaleX(0.94); }
          70%      { transform: scaleY(0.96) scaleX(1.04); }
        }
        /* backflip: a leaping 360 rotation about the body center (origin
           overridden for this anim) with an arc so the sprite hops as it flips. */
        @keyframes moon-msg-backflip {
          0%   { transform: translateY(0) rotate(0deg); }
          25%  { transform: translateY(-22px) rotate(120deg); }
          50%  { transform: translateY(-30px) rotate(220deg); }
          75%  { transform: translateY(-16px) rotate(320deg); }
          100% { transform: translateY(0) rotate(360deg); }
        }
      `}</style>

      {/* moon surface */}
      <svg
        width={surfaceW}
        height={surfaceH}
        viewBox={`0 0 ${surfaceW} ${surfaceH}`}
        style={{ position: 'absolute', left: 0, bottom: 0 }}
      >
        <ellipse cx={surfaceW / 2} cy={surfaceH + 60} rx={surfaceW / 2} ry={surfaceH} fill="#3f4459" />
        <ellipse cx={surfaceW / 2} cy={surfaceH + 64} rx={surfaceW / 2 - 14} ry={surfaceH - 6} fill="#4a4f66" />
        {/* craters */}
        <ellipse cx={110} cy={70} rx={26} ry={9} fill="#3a3f54" />
        <ellipse cx={110} cy={68} rx={26} ry={9} fill="#343950" />
        <ellipse cx={300} cy={92} rx={18} ry={6} fill="#3a3f54" />
        <ellipse cx={300} cy={90} rx={18} ry={6} fill="#343950" />
        <ellipse cx={420} cy={66} rx={22} ry={8} fill="#3a3f54" />
        <ellipse cx={420} cy={64} rx={22} ry={8} fill="#343950" />
      </svg>

      {dj ? (
        <>
          {/* DJ deck where the flag stands by day */}
          <div style={{ position: 'absolute', left: 206, bottom: 56 }}>
            <div style={{ position: 'relative' }}>
              <PixelSprite rows={DJ_DECK} />
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  animation: 'moon-disc-scratch 0.6s steps(1) infinite',
                }}
              >
                <PixelSprite rows={DJ_DISC_DOTS} />
              </div>
            </div>
          </div>

          {/* disco ball hanging above the deck, swaying from its string */}
          <div
            style={{
              position: 'absolute',
              left: 236,
              top: 18,
              animation: 'moon-disco-sway 3.4s ease-in-out infinite alternate',
              transformOrigin: 'top center',
            }}
          >
            {/* string */}
            <div style={{ width: 2, height: 14, margin: '0 auto', background: PALETTE.G }} />
            {/* ball with shine sweep clipped to its bounds */}
            <div style={{ position: 'relative', width: 36, height: 32, overflow: 'hidden' }}>
              <PixelSprite rows={DISCO_BALL} px={4} />
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 8,
                  animation: 'moon-disco-spin 1.8s steps(10) infinite',
                }}
              >
                <PixelSprite rows={DISCO_SHINE} px={4} />
              </div>
            </div>
          </div>

          {/* colored glints thrown off the ball */}
          {[
            { left: 200, top: 34, delay: 0, color: 'V' },
            { left: 290, top: 26, delay: 0.5, color: 'R' },
            { left: 214, top: 70, delay: 1.0, color: 'Y' },
            { left: 282, top: 78, delay: 1.5, color: 'W' },
          ].map(g => (
            <div
              key={`${g.left}-${g.top}`}
              style={{
                position: 'absolute',
                left: g.left,
                top: g.top,
                animation: `moon-msg-sparkle 2s ease-in-out ${g.delay}s infinite`,
                opacity: 0,
              }}
            >
              <PixelSprite rows={sparkleRows(g.color)} px={3} />
            </div>
          ))}

          {/* floating notes above the deck */}
          {[
            { left: 210, delay: 0, color: 'V' },
            { left: 248, delay: 0.7, color: 'R' },
            { left: 284, delay: 1.4, color: 'W' },
          ].map(n => (
            <div
              key={n.left}
              style={{
                position: 'absolute',
                left: n.left,
                bottom: 110,
                animation: `moon-note-rise 2.2s ease-out ${n.delay}s infinite`,
                opacity: 0,
              }}
            >
              <PixelSprite rows={noteRows(n.color)} px={3} />
            </div>
          ))}
        </>
      ) : (
        /* flag by day */
        <div
          style={{
            position: 'absolute',
            left: 250,
            bottom: 62,
            animation: 'moon-flag-wave 4s ease-in-out infinite',
            transformOrigin: 'bottom left',
          }}
        >
          <PixelSprite rows={FLAG} px={4} />
        </div>
      )}

      {/* daily reflection quote — shows in every phase, not just the late-night
          DJ wind-down. Lifted up into the open canvas above the scene so it never
          overlaps the sprites; only the eyebrow pulses so the quote reads steady.
          Colors flip for the light (day/golden) vs dark (night/late) backdrop. */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: -54,
          textAlign: 'center',
          fontFamily: 'ui-monospace, monospace',
        }}
      >
        <div
          style={{
            fontSize: 9,
            letterSpacing: '0.24em',
            textTransform: 'uppercase',
            color: darkBackdrop ? '#7dd3fc' : '#0369a1',
            textShadow: darkBackdrop ? '0 0 8px rgba(125,211,252,0.5)' : 'none',
            animation: 'moon-sign-pulse 2.4s ease-in-out infinite',
          }}
        >
          {dj ? '♪ take a break ♪' : '✿ a little something ✿'}
        </div>
        <div
          style={{
            maxWidth: 440,
            margin: '6px auto 0',
            fontSize: 11,
            lineHeight: 1.5,
            fontStyle: 'italic',
            color: darkBackdrop ? '#e2e8f0' : '#334155',
            textShadow: darkBackdrop ? '0 0 10px rgba(125,211,252,0.25)' : 'none',
          }}
        >
          {`“${breakQuote.text}”`}
        </div>
        {breakQuote.author && (
          <div
            style={{
              marginTop: 3,
              fontSize: 9,
              letterSpacing: '0.1em',
              color: darkBackdrop ? '#94a3b8' : '#64748b',
            }}
          >
            {`— ${breakQuote.author}`}
          </div>
        )}
      </div>

      {/* astronaut */}
      <div
        style={{
          position: 'absolute',
          left: 140,
          bottom: 52,
          animation: astroOuterMsgAnimation
            ?? (dj || astroBodyMsgAnimation ? undefined : 'moon-rare-hop 18s ease-in-out infinite'),
        }}
      >
        <div
          style={{
            position: 'relative',
            // hang/backflip rotate about the center so the sprite stays in place
            transformOrigin: astroAnim === 'hang' || astroAnim === 'backflip' ? 'center' : 'bottom center',
            animation: astroBodyMsgAnimation
              ?? (dj
                ? 'moon-dj-bob 0.52s ease-in-out infinite alternate'
                : 'moon-bob 3.2s ease-in-out infinite'),
          }}
        >
          <PixelSprite rows={ASTRONAUT} />
          {/* arms: think-waggle by day, pump + scratch at night, message overrides */}
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              animation: astroAnim === 'wave'
                ? undefined
                : astroAnim === 'cheer'
                  ? 'moon-msg-cheer-l 0.5s ease-in-out infinite alternate'
                  : dj
                    ? 'moon-arm-pump-l 0.52s ease-in-out infinite alternate'
                    : 'moon-arm-think-l 18s ease-in-out infinite',
              transformOrigin: `${3 * PX}px ${6.5 * PX}px`,
            }}
          >
            <PixelSprite rows={ASTRONAUT_ARM_L} />
          </div>
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              animation: astroAnim === 'wave'
                ? 'moon-msg-wave 0.6s ease-in-out infinite alternate'
                : astroAnim === 'cheer'
                  ? 'moon-msg-cheer-r 0.5s ease-in-out infinite alternate'
                  : dj
                    ? 'moon-arm-scratch 0.26s ease-in-out infinite alternate'
                    : 'moon-arm-think-r 18s ease-in-out infinite',
              transformOrigin: `${9 * PX}px ${6.5 * PX}px`,
            }}
          >
            <PixelSprite rows={ASTRONAUT_ARM_R} />
          </div>
          {/* headphones at night — band sits one row above the helmet */}
          {dj && (
            <div style={{ position: 'absolute', left: 0, top: -PX }}>
              <PixelSprite rows={HEADPHONES_ASTRO} />
            </div>
          )}
          <MessageOverlaysBlock
            anim={astroAnim}
            skateboardLeft={6}
            skateboardTop={ASTRONAUT.length * PX - 2}
            hatLeft={2}
            hatTop={-20}
            wandLeft={52}
            wandTop={26}
            tailLeft={-8}
            tailTop={44}
            tailColor="G"
          />
          {/* thought bubble floats up-right of the helmet (day only, idle) */}
          {!dj && !astroMsg && astroAnim === 'none' && (
            <div
              style={{
                position: 'absolute',
                left: 44,
                top: -34,
                animation: 'moon-think-bubble 18s ease-in-out infinite',
                opacity: 0,
              }}
            >
              <div style={{ position: 'relative' }}>
                <PixelSprite rows={THINK_BUBBLE} px={4} />
                {[0, 1, 2].map(i => (
                  <div
                    key={i}
                    style={{
                      position: 'absolute',
                      left: 12 + i * 8,
                      top: 8,
                      animation: `moon-think-dot 18s ease-in-out ${i * 0.9}s infinite`,
                      opacity: 0,
                    }}
                  >
                    <PixelSprite rows={THINK_DOT} px={4} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        {/* scheduled message speech bubble — outside the animated body so the
            text never mirrors or tilts with dance/spin */}
        {astroMsg && (
          <div
            style={{
              position: 'absolute',
              left: 40,
              bottom: ASTRONAUT.length * PX + 12,
              animation: 'moon-msg-bubble-float 3.2s ease-in-out infinite',
            }}
          >
            <SpeechBubbleBlock text={astroMsg.text} />
          </div>
        )}
      </div>

      {/* clawd */}
      <div
        style={{
          position: 'absolute',
          left: 312,
          bottom: 48,
          animation: clawdOuterMsgAnimation
            ?? (clawdBodyMsgAnimation
              ? undefined
              : dj
                ? 'moon-dj-bob 0.52s ease-in-out 0.26s infinite alternate'
                : 'moon-bob-slow 2.6s ease-in-out infinite'),
        }}
      >
        <div
          style={{
            position: 'relative',
            animation: clawdBodyMsgAnimation
              ?? (dj ? undefined : 'moon-wiggle 13s ease-in-out infinite'),
            // hang flips about the center so the sprite stays in place
            transformOrigin: clawdAnim === 'hang' || clawdAnim === 'backflip' ? 'center' : 'bottom center',
          }}
        >
          <PixelSprite rows={CLAWD} />
          {/* nub arms: flap while thinking by day, on the beat at night, message overrides */}
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              animation: clawdAnim === 'wave'
                ? undefined
                : clawdAnim === 'cheer'
                  ? 'moon-nub-flap 0.35s ease-in-out infinite alternate'
                  : dj
                    ? 'moon-nub-flap 0.4s ease-in-out infinite alternate'
                    : 'moon-nub-think 18s ease-in-out 9s infinite',
            }}
          >
            <PixelSprite rows={CLAWD_ARM_L} />
          </div>
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              animation: clawdAnim === 'wave'
                ? 'moon-nub-flap 0.3s ease-in-out infinite alternate'
                : clawdAnim === 'cheer'
                  ? 'moon-nub-flap 0.35s ease-in-out 0.17s infinite alternate'
                  : dj
                    ? 'moon-nub-flap 0.4s ease-in-out 0.2s infinite alternate'
                    : 'moon-nub-think 18s ease-in-out 9.4s infinite',
            }}
          >
            <PixelSprite rows={CLAWD_ARM_R} />
          </div>
          {/* eyelids: blink cycle normally, held shut while sleeping */}
          <div
            style={{
              position: 'absolute',
              left: 0,
              top: 0,
              animation: clawdAnim === 'sleep' ? undefined : 'moon-blink 6s steps(1) infinite',
            }}
          >
            <PixelSprite rows={CLAWD_EYELIDS} />
          </div>
          {/* headphones at night — band arcs over the ears */}
          {dj && (
            <div style={{ position: 'absolute', left: 0, top: -PX }}>
              <PixelSprite rows={HEADPHONES_CLAWD} />
            </div>
          )}
          <MessageOverlaysBlock
            anim={clawdAnim}
            skateboardLeft={16}
            skateboardTop={CLAWD.length * PX - 2}
            hatLeft={15}
            hatTop={-24}
            wandLeft={72}
            wandTop={14}
            tailLeft={-8}
            tailTop={28}
            tailColor="O"
          />
          {/* `>_` thought bubble, offset in time from the astronaut's (day only, idle) */}
          {!dj && !clawdMsg && clawdAnim === 'none' && (
            <div
              style={{
                position: 'absolute',
                left: 58,
                top: -32,
                animation: 'moon-think-bubble 18s ease-in-out 9s infinite',
                opacity: 0,
              }}
            >
              <PixelSprite rows={PROMPT_BUBBLE} px={4} />
            </div>
          )}
        </div>
        {/* scheduled message speech bubble — outside the animated body so the
            text never mirrors or tilts with dance/spin */}
        {clawdMsg && (
          <div
            style={{
              position: 'absolute',
              left: 52,
              bottom: CLAWD.length * PX + 12,
              animation: 'moon-msg-bubble-float 2.6s ease-in-out infinite',
            }}
          >
            <SpeechBubbleBlock text={clawdMsg.text} />
          </div>
        )}
      </div>

      {/* click targets over each sprite — kept tight so they don't swallow
          canvas pan gestures elsewhere; clicking plays a random burst */}
      {[
        { left: 136, bottom: 50, width: 68, height: 78 },
        { left: 308, bottom: 46, width: 88, height: 62 },
      ].map(hit => (
        <div
          key={hit.left}
          onClick={playBurst}
          style={{
            position: 'absolute',
            left: hit.left,
            bottom: hit.bottom,
            width: hit.width,
            height: hit.height,
            pointerEvents: 'auto',
            cursor: 'pointer',
          }}
        />
      ))}
    </div>
  )
}
