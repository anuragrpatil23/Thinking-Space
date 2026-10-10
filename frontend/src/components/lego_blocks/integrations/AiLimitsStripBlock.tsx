import { useState } from 'react'
import AiLimitsMeterBlock from '@/components/lego_blocks/units/AiLimitsMeterBlock'
import { useDarkModeClassBlock } from '@/components/lego_blocks/hooks/shared/useDarkModeClassBlock'
import type { AiLimitsProviderBlock } from '@/services/lego_blocks/units/aiLimitsModelBlock'

interface AiLimitsStripBlockProps {
  /** The one provider to show. The section's toggle picks it and names it. */
  provider: AiLimitsProviderBlock
  /**
   * Frozen clock for the whole strip. Supplied by the caller rather than read
   * here so the strip holds no timer of its own — countdowns refresh when new
   * readings arrive, which is often enough for a figure rendered in minutes.
   */
  nowMs: number
  /** Absolute path to the bundled status-line script, from the main process. */
  statusLineScriptPath: string
  /** Whether Claude Code already has a status line, and whose. */
  statusLineMode: 'none' | 'ours' | 'theirs'
}

// The host card's own text colours, so the strip follows whatever surface it
// sits on (day, night phase, dark mode) without being handed a theme.
const HEADING_COLOR_BLOCK = 'hsl(var(--foreground))'
const MUTED_COLOR_BLOCK = 'hsl(var(--muted-foreground))'

/**
 * Where one provider's plan limits stand right now: the session window and the
 * weekly window, side by side on one line.
 *
 * It has been three things. A separate card above AI activity read as a second
 * subject for what is one — the limit is the budget, the activity is the
 * spend. Moved inside the card's "Plan usage" section with both providers in
 * two columns, it was eight figures, four bars and two reset dates above a
 * chart that then named the providers again. Now the section's toggle picks one
 * provider for the meters and the chart together, so nothing is said twice and
 * the strip needs no name, no heading and no card of its own.
 */
export default function AiLimitsStripBlock({
  provider,
  nowMs,
  statusLineScriptPath,
  statusLineMode,
}: AiLimitsStripBlockProps) {
  const { hostRef, isDark } = useDarkModeClassBlock()
  const heading = HEADING_COLOR_BLOCK
  const muted = MUTED_COLOR_BLOCK

  return (
    <div ref={hostRef} role="group" aria-label={`${provider.label} usage limits`}>
      {provider.state === 'unconfigured' ? (
        <ConnectInviteBlock
          providerId={provider.id}
          muted={muted}
          heading={heading}
          isDark={isDark}
          statusLineScriptPath={statusLineScriptPath}
          statusLineMode={statusLineMode}
        />
      ) : (
        <div className="grid gap-x-12 gap-y-2 sm:grid-cols-2">
          <AiLimitsMeterBlock
            providerId={provider.id}
            kind="session"
            window={provider.session}
            isDark={isDark}
            mutedColor={muted}
            textColor={heading}
            nowMs={nowMs}
          />
          <AiLimitsMeterBlock
            providerId={provider.id}
            kind="weekly"
            window={provider.weekly}
            isDark={isDark}
            mutedColor={muted}
            textColor={heading}
            nowMs={nowMs}
          />
        </div>
      )}
    </div>
  )
}

/**
 * The one-time setup for Claude, as a command to run verbatim — which one
 * depends on whether the person already has a status line.
 *
 * Only one status line can be configured, so telling someone with an existing
 * one to point Claude Code at ours would silently destroy their branch, context
 * meter, whatever they built. That is a trap, not an instruction. So when they
 * have one, the card asks their Claude to *add* the bridge write to the script
 * they already have and leave its output alone.
 *
 * With no status line there is nothing to lose, and ours can be used directly —
 * the bridge is our contract (path, shape, atomic write), so shipping the
 * script beats describing it and hoping.
 */
function claudeSetupCommandBlock(
  mode: 'none' | 'ours' | 'theirs',
  scriptPath: string,
): string {
  if (mode === 'theirs') {
    return `/statusline keep my current status line output exactly as it is, and also write the raw stdin JSON to ~/.thinking-space/claude-limits.json using write-then-rename`
  }
  // Quoted, always. Claude Code runs `statusLine.command` through a shell, and
  // the app's own bundle path contains a space ("Thinking Space.app") — bare,
  // the shell splits it at /Applications/Thinking and the script silently never
  // runs, which looks exactly like the feature not working.
  return `/statusline use "${scriptPath}"`
}

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
  statusLineScriptPath,
  statusLineMode,
}: {
  providerId: AiLimitsProviderBlock['id']
  muted: string
  heading: string
  isDark: boolean
  statusLineScriptPath: string
  statusLineMode: 'none' | 'ours' | 'theirs'
}) {
  const [copied, setCopied] = useState(false)
  const command = claudeSetupCommandBlock(statusLineMode, statusLineScriptPath)

  if (providerId !== 'claude') {
    return (
      <p className="flex h-[27px] items-center text-[11px]" style={{ color: muted }}>
        Start Codex once to show limits
      </p>
    )
  }

  const copyCommand = (): void => {
    void navigator.clipboard
      ?.writeText(command)
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
        {statusLineMode === 'theirs'
          ? 'You already have a status line. Run this in Claude Code to add usage sharing to it — your own output stays exactly as it is:'
          : 'Claude Code shares its limits through a status line. The script is ready — run this in Claude Code once:'}
      </p>
      <button
        type="button"
        onClick={copyCommand}
        title="Copy this command"
        className="w-full rounded break-all px-2 py-1 text-left font-mono text-[10.5px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
        style={{
          color: heading,
          background: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(28,25,23,0.05)',
        }}
      >
        {command}
      </button>
      <p className="text-[10.5px]" style={{ color: muted }}>
        {copied ? 'Copied' : 'Click to copy · then send one message'}
      </p>
    </div>
  )
}
