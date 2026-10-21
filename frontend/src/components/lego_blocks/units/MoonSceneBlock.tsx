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
import {
  ASTRONAUT,
  ASTRONAUT_ARM_L,
  ASTRONAUT_ARM_R,
  DISCO_BALL,
  DISCO_SHINE,
  DJ_DECK,
  DJ_DISC_DOTS,
  FLAG,
  HEADPHONES_ASTRO,
  noteRows,
  PALETTE,
  PX,
  sparkleRows,
  THINK_BUBBLE,
  THINK_DOT,
} from '@/services/lego_blocks/units/moonSpritesBlock'
import PixelSprite from '@/components/lego_blocks/units/MoonPixelSpriteBlock'
import SpeechBubbleBlock from '@/components/lego_blocks/units/MoonSpeechBubbleBlock'
import MoonClawdBlock from '@/components/lego_blocks/units/MoonClawdBlock'
import MoonMessageOverlaysBlock from '@/components/lego_blocks/units/MoonMessageOverlaysBlock'
import MoonSceneKeyframesBlock from '@/components/lego_blocks/units/MoonSceneKeyframesBlock'
import { MSG_BODY_ANIMATION, MSG_OUTER_ANIMATION } from '@/services/lego_blocks/units/moonSceneMotionBlock'


export default function MoonSceneBlock({ x, y, showQuote = true }: { x: number; y: number; showQuote?: boolean }) {
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
  const astroOuterMsgAnimation = MSG_OUTER_ANIMATION[astroAnim]

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
        // Own compositing layer. Without this the scene's ~18 infinite
        // animations repaint into the shared canvas world layer, which is
        // 4500x4500 (docs/contracts/ENERGY.md) — so a 520x240 pixel-art scene
        // dirties a 20-megapixel surface 60 times a second, and every sprite
        // is a 1px div carrying up to 100 box-shadow entries to re-rasterize.
        // Measured 2026-08-11: moon on screen 35.7% GPU, off screen 1.8%.
        // A layer of its own confines the invalidation to this box.
        //
        // This is a rendering hint only — no keyframe, timing, geometry, or
        // paint order changes, so the scene is pixel-identical.
        willChange: 'transform',
      }}
    >
      <MoonSceneKeyframesBlock />

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
          Colors flip for the light (day/golden) vs dark (night/late) backdrop.
          The flat (iOS/web) frame passes showQuote=false: its scene wrapper
          clips at the sprite bounds, so this canvas-space float would land
          under the status bar — HomeWelcomeBlock renders the quote in-flow
          there instead. */}
      {showQuote && (
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
      )}

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
          <MoonMessageOverlaysBlock
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
      <MoonClawdBlock
        anim={clawdAnim}
        dj={dj}
        message={clawdMsg?.text ?? null}
        style={{ position: 'absolute', left: 312, bottom: 48 }}
      />

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
