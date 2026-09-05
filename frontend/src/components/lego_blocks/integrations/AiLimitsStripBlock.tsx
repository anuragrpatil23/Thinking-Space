import { useState } from 'react'
import AiLimitsMeterBlock from '@/components/lego_blocks/units/AiLimitsMeterBlock'
import type { CanvasThemeTokens } from '@/components/lego_blocks/hooks/shared/useCanvasThemeBlock'
import {
  accentForBlock,
  visibleProvidersBlock,
  type AiLimitsProviderBlock,
} from '@/services/lego_blocks/units/aiLimitsModelBlock'

interface AiLimitsStripBlockProps {
  providers: AiLimitsProviderBlock[]
  theme: CanvasThemeTokens
  /**
   * Frozen clock for the whole strip. Supplied by the caller rather than read
   * here so the strip holds no timer of its own — countdowns refresh when new
   * readings arrive, which is often enough for a figure rendered in minutes.
   */
  nowMs: number
}

/**
 * Usage limits for every AI provider the person actually uses, as a card above
 * the activity panel.
 *
 * Carries the same card treatment as the panels below so the home page reads as
 * one stack. Inside it stays quiet — a dot, a name, and two hairline meters —
 * because this is ambient status: legible at a glance, forgettable the rest of
 * the time.
 */
export default function AiLimitsStripBlock({
  providers,
  theme,
  nowMs,
}: AiLimitsStripBlockProps) {
  const visible = visibleProvidersBlock(providers)
  // Renders its own card rather than being wrapped by the caller, so a strip
  // with nothing to show leaves no empty panel behind on the page.
  if (visible.length === 0) return null

  const heading = theme.anchorHeading
  const muted = theme.anchorEyebrow

  return (
    <section
      aria-label="AI usage limits"
      // Matches the activity cards below (radius 14, padding 20, same surface)
      // so the home page reads as one stack of panels rather than a panel with
      // a loose row floating above it.
      style={{
        borderRadius: 14,
        padding: 20,
        background: theme.anchorPanelBg,
        border: `1px solid ${theme.anchorPanelBorder}`,
        boxShadow: theme.anchorPanelShadow,
      }}
    >
      {/* Same heading treatment as the activity card below, so the two read as
          siblings. The subtitle carries real weight here: "AI Plan usage" and "AI
          activity" are near neighbours in a stack, and "Session and weekly" is
          what marks this card as plan windows rather than history. It also names
          the two rows in the order they appear, which is how they're told apart
          now that the windows carry no inline labels. */}
      <div className="mb-4">
        <h3 className="text-base font-semibold text-foreground">AI Plan usage</h3>
        <p className="text-xs text-muted-foreground">Session and weekly</p>
      </div>

      <div
        // One provider gets the full width rather than a half-empty two-column
        // grid, so someone who only uses one tool sees a deliberate row instead
        // of a gap where the other tool would have been.
        className={`grid gap-x-10 gap-y-5 ${visible.length > 1 ? 'sm:grid-cols-2' : ''}`}
      >
        {visible.map((provider) => (
        <div key={provider.id} className="min-w-0">
          <div className="mb-2 flex items-baseline gap-2">
            <span
              aria-hidden
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{ background: accentForBlock(provider.id, theme.isDark) }}
            />
            <span className="text-[12px] font-medium tracking-tight" style={{ color: heading }}>
              {provider.label}
            </span>
            {provider.plan && (
              <span className="truncate text-[11px]" style={{ color: muted }}>
                {provider.plan}
              </span>
            )}
          </div>

          {provider.state === 'unconfigured' ? (
            <ConnectInviteBlock
              providerId={provider.id}
              muted={muted}
              heading={heading}
              isDark={theme.isDark}
            />
          ) : (
            <div className="space-y-1.5">
              <AiLimitsMeterBlock
                providerId={provider.id}
                kind="session"
                window={provider.session}
                isDark={theme.isDark}
                mutedColor={muted}
                textColor={heading}
                nowMs={nowMs}
              />
              <AiLimitsMeterBlock
                providerId={provider.id}
                kind="weekly"
                window={provider.weekly}
                isDark={theme.isDark}
                mutedColor={muted}
                textColor={heading}
                nowMs={nowMs}
              />
            </div>
          )}
          </div>
        ))}
      </div>
    </section>
  )
}

/**
 * The one-time setup for Claude, as a command the user can run verbatim.
 *
 * `/statusline` on its own writes a status line but not the file this card
 * reads, so the instruction has to carry that requirement — passing it as the
 * command's argument lets Claude Code write the script itself, which is a lot
 * less to ask than "hand-write this bash".
 */
const CLAUDE_SETUP_COMMAND_BLOCK =
  '/statusline also write .rate_limits to ~/.thinking-space/claude-limits.json'

/**
 * The state most people are in on day one.
 *
 * Reads as an invitation rather than a warning — nothing is broken here, the
 * provider simply hasn't been asked to share its numbers yet. For Claude that
 * means a real one-time step, so the card hands over the exact command instead
 * of describing the outcome and leaving the user to work out how.
 */
function ConnectInviteBlock({
  providerId,
  muted,
  heading,
  isDark,
}: {
  providerId: AiLimitsProviderBlock['id']
  muted: string
  heading: string
  isDark: boolean
}) {
  const [copied, setCopied] = useState(false)

  if (providerId !== 'claude') {
    return (
      <p className="flex h-[27px] items-center text-[11px]" style={{ color: muted }}>
        Start Codex once to show limits
      </p>
    )
  }

  const copyCommand = (): void => {
    void navigator.clipboard
      ?.writeText(CLAUDE_SETUP_COMMAND_BLOCK)
      .then(() => {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1600)
      })
      .catch(() => {
        // Clipboard can be refused; the command is on screen either way.
      })
  }

  return (
    <div className="space-y-1.5">
      <p className="text-[11px] leading-snug" style={{ color: muted }}>
        Claude Code shares its limits through a status line. Run this in Claude Code once:
      </p>
      <button
        type="button"
        onClick={copyCommand}
        title="Copy this command"
        className="w-full truncate rounded px-2 py-1 text-left font-mono text-[10.5px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
        style={{
          color: heading,
          background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(28,25,23,0.05)',
        }}
      >
        {CLAUDE_SETUP_COMMAND_BLOCK}
      </button>
      <p className="text-[10.5px]" style={{ color: muted }}>
        {copied ? 'Copied' : 'Click to copy · then send one message'}
      </p>
    </div>
  )
}
