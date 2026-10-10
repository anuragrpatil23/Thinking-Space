import { useState } from 'react'
import AiLimitsMeterBlock from '@/components/lego_blocks/units/AiLimitsMeterBlock'
import { useDarkModeClassBlock } from '@/components/lego_blocks/hooks/shared/useDarkModeClassBlock'
import {
  formatUpdatedAgoBlock,
  type AiLimitsProviderBlock,
} from '@/services/lego_blocks/units/aiLimitsModelBlock'

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
  /** The Connect button; resolves false when the settings could not be changed. */
  onConnectClaude: () => Promise<boolean>
  /** Undo for the Connect button. */
  onDisconnectClaude: () => Promise<boolean>
}

// The host card's own text colours, so the strip follows whatever surface it
// sits on (day, night phase, dark mode) without being handed a theme.
const HEADING_COLOR_BLOCK = 'hsl(var(--foreground))'
const MUTED_COLOR_BLOCK = 'hsl(var(--muted-foreground))'

/**
 * Where one provider's plan limits stand right now: the session window and the
 * weekly window, side by side on one line — session on the left, weekly on the
 * right in two equal halves, each a name over one short row.
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
  onConnectClaude,
  onDisconnectClaude,
}: AiLimitsStripBlockProps) {
  const { hostRef, isDark } = useDarkModeClassBlock()
  const heading = HEADING_COLOR_BLOCK
  const muted = MUTED_COLOR_BLOCK
  // How old the figures are, always shown — even at a minute. It is the age
  // of the provider's own report, not of our read: the line this replaced said
  // "Updated just now" whenever the app had just re-read a file that could be
  // hours old.
  const asOf =
    provider.asOfMs != null ? `as of ${formatUpdatedAgoBlock(provider.asOfMs, nowMs)}` : null

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
          onConnect={onConnectClaude}
          onDisconnect={onDisconnectClaude}
        />
      ) : (
        // Two equal halves, so the week starts at the card's midline whatever
        // the session's figures measure — packed to the left, the pair left
        // the right half of the section empty.
        <div className="grid gap-x-12 gap-y-5 sm:grid-cols-2">
          {(['session', 'weekly'] as const).map(kind => (
            <AiLimitsMeterBlock
              key={kind}
              providerId={provider.id}
              kind={kind}
              window={provider[kind]}
              isDark={isDark}
              mutedColor={muted}
              textColor={heading}
              nowMs={nowMs}
              // On the week's caption line: the right-hand half, so the note
              // lands in the section's top-right corner.
              trailing={kind === 'weekly' ? asOf : null}
            />
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * The one-time setup for Claude as a command to run verbatim — the fallback
 * when the Connect button could not change the settings. Which one depends on
 * whether the person already has a status line.
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
 * The state most people are in on day one: Claude Code is installed and has
 * not been asked to share its numbers yet.
 *
 * One button. The first version handed over a `/statusline` command to paste
 * into Claude Code — a setup step in another program, for a feature Codex gives
 * for free — so the app now makes that change itself, and only when asked: the
 * line above the button says what will change before it does. Someone with a
 * status line of their own is told theirs stays, because only one can run and
 * the button wraps it rather than replacing it.
 *
 * The pasted command survives as the fallback for the one case the button
 * cannot handle — a settings file the app could not safely rewrite.
 */
function ConnectInviteBlock({
  providerId,
  muted,
  heading,
  isDark,
  statusLineScriptPath,
  statusLineMode,
  onConnect,
  onDisconnect,
}: {
  providerId: AiLimitsProviderBlock['id']
  muted: string
  heading: string
  isDark: boolean
  statusLineScriptPath: string
  statusLineMode: 'none' | 'ours' | 'theirs'
  onConnect: () => Promise<boolean>
  onDisconnect: () => Promise<boolean>
}) {
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [copied, setCopied] = useState(false)

  if (providerId !== 'claude') {
    return (
      <p className="text-[11px]" style={{ color: muted }}>
        Start Codex once to show limits
      </p>
    )
  }

  const run = (action: () => Promise<boolean>): void => {
    if (busy) return
    setBusy(true)
    setFailed(false)
    void action()
      .then(ok => setFailed(!ok))
      .catch(() => setFailed(true))
      .finally(() => setBusy(false))
  }

  const quietButton =
    'rounded underline decoration-dotted underline-offset-2 transition-opacity hover:opacity-70 ' +
    'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-current disabled:opacity-50'

  // Connected, and Claude Code has not rendered a status line since — it only
  // publishes its limits with the first reply of a session.
  if (statusLineMode === 'ours' && !failed) {
    return (
      <p className="text-[11px] leading-snug" style={{ color: muted }}>
        Connected. Send a message in Claude Code and your limits appear here.{' '}
        <button
          type="button"
          disabled={busy}
          onClick={() => run(onDisconnect)}
          className={quietButton}
        >
          Undo
        </button>
      </p>
    )
  }

  if (failed) {
    const command = claudeSetupCommandBlock(statusLineMode, statusLineScriptPath)
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
      <div className="max-w-xl space-y-1.5">
        <p className="text-[11px] leading-snug" style={{ color: muted }}>
          Thinking Space could not change Claude Code's settings file, so nothing was changed. Run
          this in Claude Code instead:
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

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <p className="max-w-md text-[11px] leading-snug" style={{ color: muted }}>
        {statusLineMode === 'theirs'
          ? 'See your Claude session and weekly limits here. Connecting adds usage sharing to the status line you already have in Claude Code; what it shows stays exactly as it is.'
          : "See your Claude session and weekly limits here. Connecting adds a status line to Claude Code's settings."}
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={() => run(onConnect)}
        className="shrink-0 rounded-md px-3 py-1.5 text-[11px] font-medium leading-none transition-opacity hover:opacity-85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current disabled:opacity-50"
        style={{
          color: heading,
          background: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(28,25,23,0.07)',
        }}
      >
        {busy ? 'Connecting…' : 'Connect Claude'}
      </button>
    </div>
  )
}
