import { useUserProfileBlock } from '@/components/lego_blocks/hooks/shared/useUserProfileBlock'
import { useCanvasProjectBindingBlock } from '@/components/lego_blocks/hooks/shared/useCanvasProjectBindingBlock'
import {
  useCanvasThemeBlock,
  type CanvasThemeTokens,
} from '@/components/lego_blocks/hooks/shared/useCanvasThemeBlock'
import { quoteForDay } from '@/services/lego_blocks/units/breakQuotesBlock'

interface HomeWelcomeBlockProps {
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
export default function HomeWelcomeBlock({ showQuote = false, theme: themeOverride }: HomeWelcomeBlockProps) {
  const hookTheme = useCanvasThemeBlock()
  const theme = themeOverride ?? hookTheme
  const { profile } = useUserProfileBlock()
  const { project } = useCanvasProjectBindingBlock('home')
  const quote = showQuote ? quoteForDay() : null

  return (
    <div style={{ textAlign: 'center', userSelect: 'none' }}>
      <p
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
          style={{
            fontSize: 14,
            color: theme.anchorEyebrow,
            margin: '12px 0 0',
            fontStyle: 'italic',
            lineHeight: 1.5,
          }}
        >
          {project.mission}
        </p>
      )}
      {quote && (
        <p
          style={{
            fontSize: 13,
            color: theme.anchorEyebrow,
            margin: '18px auto 0',
            maxWidth: 460,
            fontStyle: 'italic',
            lineHeight: 1.5,
            opacity: 0.85,
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
