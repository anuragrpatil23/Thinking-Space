import { useUserProfileBlock } from '@/components/lego_blocks/hooks/shared/useUserProfileBlock'
import { useCanvasProjectBindingBlock } from '@/components/lego_blocks/hooks/shared/useCanvasProjectBindingBlock'
import {
  useCanvasThemeBlock,
  type CanvasThemeTokens,
} from '@/components/lego_blocks/hooks/shared/useCanvasThemeBlock'
import { quoteForDay } from '@/services/lego_blocks/units/breakQuotesBlock'

interface HomeWelcomeBlockProps {
  /** Looser vertical rhythm for a host where this block has a screen to
   *  itself (the phone Home): more air above the mission and the quote. */
  airy?: boolean
  /** Rendered on the phone Home's pinned stage: tag the lines so the stage's
   *  scroll-driven CSS can shrink the greeting and fade the rest. */
  stage?: boolean
  /** Show the daily reflection quote under the mission. The spatial canvas
   *  renders the quote inside MoonSceneBlock, so it leaves this off; the flat
   *  (iOS/web) frame has no moon scene and turns it on to keep the warmth. */
  showQuote?: boolean
  /** Override the theme tokens. The flat frame resolves its own theme (which
   *  may follow app color mode instead of time-of-day) and passes it so the
   *  heading/eyebrow colors match the backdrop the flat frame actually paints.
   *  Omitted on the canvas, which falls back to the phase-following hook. */
  theme?: CanvasThemeTokens
}

/**
 * The shared welcome header for Home — eyebrow, "Welcome, {name}", the bound
 * project's mission, and (flat frame only) the day's reflection quote. Both the
 * spatial canvas anchor and the flat iOS/web frame render this exact block so
 * the two homes can never drift on copy again.
 */
export default function HomeWelcomeBlock({ showQuote = false, airy = false, stage = false, theme: themeOverride }: HomeWelcomeBlockProps) {
  const hookTheme = useCanvasThemeBlock()
  const theme = themeOverride ?? hookTheme
  const { profile } = useUserProfileBlock()
  const { project } = useCanvasProjectBindingBlock('home')
  const quote = showQuote ? quoteForDay() : null

  // On the phone Home's stage the lines carry classes that tie them to the
  // scroll: the greeting shrinks and travels, the rest fade. The motion itself
  // is CSS driven by a variable the stage sets (see `.ltm-home-stage` in
  // index.css); this block only says which line is which.
  const fadeClass = stage ? 'ltm-home-fade' : undefined

  return (
    <div style={{ textAlign: 'center', userSelect: 'none' }}>
      <p
        className={fadeClass}
        style={{
          fontSize: 12,
          color: theme.anchorEyebrow,
          letterSpacing: '0.24em',
          textTransform: 'uppercase',
          margin: 0,
        }}
      >
        Thinking Space
      </p>
      <h1
        className={stage ? 'ltm-home-title' : undefined}
        style={{
          fontSize: 36,
          fontWeight: 600,
          color: theme.anchorHeading,
          margin: '10px 0 0',
          letterSpacing: '-0.02em',
        }}
      >
        Welcome, {profile.name}
      </h1>
      {project && project.mission.trim() && (
        <p
          className={fadeClass}
          style={{
            fontSize: 14,
            color: theme.anchorEyebrow,
            // Airy: the greeting, the mission and the quote are three separate
            // beats with the same wide gap between them (positions marked up
            // by the user, 2026-10-08), and the mission is held to a measure
            // about as wide as the scene so it does not run edge to edge.
            maxWidth: airy ? 320 : undefined,
            fontStyle: 'italic',
            lineHeight: 1.5,
            margin: airy ? '68px auto 0' : '12px 0 0',
          }}
        >
          {project.mission}
        </p>
      )}
      {quote && (
        <p
          className={fadeClass}
          style={{
            fontSize: 13,
            color: theme.anchorEyebrow,
            maxWidth: airy ? 300 : 460,
            fontStyle: 'italic',
            lineHeight: 1.5,
            margin: airy ? '68px auto 0' : '18px auto 0',
            // On the stage the fade owns `opacity`, so the quote's resting
            // strength goes in as the value it fades from.
            ...(stage ? { ['--fade-base' as string]: 0.85 } : { opacity: 0.85 }),
          }}
        >
          &ldquo;{quote.text}&rdquo;
          {quote.author && (
            <span style={{ display: 'block', marginTop: 4, fontStyle: 'normal', opacity: 0.8 }}>
              — {quote.author}
            </span>
          )}
        </p>
      )}
    </div>
  )
}
