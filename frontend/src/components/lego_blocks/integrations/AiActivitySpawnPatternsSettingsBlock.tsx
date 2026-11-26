// Settings ▸ AI activity ▸ Agent sessions: the phrasings that mark a session as
// launched by another session or a script (so its time is the agents', not
// yours). The `[spawned-by: …]` kickoff tag is always recognised; this list is
// for sessions started before a launcher adopted that tag.

import { useState } from 'react'
import { SettingsGroupBlock, SettingsRowBlock } from '@/components/lego_blocks/units/SettingsGroupBlock'
import { Button } from '@/components/lego_blocks/units/ui/button'
import {
  readAiActivitySpawnPatternsBlock,
  writeAiActivitySpawnPatternsBlock,
} from '@/services/lego_blocks/units/aiActivitySpawnPatternsBlock'
import { clearAiActivitySnapshot } from '@/services/lego_blocks/integrations/aiActivityCacheBlock'

export default function AiActivitySpawnPatternsSettingsBlock() {
  const [saved, setSaved] = useState(() => readAiActivitySpawnPatternsBlock().join('\n'))
  const [draft, setDraft] = useState(saved)
  const dirty = draft !== saved

  const save = () => {
    const next = writeAiActivitySpawnPatternsBlock(draft.split('\n'))
    // Only files whose verdict flips are re-parsed on the next load; dropping
    // the in-memory snapshot is what makes that load happen now.
    clearAiActivitySnapshot()
    const text = next.join('\n')
    setSaved(text)
    setDraft(text)
  }

  return (
    <SettingsGroupBlock
      heading="Agent sessions"
      description={(
        <>
          A session another session or a script started counts as agents' time, not yours. Launchers should put{' '}
          <code className="text-[11px]">[spawned-by: &lt;parent&gt; via &lt;script&gt;]</code> on the first line of the
          prompt; that is always recognised. For sessions started before that, list how their first prompt begins — one
          per line, matched from the start, ignoring case.
        </>
      )}
    >
      <SettingsRowBlock stacked className="gap-2">
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          rows={3}
          placeholder={'Read the brief at\nRead your brief at'}
          className="w-full resize-y rounded-md border border-border/60 bg-background px-2 py-1.5 font-mono text-[12px] text-foreground outline-none focus:border-foreground/30"
          aria-label="First-prompt beginnings that mark a spawned session"
        />
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" disabled={!dirty} onClick={() => setDraft(saved)}>
            Revert
          </Button>
          <Button size="sm" disabled={!dirty} onClick={save}>
            Save
          </Button>
        </div>
      </SettingsRowBlock>
    </SettingsGroupBlock>
  )
}
