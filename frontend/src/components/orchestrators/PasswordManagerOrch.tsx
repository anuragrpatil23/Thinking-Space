import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
  LockOpen,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/lego_blocks/units/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/lego_blocks/units/ui/card'
import { copyTextToClipboard } from '@/components/lego_blocks/units/BacklogListDomainBlock'
import {
  createPasswordVaultEntryIdOrch,
  getPasswordVaultFilePathOrch,
  type LoadedPasswordVaultBlock,
  type PasswordVaultEntryBlock,
} from '@/services/orchestrators/passwordManagerOrch'
import {
  getPasswordVaultSessionSnapshotOrch,
  lockPasswordVaultSessionOrch,
  reloadPasswordVaultSessionOrch,
  savePasswordVaultSessionVaultOrch,
  subscribePasswordVaultSessionOrch,
  unlockPasswordVaultSessionOrch,
} from '@/services/orchestrators/passwordManagerSessionOrch'

interface PasswordEntryDraft {
  id: string
  title: string
  username: string
  password: string
  website: string
  notes: string
  tagsText: string
}

const EMPTY_DRAFT_BLOCK = (): PasswordEntryDraft => ({
  id: createPasswordVaultEntryIdOrch(),
  title: '',
  username: '',
  password: '',
  website: '',
  notes: '',
  tagsText: '',
})

function errorMessage(value: unknown, fallback: string): string {
  if (value instanceof Error && value.message) return value.message
  if (typeof value === 'string' && value.trim()) return value
  return fallback
}

function tagsFromInputBlock(value: string): string[] {
  const seen = new Set<string>()
  const tags: string[] = []
  for (const part of value.split(',')) {
    const normalized = part.trim()
    if (!normalized) continue
    const dedupeKey = normalized.toLowerCase()
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    tags.push(normalized)
  }
  return tags
}

function draftFromEntryBlock(entry: PasswordVaultEntryBlock): PasswordEntryDraft {
  return {
    id: entry.id,
    title: entry.title,
    username: entry.username,
    password: entry.password,
    website: entry.website ?? '',
    notes: entry.notes ?? '',
    tagsText: entry.tags.join(', '),
  }
}

function draftSignatureBlock(draft: PasswordEntryDraft): string {
  return JSON.stringify({
    title: draft.title.trim(),
    username: draft.username.trim(),
    password: draft.password.trim(),
    website: draft.website.trim(),
    notes: draft.notes.trim(),
    tags: tagsFromInputBlock(draft.tagsText),
  })
}

function entrySignatureBlock(entry: PasswordVaultEntryBlock | null): string {
  if (!entry) return ''
  return JSON.stringify({
    title: entry.title,
    username: entry.username,
    password: entry.password,
    website: entry.website ?? '',
    notes: entry.notes ?? '',
    tags: entry.tags,
  })
}

function formatTimestampBlock(value: string | undefined): string {
  if (!value) return 'unknown'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString()
}

function normalizeWebsiteUrlBlock(value: string): string | null {
  const normalized = value.trim()
  if (!normalized) return null
  if (/^https?:\/\//i.test(normalized)) return normalized
  return `https://${normalized}`
}

function sortEntriesBlock(entries: PasswordVaultEntryBlock[]): PasswordVaultEntryBlock[] {
  return [...entries].sort((left, right) => {
    const byUpdated = right.updatedAt.localeCompare(left.updatedAt)
    if (byUpdated !== 0) return byUpdated
    return left.title.localeCompare(right.title)
  })
}

export default function PasswordManagerOrch() {
  const [passphraseInput, setPassphraseInput] = useState('')
  const [vaultState, setVaultState] = useState<LoadedPasswordVaultBlock | null>(null)
  const [selectedEntryId, setSelectedEntryId] = useState<string | null>(null)
  const [draft, setDraft] = useState<PasswordEntryDraft>(EMPTY_DRAFT_BLOCK)
  const [creatingNewEntry, setCreatingNewEntry] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [revealedPassword, setRevealedPassword] = useState(false)
  const [busyAction, setBusyAction] = useState<'unlock' | 'save' | 'reload' | 'delete' | 'copy' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const selectedEntryIdRef = useRef(selectedEntryId)
  const creatingNewEntryRef = useRef(creatingNewEntry)
  useEffect(() => { selectedEntryIdRef.current = selectedEntryId }, [selectedEntryId])
  useEffect(() => { creatingNewEntryRef.current = creatingNewEntry }, [creatingNewEntry])

  const unlocked = !!vaultState
  const vault = vaultState?.vault ?? null
  const sortedEntries = useMemo(() => sortEntriesBlock(vault?.entries ?? []), [vault])
  const filteredEntries = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase()
    if (!normalizedQuery) return sortedEntries
    return sortedEntries.filter((entry) => {
      const haystack = [
        entry.title,
        entry.username,
        entry.website ?? '',
        entry.notes ?? '',
        ...entry.tags,
      ].join(' ').toLowerCase()
      return haystack.includes(normalizedQuery)
    })
  }, [searchQuery, sortedEntries])

  const selectedEntry = useMemo(
    () => creatingNewEntry ? null : (vault?.entries.find((entry) => entry.id === selectedEntryId) ?? null),
    [creatingNewEntry, selectedEntryId, vault],
  )
  const isDirty = creatingNewEntry
    ? draftSignatureBlock(draft) !== draftSignatureBlock(EMPTY_DRAFT_BLOCK())
    : draftSignatureBlock(draft) !== entrySignatureBlock(selectedEntry)

  const passwordVaultFilePath = getPasswordVaultFilePathOrch()

  const hydrateFromLoadedVault = (loaded: LoadedPasswordVaultBlock) => {
    setVaultState(loaded)
    if (loaded.vault.entries.length === 0) {
      setCreatingNewEntry(true)
      setSelectedEntryId(null)
      setDraft(EMPTY_DRAFT_BLOCK())
      setRevealedPassword(true)
      return
    }

    const first = sortEntriesBlock(loaded.vault.entries)[0]
    setCreatingNewEntry(false)
    setSelectedEntryId(first.id)
    setDraft(draftFromEntryBlock(first))
    setRevealedPassword(false)
  }

  useEffect(() => {
    const snapshot = getPasswordVaultSessionSnapshotOrch()
    if (snapshot.unlocked && snapshot.vaultState) {
      hydrateFromLoadedVault(snapshot.vaultState)
    }

    return subscribePasswordVaultSessionOrch((nextSnapshot) => {
      if (!nextSnapshot.unlocked || !nextSnapshot.vaultState) {
        setVaultState(null)
        setSelectedEntryId(null)
        setCreatingNewEntry(false)
        setDraft(EMPTY_DRAFT_BLOCK())
        setRevealedPassword(false)
        return
      }

      setVaultState(nextSnapshot.vaultState)
      if (creatingNewEntryRef.current) return
      const stillSelected = selectedEntryIdRef.current
        ? nextSnapshot.vaultState.vault.entries.find((entry) => entry.id === selectedEntryIdRef.current) ?? null
        : null
      if (!stillSelected) {
        hydrateFromLoadedVault(nextSnapshot.vaultState)
      }
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const confirmDiscardBlock = (): boolean => {
    if (!isDirty) return true
    return window.confirm('Discard unsaved password entry changes?')
  }

  const onUnlockVault = async () => {
    const normalizedPassphrase = passphraseInput.trim()
    if (!normalizedPassphrase) {
      setError('Enter a passphrase to unlock or create your password vault.')
      setMessage(null)
      return
    }

    setBusyAction('unlock')
    setError(null)
    setMessage(null)
    try {
      const loaded = await unlockPasswordVaultSessionOrch(normalizedPassphrase)
      hydrateFromLoadedVault(loaded)
      setMessage(
        loaded.exists
          ? 'Password vault unlocked.'
          : 'New password vault ready. Save your first entry to create the encrypted file.',
      )
    } catch (err) {
      setError(errorMessage(err, 'Failed to unlock password vault'))
    } finally {
      setBusyAction(null)
    }
  }

  const onLockVault = () => {
    if (isDirty && !window.confirm('Locking will discard unsaved password entry changes. Continue?')) {
      return
    }
    lockPasswordVaultSessionOrch()
    setVaultState(null)
    setSelectedEntryId(null)
    setDraft(EMPTY_DRAFT_BLOCK())
    setCreatingNewEntry(false)
    setRevealedPassword(false)
    setPassphraseInput('')
    setSearchQuery('')
    setError(null)
    setMessage('Password vault locked.')
  }

  const onReloadVault = async () => {
    if (!vaultState) return
    if (!confirmDiscardBlock()) return

    setBusyAction('reload')
    setError(null)
    setMessage(null)
    try {
      const loaded = await reloadPasswordVaultSessionOrch()
      hydrateFromLoadedVault(loaded)
      setMessage('Password vault reloaded from the vault folder.')
    } catch (err) {
      setError(errorMessage(err, 'Failed to reload password vault'))
    } finally {
      setBusyAction(null)
    }
  }

  const onStartNewEntry = () => {
    if (!confirmDiscardBlock()) return
    setCreatingNewEntry(true)
    setSelectedEntryId(null)
    setDraft(EMPTY_DRAFT_BLOCK())
    setRevealedPassword(true)
    setError(null)
    setMessage('Creating a new password entry.')
  }

  const onSelectEntry = (entry: PasswordVaultEntryBlock) => {
    if (!confirmDiscardBlock()) return
    setCreatingNewEntry(false)
    setSelectedEntryId(entry.id)
    setDraft(draftFromEntryBlock(entry))
    setRevealedPassword(false)
    setError(null)
    setMessage(null)
  }

  const onDiscardChanges = () => {
    if (creatingNewEntry) {
      setDraft(EMPTY_DRAFT_BLOCK())
      return
    }
    if (selectedEntry) {
      setDraft(draftFromEntryBlock(selectedEntry))
      setRevealedPassword(false)
    }
  }

  const onCopyValue = async (value: string, label: string) => {
    const normalized = value.trim()
    if (!normalized) {
      setError(`${label} is empty.`)
      setMessage(null)
      return
    }
    setBusyAction('copy')
    setError(null)
    try {
      await copyTextToClipboard(normalized)
      setMessage(`${label} copied to clipboard.`)
    } catch (err) {
      setError(errorMessage(err, `Failed to copy ${label.toLowerCase()}`))
    } finally {
      setBusyAction(null)
    }
  }

  const onOpenWebsite = () => {
    const url = normalizeWebsiteUrlBlock(draft.website)
    if (!url) {
      setError('Enter a website URL first.')
      setMessage(null)
      return
    }
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  const onSaveEntry = async () => {
    if (!vaultState) return
    const title = draft.title.trim()
    const password = draft.password.trim()
    if (!title) {
      setError('Title is required.')
      setMessage(null)
      return
    }
    if (!password) {
      setError('Password is required.')
      setMessage(null)
      return
    }

    const now = new Date().toISOString()
    const nextEntry: PasswordVaultEntryBlock = {
      id: creatingNewEntry ? draft.id : (selectedEntry?.id ?? draft.id),
      title,
      username: draft.username.trim(),
      password,
      ...(draft.website.trim() ? { website: draft.website.trim() } : {}),
      ...(draft.notes.trim() ? { notes: draft.notes.trim() } : {}),
      tags: tagsFromInputBlock(draft.tagsText),
      createdAt: creatingNewEntry ? now : (selectedEntry?.createdAt ?? now),
      updatedAt: now,
    }

    const nextEntries = creatingNewEntry
      ? [nextEntry, ...vaultState.vault.entries]
      : vaultState.vault.entries.map((entry) => entry.id === nextEntry.id ? nextEntry : entry)

    setBusyAction('save')
    setError(null)
    setMessage(null)
    try {
      const nextState = await savePasswordVaultSessionVaultOrch({
        ...vaultState.vault,
        updatedAt: now,
        entries: nextEntries,
      })
      setVaultState(nextState)
      setCreatingNewEntry(false)
      setSelectedEntryId(nextEntry.id)
      setDraft(draftFromEntryBlock(nextEntry))
      setRevealedPassword(false)
      setMessage(creatingNewEntry ? 'Password entry created.' : 'Password entry saved.')
    } catch (err) {
      setError(errorMessage(err, 'Failed to save password entry'))
    } finally {
      setBusyAction(null)
    }
  }

  const onDeleteEntry = async () => {
    if (!vaultState) return
    if (creatingNewEntry) {
      setDraft(EMPTY_DRAFT_BLOCK())
      setMessage('New password entry cleared.')
      setError(null)
      return
    }
    if (!selectedEntry) return
    if (!window.confirm(`Delete password entry "${selectedEntry.title}"?`)) return

    const remainingEntries = vaultState.vault.entries.filter((entry) => entry.id !== selectedEntry.id)
    const now = new Date().toISOString()

    setBusyAction('delete')
    setError(null)
    setMessage(null)
    try {
      const nextState = await savePasswordVaultSessionVaultOrch({
        ...vaultState.vault,
        updatedAt: now,
        entries: remainingEntries,
      })
      setVaultState(nextState)
      if (remainingEntries.length === 0) {
        setCreatingNewEntry(true)
        setSelectedEntryId(null)
        setDraft(EMPTY_DRAFT_BLOCK())
        setRevealedPassword(true)
      } else {
        const nextSelected = sortEntriesBlock(remainingEntries)[0]
        setCreatingNewEntry(false)
        setSelectedEntryId(nextSelected.id)
        setDraft(draftFromEntryBlock(nextSelected))
        setRevealedPassword(false)
      }
      setMessage('Password entry deleted.')
    } catch (err) {
      setError(errorMessage(err, 'Failed to delete password entry'))
    } finally {
      setBusyAction(null)
    }
  }

  return (
    <div className="space-y-4">
      {(error || message) && (
        <div className={`rounded-xl border px-4 py-3 text-sm ${error ? 'border-destructive/40 bg-destructive/10 text-destructive' : 'border-emerald-500/30 bg-emerald-500/10 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300'}`}>
          {error ?? message}
        </div>
      )}

      {!unlocked && (
        <Card className="border-border/60 bg-gradient-to-br from-background via-background to-primary/5">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-primary/10 p-2.5 text-primary">
                <KeyRound className="h-5 w-5" />
              </div>
              <div>
                <CardTitle>Password Vault</CardTitle>
                <CardDescription>
                  Encrypt passwords with your own passphrase, then sync the resulting vault file through any cloud-synced Thinking Space folder.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="space-y-4">
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
                <div className="space-y-2">
                  <label htmlFor="ltm-password-vault-passphrase" className="text-sm font-medium">
                    Passphrase
                  </label>
                  <input
                    id="ltm-password-vault-passphrase"
                    type="password"
                    value={passphraseInput}
                    onChange={(event) => setPassphraseInput(event.target.value)}
                    placeholder="Enter your vault passphrase"
                    className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring"
                  />
                </div>
                <Button
                  type="button"
                  onClick={() => { void onUnlockVault() }}
                  disabled={busyAction === 'unlock'}
                  className="min-w-[10rem]"
                >
                  {busyAction === 'unlock'
                    ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    : <LockOpen className="mr-2 h-4 w-4" />}
                  {busyAction === 'unlock' ? 'Unlocking...' : 'Unlock Vault'}
                </Button>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-xl border border-border/60 bg-muted/20 p-3">
                  <div className="text-sm font-medium text-foreground">Cross-device model</div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    The encrypted vault lives inside your Thinking Space folder, so it follows the same iCloud, Dropbox, Syncthing, or git-based sync setup as the rest of your workspace.
                  </p>
                </div>
                <div className="rounded-xl border border-border/60 bg-muted/20 p-3">
                  <div className="text-sm font-medium text-foreground">Storage path</div>
                  <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                    {passwordVaultFilePath}
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-border/60 bg-muted/15 p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <ShieldCheck className="h-4 w-4 text-primary" />
                What this stores
              </div>
              <ul className="mt-3 space-y-2 text-xs text-muted-foreground">
                <li>Titles, usernames, passwords, websites, notes, and tags.</li>
                <li>AES-GCM encrypted payload derived from your passphrase with PBKDF2.</li>
                <li>No device-local secret cache beyond your current session input.</li>
              </ul>
            </div>
          </CardContent>
        </Card>
      )}

      {unlocked && vault && (
        <>
          <Card>
            <CardContent className="flex flex-col gap-3 p-6 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <ShieldCheck className="h-4 w-4 text-primary" />
                  Encrypted vault unlocked
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {vault.entries.length} {vault.entries.length === 1 ? 'entry' : 'entries'} in{' '}
                  <span className="font-mono text-xs">{passwordVaultFilePath}</span>
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Last saved {formatTimestampBlock(vault.updatedAt)}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={onStartNewEntry}>
                  <Plus className="mr-2 h-4 w-4" />
                  New Entry
                </Button>
                <Button type="button" variant="outline" onClick={() => { void onReloadVault() }} disabled={busyAction === 'reload'}>
                  {busyAction === 'reload'
                    ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    : <RefreshCw className="mr-2 h-4 w-4" />}
                  Reload
                </Button>
                <Button type="button" variant="outline" onClick={onLockVault}>
                  <Lock className="mr-2 h-4 w-4" />
                  Lock
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 xl:grid-cols-[22rem_minmax(0,1fr)]">
            <Card className="min-h-[32rem]">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Entries</CardTitle>
                <CardDescription>
                  Search by title, username, website, notes, or tags.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(event) => setSearchQuery(event.target.value)}
                    placeholder="Search passwords"
                    className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm text-foreground outline-none focus:border-ring"
                  />
                </div>

                <div className="space-y-2">
                  {filteredEntries.length === 0 && (
                    <div className="rounded-xl border border-dashed border-border/70 px-3 py-6 text-center text-sm text-muted-foreground">
                      {vault.entries.length === 0 ? 'No password entries yet.' : 'No entries match this search.'}
                    </div>
                  )}

                  {filteredEntries.map((entry) => {
                    const active = !creatingNewEntry && entry.id === selectedEntryId
                    return (
                      <button
                        key={entry.id}
                        type="button"
                        onClick={() => onSelectEntry(entry)}
                        className={`w-full rounded-xl border px-3 py-3 text-left transition-colors ${
                          active
                            ? 'border-primary/40 bg-primary/10'
                            : 'border-border/60 bg-background hover:bg-muted/40'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium text-foreground">{entry.title}</div>
                            <div className="mt-1 truncate text-xs text-muted-foreground">
                              {entry.username || 'No username'}
                              {entry.website ? ` • ${entry.website}` : ''}
                            </div>
                          </div>
                          <div className="shrink-0 text-[11px] text-muted-foreground">
                            {new Date(entry.updatedAt).toLocaleDateString()}
                          </div>
                        </div>
                        {entry.tags.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {entry.tags.map((tag) => (
                              <span key={tag} className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </button>
                    )
                  })}
                </div>
              </CardContent>
            </Card>

            <Card className="min-h-[32rem]">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  {creatingNewEntry ? <Plus className="h-4 w-4 text-primary" /> : <KeyRound className="h-4 w-4 text-primary" />}
                  {creatingNewEntry ? 'New Password Entry' : (selectedEntry?.title ?? 'Password Entry')}
                </CardTitle>
                <CardDescription>
                  {creatingNewEntry
                    ? 'Add a new credential to the encrypted vault.'
                    : 'Edit details, then save back to the encrypted vault file.'}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="space-y-2">
                    <label htmlFor="ltm-password-title" className="text-sm font-medium">Title</label>
                    <input
                      id="ltm-password-title"
                      type="text"
                      value={draft.title}
                      onChange={(event) => setDraft((prev) => ({ ...prev, title: event.target.value }))}
                      placeholder="GitHub, Bank, WiFi, Router"
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring"
                    />
                  </div>
                  <div className="space-y-2">
                    <label htmlFor="ltm-password-username" className="text-sm font-medium">Username</label>
                    <div className="flex gap-2">
                      <input
                        id="ltm-password-username"
                        type="text"
                        value={draft.username}
                        onChange={(event) => setDraft((prev) => ({ ...prev, username: event.target.value }))}
                        placeholder="username@example.com"
                        className="h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => { void onCopyValue(draft.username, 'Username') }}
                        disabled={busyAction === 'copy'}
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto_auto]">
                  <div className="space-y-2">
                    <label htmlFor="ltm-password-secret" className="text-sm font-medium">Password</label>
                    <input
                      id="ltm-password-secret"
                      type={revealedPassword ? 'text' : 'password'}
                      value={draft.password}
                      onChange={(event) => setDraft((prev) => ({ ...prev, password: event.target.value }))}
                      placeholder="Password or secret"
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Reveal</label>
                    <Button type="button" variant="outline" onClick={() => setRevealedPassword((prev) => !prev)} className="w-full">
                      {revealedPassword ? <EyeOff className="mr-2 h-4 w-4" /> : <Eye className="mr-2 h-4 w-4" />}
                      {revealedPassword ? 'Hide' : 'Show'}
                    </Button>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Copy</label>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => { void onCopyValue(draft.password, 'Password') }}
                      disabled={busyAction === 'copy'}
                      className="w-full"
                    >
                      <Copy className="mr-2 h-4 w-4" />
                      Copy
                    </Button>
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
                  <div className="space-y-2">
                    <label htmlFor="ltm-password-website" className="text-sm font-medium">Website</label>
                    <input
                      id="ltm-password-website"
                      type="text"
                      value={draft.website}
                      onChange={(event) => setDraft((prev) => ({ ...prev, website: event.target.value }))}
                      placeholder="https://example.com"
                      className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">Open</label>
                    <Button type="button" variant="outline" onClick={onOpenWebsite} className="w-full">
                      <ExternalLink className="mr-2 h-4 w-4" />
                      Open
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <label htmlFor="ltm-password-tags" className="text-sm font-medium">Tags</label>
                  <input
                    id="ltm-password-tags"
                    type="text"
                    value={draft.tagsText}
                    onChange={(event) => setDraft((prev) => ({ ...prev, tagsText: event.target.value }))}
                    placeholder="work, personal, finance"
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring"
                  />
                </div>

                <div className="space-y-2">
                  <label htmlFor="ltm-password-notes" className="text-sm font-medium">Notes</label>
                  <textarea
                    id="ltm-password-notes"
                    value={draft.notes}
                    onChange={(event) => setDraft((prev) => ({ ...prev, notes: event.target.value }))}
                    placeholder="Recovery details, MFA notes, account context"
                    rows={8}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-ring"
                  />
                </div>

                <div className="rounded-xl border border-border/60 bg-muted/15 px-3 py-2 text-xs text-muted-foreground">
                  {creatingNewEntry
                    ? 'This entry has not been saved yet.'
                    : `Created ${formatTimestampBlock(selectedEntry?.createdAt)} • Last updated ${formatTimestampBlock(selectedEntry?.updatedAt)}`}
                  {isDirty && <span className="ml-2 font-medium text-foreground">Unsaved changes</span>}
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button type="button" onClick={() => { void onSaveEntry() }} disabled={busyAction === 'save'}>
                    {busyAction === 'save'
                      ? <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      : <Save className="mr-2 h-4 w-4" />}
                    Save Entry
                  </Button>
                  <Button type="button" variant="outline" onClick={onDiscardChanges} disabled={!isDirty}>
                    Discard Changes
                  </Button>
                  <Button type="button" variant="outline" onClick={onDeleteEntry}>
                    <Trash2 className="mr-2 h-4 w-4" />
                    {creatingNewEntry ? 'Clear Draft' : 'Delete Entry'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
