import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/lego_blocks/units/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/lego_blocks/units/ui/card'
import {
  createWorkspaceProfileBlock,
  deleteWorkspaceProfileBlock,
  getCurrentWorkspaceProfileBlock,
  isWorkspaceProfilesSupportedBlock,
  listWorkspaceProfilesBlock,
  openWorkspaceProfileWindowBlock,
  updateWorkspaceProfileBlock,
  type WorkspaceProfileBlock,
} from '@/services/lego_blocks/units/profileContextBlock'

// Chrome-inspired accent palette; '' = no accent.
const ACCENT_CHOICES_BLOCK = ['', '#4c8bf5', '#e8710a', '#0b8043', '#8e24aa', '#d93025', '#f6bf26', '#00acc1']

// macOS-style preset avatar glyphs; '' = use the profile name's initial.
const ICON_CHOICES_BLOCK = ['', '\uD83C\uDF33', '\uD83C\uDFE0', '\uD83D\uDCBC', '\uD83D\uDE80', '\uD83D\uDCDA', '\uD83E\uDDE0', '\uD83C\uDFA8', '\u26A1', '\uD83C\uDF0A', '\uD83C\uDF19', '\uD83C\uDF40']

function IconSwatchPickerBlock({
  value,
  onChange,
  idPrefix,
  fallbackInitial,
}: {
  value: string | null
  onChange: (icon: string | null) => void
  idPrefix: string
  fallbackInitial: string
}) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      {ICON_CHOICES_BLOCK.map((icon) => {
        const selected = (value ?? '') === icon
        return (
          <button
            key={`${idPrefix}-${icon || 'initial'}`}
            type="button"
            aria-label={icon ? `Avatar ${icon}` : 'Use name initial'}
            onClick={() => onChange(icon || null)}
            className={`inline-flex h-7 w-7 items-center justify-center rounded-full border text-sm transition-transform ${selected ? 'scale-110 border-foreground bg-accent' : 'border-border hover:scale-105'}`}
          >
            {icon || (fallbackInitial ? fallbackInitial.toUpperCase() : 'A')}
          </button>
        )
      })}
    </div>
  )
}

function AccentSwatchPickerBlock({
  value,
  onChange,
  idPrefix,
}: {
  value: string | null
  onChange: (color: string | null) => void
  idPrefix: string
}) {
  return (
    <div className="flex items-center gap-1.5">
      {ACCENT_CHOICES_BLOCK.map((color) => {
        const selected = (value ?? '') === color
        return (
          <button
            key={`${idPrefix}-${color || 'none'}`}
            type="button"
            aria-label={color ? `Accent ${color}` : 'No accent'}
            onClick={() => onChange(color || null)}
            className={`h-5 w-5 rounded-full border transition-transform ${selected ? 'scale-125 border-foreground' : 'border-border hover:scale-110'}`}
            style={color ? { backgroundColor: color } : { backgroundImage: 'linear-gradient(135deg, transparent 45%, currentColor 45%, currentColor 55%, transparent 55%)' }}
          />
        )
      })}
    </div>
  )
}

export function WorkspaceProfilesSettingsBlock() {
  const supported = isWorkspaceProfilesSupportedBlock()
  const currentProfile = getCurrentWorkspaceProfileBlock()
  const [profiles, setProfiles] = useState<WorkspaceProfileBlock[]>([])
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newVaultRoot, setNewVaultRoot] = useState<string | null>(null)
  const [newAccent, setNewAccent] = useState<string | null>(ACCENT_CHOICES_BLOCK[1])
  const [newIcon, setNewIcon] = useState<string | null>(null)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')

  const refresh = useCallback(async () => {
    try {
      setProfiles(await listWorkspaceProfilesBlock())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const pickFolder = useCallback(async () => {
    setError(null)
    const picked = await window.electronAPI?.selectVaultFolder?.()
    if (picked) setNewVaultRoot(picked)
  }, [])

  const create = useCallback(async () => {
    setError(null)
    setNotice(null)
    if (!newName.trim()) {
      setError('Give the profile a name.')
      return
    }
    if (!newVaultRoot) {
      setError('Pick a Thinking Space folder for the profile.')
      return
    }
    setCreating(true)
    try {
      await createWorkspaceProfileBlock({ name: newName.trim(), vaultRoot: newVaultRoot, accentColor: newAccent, icon: newIcon })
      setNewName('')
      setNewVaultRoot(null)
      setNewIcon(null)
      setNotice('Profile created. Open it in a new window below.')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setCreating(false)
    }
  }, [newAccent, newIcon, newName, newVaultRoot, refresh])

  const setAccent = useCallback(async (profileId: string, color: string | null) => {
    setError(null)
    try {
      await updateWorkspaceProfileBlock({ id: profileId, accentColor: color })
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [refresh])

  const setIcon = useCallback(async (profileId: string, icon: string | null) => {
    setError(null)
    try {
      await updateWorkspaceProfileBlock({ id: profileId, icon })
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [refresh])

  const commitRename = useCallback(async (profileId: string) => {
    const name = renameDraft.trim()
    setRenamingId(null)
    if (!name) return
    setError(null)
    try {
      await updateWorkspaceProfileBlock({ id: profileId, name })
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [refresh, renameDraft])

  const remove = useCallback(async (profile: WorkspaceProfileBlock) => {
    setError(null)
    setNotice(null)
    const confirmed = window.confirm(
      `Delete the "${profile.name}" profile? Its notes stay on disk — only the profile entry and this app's cached index for it are removed.`,
    )
    if (!confirmed) return
    try {
      await deleteWorkspaceProfileBlock(profile.id)
      setNotice(`Deleted "${profile.name}". The vault folder itself was not touched.`)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [refresh])

  if (!supported) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Profiles</CardTitle>
          <CardDescription>Profiles need the desktop app.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Workspace profiles open separate windows with their own Thinking Space folder, cache, and web
            logins. Update to a desktop build that supports them to use this feature.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Profiles</CardTitle>
          <CardDescription>
            Like browser profiles: each profile opens its own window on its own Thinking Space folder, with a
            separate search index, settings, and web logins. The sidebar carries the profile's accent color so
            windows stay tellable-apart.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {profiles.map((profile) => (
            <div
              key={profile.id}
              className="flex flex-wrap items-center gap-3 rounded-md border border-border p-3"
            >
              <span
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 bg-background text-sm font-semibold"
                style={profile.accentColor ? { borderColor: profile.accentColor, color: profile.accentColor } : undefined}
              >
                {profile.icon ?? (profile.name.trim().charAt(0).toUpperCase() || '\u2022')}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-foreground">
                  {renamingId === profile.id ? (
                    <input
                      type="text"
                      autoFocus
                      value={renameDraft}
                      onChange={(event) => setRenameDraft(event.target.value)}
                      onBlur={() => void commitRename(profile.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') void commitRename(profile.id)
                        if (event.key === 'Escape') setRenamingId(null)
                      }}
                      className="h-7 w-44 rounded-md border border-input bg-background px-2 text-sm text-foreground outline-none focus:border-ring"
                    />
                  ) : (
                    <button
                      type="button"
                      title="Rename profile"
                      onClick={() => {
                        setRenamingId(profile.id)
                        setRenameDraft(profile.name)
                      }}
                      className="rounded px-1 -mx-1 text-left hover:bg-accent"
                    >
                      {profile.name}
                    </button>
                  )}
                  {profile.id === currentProfile.id && (
                    <span className="ml-2 text-xs text-muted-foreground">(this window)</span>
                  )}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {profile.vaultRoot ?? 'No folder selected yet'}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <AccentSwatchPickerBlock
                    idPrefix={`accent-${profile.id}`}
                    value={profile.accentColor}
                    onChange={(color) => void setAccent(profile.id, color)}
                  />
                  <IconSwatchPickerBlock
                    idPrefix={`icon-${profile.id}`}
                    value={profile.icon}
                    onChange={(icon) => void setIcon(profile.id, icon)}
                    fallbackInitial={profile.name.trim().charAt(0)}
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void openWorkspaceProfileWindowBlock(profile.id)}
                >
                  Open Window
                </Button>
                {!profile.isDefault && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => void remove(profile)}
                  >
                    Delete
                  </Button>
                )}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>New Profile</CardTitle>
          <CardDescription>
            Pick a different folder than your other profiles — each profile owns exactly one Thinking Space.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <input
              type="text"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="Profile name (e.g. Work)"
              className="h-10 w-full max-w-xs rounded-md border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-ring"
            />
            <AccentSwatchPickerBlock idPrefix="accent-new" value={newAccent} onChange={setNewAccent} />
          </div>
          <IconSwatchPickerBlock
            idPrefix="icon-new"
            value={newIcon}
            onChange={setNewIcon}
            fallbackInitial={newName.trim().charAt(0)}
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="outline" onClick={() => void pickFolder()}>
              {newVaultRoot ? 'Change Folder' : 'Pick Folder'}
            </Button>
            {newVaultRoot && (
              <span className="truncate text-xs text-muted-foreground">{newVaultRoot}</span>
            )}
          </div>
          <Button type="button" onClick={() => void create()} disabled={creating}>
            {creating ? 'Creating…' : 'Create Profile'}
          </Button>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {notice && <p className="text-sm text-muted-foreground">{notice}</p>}
        </CardContent>
      </Card>
    </div>
  )
}
