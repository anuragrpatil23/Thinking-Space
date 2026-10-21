import type { CSSProperties } from 'react'
import PixelSprite from '@/components/lego_blocks/units/MoonPixelSpriteBlock'
import MoonMessageOverlaysBlock from '@/components/lego_blocks/units/MoonMessageOverlaysBlock'
import SpeechBubbleBlock from '@/components/lego_blocks/units/MoonSpeechBubbleBlock'
import {
  CLAWD,
  CLAWD_ARM_L,
  CLAWD_ARM_R,
  CLAWD_EYELIDS,
  HEADPHONES_CLAWD,
  PROMPT_BUBBLE,
  PX,
} from '@/services/lego_blocks/units/moonSpritesBlock'
import { MSG_BODY_ANIMATION, MSG_OUTER_ANIMATION } from '@/services/lego_blocks/units/moonSceneMotionBlock'
import type { MoonSceneAnimationBlock } from '@/services/lego_blocks/units/vaultUiPreferencesBlock'

/* Clawd, the Claude Code mascot, as the Home moon scene draws him: body,
   flapping nub arms, blinking eyelids, the message-animation props, and an
   optional speech bubble. Drawn at the scene's pixel size; a smaller place
   (the explorer) scales the whole figure rather than redrawing it, so every
   animation keeps working unchanged. Needs MoonSceneKeyframesBlock on the
   page. `idle` plays the scene's resting life (bob, wiggle, thinking);
   without it he stands still between animations. */
export default function MoonClawdBlock({
  anim,
  dj = false,
  message = null,
  idle = true,
  style,
}: {
  anim: MoonSceneAnimationBlock
  dj?: boolean
  message?: string | null
  idle?: boolean
  style?: CSSProperties
}) {
  const clawdAnim = anim
  const clawdBodyMsgAnimation = MSG_BODY_ANIMATION[clawdAnim]
  const clawdOuterMsgAnimation = MSG_OUTER_ANIMATION[clawdAnim]
  return (
    <>
      <div
        style={{
          ...style,
          animation: clawdOuterMsgAnimation
            ?? (clawdBodyMsgAnimation
              ? undefined
              : dj
                ? 'moon-dj-bob 0.52s ease-in-out 0.26s infinite alternate'
                : idle ? 'moon-bob-slow 2.6s ease-in-out infinite' : undefined),
        }}
      >
        <div
          style={{
            position: 'relative',
            animation: clawdBodyMsgAnimation
              ?? (dj || !idle ? undefined : 'moon-wiggle 13s ease-in-out infinite'),
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
                    : idle ? 'moon-nub-think 18s ease-in-out 9s infinite' : undefined,
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
                    : idle ? 'moon-nub-think 18s ease-in-out 9.4s infinite' : undefined,
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
              animation: clawdAnim === 'sleep' || !idle ? undefined : 'moon-blink 6s steps(1) infinite',
              /* The lids are drawn shut; the blink loop is what keeps them
                 open between blinks. Without idle life there is no loop, so
                 they are hidden outright — otherwise he stands there with his
                 eyes closed. Sleep still shows them. */
              opacity: !idle && clawdAnim !== 'sleep' ? 0 : undefined,
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
          <MoonMessageOverlaysBlock
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
          {idle && !dj && !message && clawdAnim === 'none' && (
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
        {message && (
          <div
            style={{
              position: 'absolute',
              left: 52,
              bottom: CLAWD.length * PX + 12,
              animation: 'moon-msg-bubble-float 2.6s ease-in-out infinite',
            }}
          >
            <SpeechBubbleBlock text={message} />
          </div>
        )}
      </div>
    </>
  )
}
