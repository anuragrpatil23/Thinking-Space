import { useState } from 'react'
import { SettingsGroupBlock, SettingsRowBlock } from '@/components/lego_blocks/units/SettingsGroupBlock'
import { Button } from '@/components/lego_blocks/units/ui/button'
import { useAiPlanUsageBlock } from '@/components/lego_blocks/hooks/shared/useAiPlanUsageBlock'

/**
 * The permanent home of the Claude connection: connect it, or take it back out.
 *
 * The Plan usage section offers Connect while there is nothing to show, and an
 * Undo only until the first reading arrives — after that the section is meters
 * and has no room to say "this changed a setting in another program". This row
 * is where that stays findable for as long as it is true.
 *
 * Renders nothing where the feature cannot exist: off the desktop app, or on a
 * machine without Claude Code.
 */
export default function AiActivityPlanUsageSettingsBlock() {
  const planUsage = useAiPlanUsageBlock()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  const claude = planUsage.providers.find(provider => provider.id === 'claude')
  if (!claude?.detected) return null

  const connected = planUsage.statusLineMode === 'ours'
  const run = (action: () => Promise<boolean>): void => {
    if (busy) return
    setBusy(true)
    setFailed(false)
    void action()
      .then(ok => setFailed(!ok))
      .catch(() => setFailed(true))
      .finally(() => setBusy(false))
  }

  const description = failed
    ? "Thinking Space could not change Claude Code's settings file, so nothing was changed."
    : connected
      ? "Connected. Claude Code shares your session and weekly limits through its status line, set in ~/.claude/settings.json. Disconnecting puts that setting back as it was before."
      : planUsage.statusLineMode === 'theirs'
        ? 'Not connected. Connecting adds usage sharing to the status line you already have in Claude Code; what it shows stays exactly as it is.'
        : "Not connected. Connecting adds a status line to Claude Code's settings so your session and weekly limits show in AI activity."

  return (
    <SettingsGroupBlock
      heading="Plan usage"
      description="Session and weekly limits in the AI activity card. Codex needs no setup."
    >
      <SettingsRowBlock
        label="Claude Code"
        description={description}
        control={(
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 text-xs"
            disabled={busy}
            onClick={() => run(connected ? planUsage.disconnectClaude : planUsage.connectClaude)}
          >
            {connected ? 'Disconnect' : 'Connect'}
          </Button>
        )}
      />
    </SettingsGroupBlock>
  )
}
