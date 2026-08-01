import { useEffect, useState } from 'react'
import { SettingsGroupBlock, SettingsRowBlock } from '@/components/lego_blocks/units/SettingsGroupBlock'
import { Button } from '@/components/lego_blocks/units/ui/button'
import { Switch } from '@/components/lego_blocks/units/ui/switch'
import {
  getGoodnotesAnnotationGate,
  getGoodnotesReadingEnabled,
  setGoodnotesAnnotationGate,
  setGoodnotesReadingEnabled,
} from '@/services/lego_blocks/units/storageKeyBlock'
import {
  getVaultWriteAiActivityEnabled,
  getVaultWriteAiRawEnabled,
  isVaultWritePrefsAvailable,
  setVaultWriteAiActivityEnabled,
  setVaultWriteAiRawEnabled,
} from '@/services/lego_blocks/units/vaultWritePrefsBlock'
import {
  getNativeAiSessionRoots,
  setNativeAiSessionRoots,
  type NativeAiSessionRoots,
} from '@/services/lego_blocks/integrations/nativeAiSessionsBlock'
import {
  DEFAULT_VAULT_SESSION_PREFIXES,
  readVaultSessionPrefixesBlock,
  writeVaultSessionPrefixesBlock,
} from '@/services/lego_blocks/units/aiActivitySourcesBlock'
import { clearAiActivitySnapshot } from '@/services/lego_blocks/integrations/aiActivityCacheBlock'

export default function AiActivitySessionSourcesSettingsBlock() {
  const [roots, setRoots] = useState<NativeAiSessionRoots | null>(null)
  const [rootsUnavailable, setRootsUnavailable] = useState(false)
  const [prefixes, setPrefixes] = useState<string[]>(() => readVaultSessionPrefixesBlock())
  const [annotationGate, setAnnotationGate] = useState<boolean>(() => getGoodnotesAnnotationGate())
  const [readingEnabled, setReadingEnabled] = useState<boolean>(() => getGoodnotesReadingEnabled())
  const vaultWritePrefsAvailable = isVaultWritePrefsAvailable()
  const [writeAiRaw, setWriteAiRaw] = useState<boolean | null>(null)
  const [writeAiActivity, setWriteAiActivity] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)

  const toggleAnnotationGate = (checked: boolean) => {
    setGoodnotesAnnotationGate(checked)
    setAnnotationGate(checked)
    clearAiActivitySnapshot()
  }

  const toggleReadingEnabled = (checked: boolean) => {
    setGoodnotesReadingEnabled(checked)
    setReadingEnabled(checked)
    clearAiActivitySnapshot()
  }

  useEffect(() => {
    let cancelled = false
    void getNativeAiSessionRoots().then(result => {
      if (cancelled) return
      if (result) setRoots(result)
      else setRootsUnavailable(true)
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!vaultWritePrefsAvailable) return
    let cancelled = false
    void Promise.all([
      getVaultWriteAiRawEnabled(),
      getVaultWriteAiActivityEnabled(),
    ]).then(([rawValue, activityValue]) => {
      if (cancelled) return
      setWriteAiRaw(rawValue)
      setWriteAiActivity(activityValue)
    })
    return () => { cancelled = true }
  }, [vaultWritePrefsAvailable])

  const toggleWriteAiRaw = async (checked: boolean) => {
    setWriteAiRaw(checked)
    try {
      await setVaultWriteAiRawEnabled(checked)
    } catch (err) {
      setWriteAiRaw(!checked)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const toggleWriteAiActivity = async (checked: boolean) => {
    setWriteAiActivity(checked)
    try {
      await setVaultWriteAiActivityEnabled(checked)
    } catch (err) {
      setWriteAiActivity(!checked)
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const saveRoot = async (source: 'claude' | 'codex', value: string | null) => {
    setError(null)
    try {
      const next = await setNativeAiSessionRoots({ [source]: value })
      setRoots(next)
      clearAiActivitySnapshot()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const savePrefixes = (raw: string) => {
    const next = writeVaultSessionPrefixesBlock(
      raw.split('\n').map(line => line.trim()).filter(Boolean),
    )
    setPrefixes(next)
    clearAiActivitySnapshot()
  }

  const resetPrefixes = () => {
    const next = writeVaultSessionPrefixesBlock([...DEFAULT_VAULT_SESSION_PREFIXES])
    setPrefixes(next)
    clearAiActivitySnapshot()
  }

  const prefixesAreDefault =
    prefixes.length === DEFAULT_VAULT_SESSION_PREFIXES.length
    && prefixes.every((p, i) => p === DEFAULT_VAULT_SESSION_PREFIXES[i])

  return (
    <>
      <SettingsGroupBlock
        heading="Native session stores"
        description="The JSONL transcripts each CLI writes on this machine. Changes apply on the next activity refresh."
        footnote={error ?? undefined}
      >
        {rootsUnavailable && (
          <SettingsRowBlock label="Not available on this platform — native stores can only be read by the desktop app." />
        )}
        {!rootsUnavailable && !roots && <SettingsRowBlock label="Loading…" />}
        {roots && (
          <>
            <NativeRootRow
              label="Claude Code"
              value={roots.claude}
              defaultValue={roots.claudeDefault}
              onSave={value => saveRoot('claude', value)}
            />
            <NativeRootRow
              label="Codex"
              value={roots.codex}
              defaultValue={roots.codexDefault}
              onSave={value => saveRoot('codex', value)}
            />
          </>
        )}
      </SettingsGroupBlock>

      <SettingsGroupBlock
        heading="Vault transcript folders"
        description="Vault-relative folder prefixes scanned for saved session markdown, one per line."
      >
        <SettingsRowBlock stacked className="gap-2">
          <PrefixesEditor value={prefixes} onSave={savePrefixes} />
          {!prefixesAreDefault && (
            <Button type="button" size="sm" variant="ghost" className="h-7 self-start text-xs" onClick={resetPrefixes}>
              Reset to defaults
            </Button>
          )}
        </SettingsRowBlock>
      </SettingsGroupBlock>

      {vaultWritePrefsAvailable && (
        <SettingsGroupBlock
          heading="Vault writes"
          description="These apply to this profile's vault only — each profile decides for itself."
        >
          <SettingsRowBlock
            as="label"
            label={<>Write raw activity signals to <span className="font-mono text-[12px]">ai-activity/raw-sessions/</span></>}
            description="Mirrors macOS Screen Time streams and GoodNotes reading sessions into per-day JSONLs under your vault. Needed so activity history survives the macOS 28-day cliff and so the Reading pill has data. Requires Full Disk Access. Off by default for new vaults."
            control={(
              <Switch
                checked={writeAiRaw === true}
                disabled={writeAiRaw === null}
                onCheckedChange={checked => { void toggleWriteAiRaw(checked) }}
                aria-label="Write raw activity signals to ai-activity/raw-sessions/"
              />
            )}
          />
          <SettingsRowBlock
            as="label"
            label={<>Mirror AI-derived digests to <span className="font-mono text-[12px]">ai-activity/</span></>}
            description="AI Activity works without this — it reads your AI tools' own session logs and caches digests on this Mac. Turning it on also writes per-day project digests as browsable markdown, which buys a durable record (most harnesses delete session logs after ~30 days) and cross-device history (the vault syncs; the local cache doesn't). Off by default."
            control={(
              <Switch
                checked={writeAiActivity === true}
                disabled={writeAiActivity === null}
                onCheckedChange={checked => { void toggleWriteAiActivity(checked) }}
                aria-label="Mirror AI-derived digests to ai-activity/"
              />
            )}
          />
        </SettingsGroupBlock>
      )}

      <SettingsGroupBlock heading="Reading (GoodNotes)">
        <SettingsRowBlock
          as="label"
          label="Harvest GoodNotes reading sessions"
          description={'Reads GoodNotes’ local database to attribute reading time to specific documents. Off by default because it touches another app’s container and triggers macOS’s "access data from other apps" prompt.'}
          control={(
            <Switch
              checked={readingEnabled}
              onCheckedChange={toggleReadingEnabled}
              aria-label="Harvest GoodNotes reading sessions"
            />
          )}
        />
        <SettingsRowBlock
          as="label"
          label="Only count annotated reading"
          description="Counts a session only when you actually marked up the document that day (a stroke or date added), filtering out PDFs left open and idle. Leave off if you often read without annotating."
          control={(
            <Switch
              checked={annotationGate}
              onCheckedChange={toggleAnnotationGate}
              aria-label="Only count annotated GoodNotes reading"
              disabled={!readingEnabled}
            />
          )}
        />
      </SettingsGroupBlock>
    </>
  )
}

interface NativeRootRowProps {
  label: string
  value: string
  defaultValue: string
  onSave: (value: string | null) => void
}

function NativeRootRow({ label, value, defaultValue, onSave }: NativeRootRowProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const isDefault = value === defaultValue

  if (editing) {
    return (
      <SettingsRowBlock stacked className="gap-2">
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-[13px] font-medium text-foreground">{label}</span>
          <input
            type="text"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') { onSave(draft); setEditing(false) }
              if (e.key === 'Escape') { setDraft(value); setEditing(false) }
            }}
            placeholder={defaultValue}
            aria-label={`${label} session root`}
            className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 font-mono text-xs outline-none focus:border-ring"
            autoFocus
          />
          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => { onSave(draft); setEditing(false) }}>
            Save
          </Button>
          <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => { setDraft(value); setEditing(false) }}>
            Cancel
          </Button>
        </div>
      </SettingsRowBlock>
    )
  }

  return (
    <SettingsRowBlock
      label={label}
      description={(
        <>
          <span className="block truncate font-mono text-[11px]" title={value}>{value}</span>
          {!isDefault && (
            <span className="block truncate font-mono text-[11px] text-muted-foreground/50" title={defaultValue}>
              default: {defaultValue}
            </span>
          )}
        </>
      )}
      control={(
        <>
          {!isDefault && (
            <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => onSave(null)} title="Use the default location">
              Reset
            </Button>
          )}
          <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => { setDraft(value); setEditing(true) }}>
            Change
          </Button>
        </>
      )}
    />
  )
}

function PrefixesEditor({ value, onSave }: { value: string[]; onSave: (raw: string) => void }) {
  const joined = value.join('\n')
  const [draft, setDraft] = useState(joined)
  // Re-sync the textarea when the stored value changes from outside (e.g. reset).
  const [lastSynced, setLastSynced] = useState(joined)
  if (joined !== lastSynced) {
    setLastSynced(joined)
    setDraft(joined)
  }
  const dirty = draft !== joined

  return (
    <div className="space-y-1.5">
      <textarea
        value={draft}
        onChange={e => setDraft(e.target.value)}
        rows={Math.max(3, value.length + 1)}
        spellCheck={false}
        className="w-full rounded border border-input bg-background px-2 py-1.5 font-mono text-xs outline-none focus:border-ring"
        aria-label="Vault transcript folder prefixes"
      />
      {dirty && (
        <div className="flex gap-2">
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onSave(draft)}>
            Save folders
          </Button>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setDraft(joined)}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  )
}
