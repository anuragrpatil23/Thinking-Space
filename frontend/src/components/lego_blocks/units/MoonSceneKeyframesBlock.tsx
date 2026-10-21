import { PX } from '@/services/lego_blocks/units/moonSpritesBlock'

/* Every keyframe the moon scene's characters use — idle bob and wiggle, the
   message animations (wave, skate, dance, wizard, …), bubbles. Rendered by
   the Home scene and by anywhere else a moon character appears (the
   explorer's Clawd), so they all move the same way. */
export default function MoonSceneKeyframesBlock() {
  return (
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
  )
}
