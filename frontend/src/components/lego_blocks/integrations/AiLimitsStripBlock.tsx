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
  /** Opens the short how-to for wiring a provider up. */
  onConnect?: (providerId: AiLimitsProviderBlock['id']) => void
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
  onConnect,
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
              onConnect={onConnect}
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

const CONNECT_COPY_BLOCK: Record<AiLimitsProviderBlock['id'], string> = {
  // Claude publishes rate limits through the status line, so there is a real
  // one-time setup step. Say what to do, not that something is missing.
  claude: 'Add a status line to show limits',
  codex: 'Start Codex once to show limits',
}

/**
 * The state most people are in on day one. Occupies the same height as two
 * meters so connecting a provider doesn't shift the page, and reads as an
 * invitation rather than a warning — nothing is broken here.
 */
function ConnectInviteBlock({
  providerId,
  muted,
  heading,
  onConnect,
}: {
  providerId: AiLimitsProviderBlock['id']
  muted: string
  heading: string
  onConnect?: (providerId: AiLimitsProviderBlock['id']) => void
}) {
  const copy = CONNECT_COPY_BLOCK[providerId]

  if (!onConnect) {
    return (
      <p className="flex h-[27px] items-center text-[11px]" style={{ color: muted }}>
        {copy}
      </p>
    )
  }

  return (
    <button
      type="button"
      onClick={() => onConnect(providerId)}
      className="flex h-[27px] items-center rounded text-left text-[11px] underline decoration-dotted underline-offset-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
      style={{ color: muted }}
      onMouseEnter={(event) => {
        event.currentTarget.style.color = heading
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.color = muted
      }}
    >
      {copy}
    </button>
  )
}
