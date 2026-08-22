/**
 * ThinkingOrbBlock — the app's one mark for "a model is working on this, now".
 *
 * Thin wrapper over `thinking-orbs` (MIT, no runtime deps, 2D canvas). The
 * wrapper exists for three reasons, none of them styling:
 *
 *  1. **One chokepoint.** If the dependency is swapped, lazy-loaded, or dropped,
 *     it changes here and not at every call site.
 *  2. **Size discipline.** The package ships exactly two tuned designs, 20 and
 *     64 — they are separate hand-tuned dot layouts, not a scale factor. The
 *     `OrbSize` union already enforces that; the default here is 20 because
 *     every current consumer is inline with text.
 *  3. **Somewhere to put the vocabulary.** See below — the states mean things,
 *     and picking one is a decision, not a style choice.
 *
 * ## The vocabulary rule
 *
 * The orb is deliberately scarce. It is the only moving element in the AI
 * Activity table, and that is what makes it legible: it means *this row is in
 * the present tense*. Two states are in use, and each answers a question the
 * surrounding UI genuinely cannot:
 *
 *   `breathing` — the session is still live, so no digest exists yet.
 *                 `aiActivitySessionDigestOrch` refuses to summarise an
 *                 unsettled session (see aiActivityLivenessBlock), so the row
 *                 falls back to the raw first-message topic. Without a mark,
 *                 that row just looks worse than its neighbours for no visible
 *                 reason.
 *   `composing` — a digest is being (re)generated. The stale title and summary
 *                 stay on screen while the model runs, so without a mark you
 *                 cannot tell whether the text you are reading is the old
 *                 answer or the new one.
 *
 * Do NOT reach for the other seven to decorate a spinner. A transient
 * button-press ("saving", "refreshing") is served better by `animate-spin` at
 * 10px, and every extra orb costs the two above their meaning. A rejected
 * survey of the alternatives, and why the work-mix heatmap cell in particular
 * must not get one, is in docs/reference/KEY-BLOCKS.md.
 *
 * ## Energy
 *
 * Satisfies the ENERGY contract without patching: the package gates its own
 * rAF loop on an `IntersectionObserver` (offscreen orbs do not animate) and
 * renders exactly one static frame under `prefers-reduced-motion`, never
 * starting the loop at all. Live sessions are rare by construction — the
 * settle window is 10 minutes — so the steady state is zero animating canvases.
 *
 * Theme needs no wiring: `theme="auto"` watches for the `dark` class on an
 * ancestor via MutationObserver, which is the convention this app already uses.
 *
 * ## Why the dependency is code-split
 *
 * `AiActivityDayTableBlock` is statically reachable from the entry (HomeFlatOrch
 * and HomeAnchorTileBlock both import the panel eagerly), so a static import
 * here lands the package in the startup bundle. Measured: entry 2,442.48 kB →
 * 2,458.41 kB, +15.93 kB, which crosses the 2.4 MB budget in
 * docs/contracts/STARTUP-PERFORMANCE.md by ~0.8 kB.
 *
 * Note the package cannot be tree-shaken down to the states actually used:
 * `engine/registry.ts` builds `MODE_DRAWS` at runtime via `Object.fromEntries`
 * over every geometry, so importing one mode retains all nine. The whole
 * package is the unit, and the only lever is *when* it loads.
 *
 * Splitting it is the right answer regardless of the budget: the orb renders
 * only for live or regenerating rows, which is the rare case, so it has no
 * business in the payload that gates first paint. `fallback={null}` because the
 * orb occupies ~20px inline — a spinner-for-the-spinner would be worse than the
 * brief nothing, and the row reads fine without it for one chunk fetch.
 */

import { Suspense, lazy } from 'react'
import type { OrbSize, OrbState } from 'thinking-orbs'
import { cn } from '@/lib/utils'

const ThinkingOrb = lazy(() =>
  import('thinking-orbs').then(m => ({ default: m.ThinkingOrb })),
)

interface ThinkingOrbBlockProps {
  /** Which state to show. Keep to the two documented above unless you are
   *  adding a genuinely new persistent state — see the vocabulary rule. */
  state: OrbState
  /** 20 (inline with text) or 64 (hero). Defaults to 20. */
  size?: OrbSize
  /** Freeze on the current frame — for "something could be live here, but
   *  isn't" affordances that should hold their space without moving. */
  paused?: boolean
  /** Screen-reader text. Required: the orb is never decorative where it is
   *  used — it always carries state the visual UI does not otherwise say. */
  label: string
  className?: string
}

export default function ThinkingOrbBlock({
  state,
  size = 20,
  paused = false,
  label,
  className,
}: ThinkingOrbBlockProps) {
  return (
    <Suspense fallback={null}>
      <ThinkingOrb
        state={state}
        size={size}
        paused={paused}
        theme="auto"
        role="img"
        aria-label={label}
        className={cn('shrink-0 align-middle', className)}
      />
    </Suspense>
  )
}
