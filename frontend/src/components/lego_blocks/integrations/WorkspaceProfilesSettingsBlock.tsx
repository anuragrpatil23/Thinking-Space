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
      await createWorkspaceProfileBlock({ name: newName.trim(), vaultRoot: newVaultRoot, accentColor: newAccent })
      setNewName('')
      setNewVaultRoot(null)
      setNotice('Profile created. Open it in a new window below.')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setCreating(false)
    }
  }, [newAccent, newName, newVaultRoot, refresh])

  const setAccent = useCallback(async (profileId: string, color: string | null) => {
    setError(null)
    try {
      await updateWorkspaceProfileBlock({ id: profileId, accentColor: color })
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [refresh])

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
                className="h-3 w-3 shrink-0 rounded-full border border-border"
                style={profile.accentColor ? { backgroundColor: profile.accentColor } : undefined}
              />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-foreground">
                  {profile.name}
                  {profile.id === currentProfile.id && (
                    <span className="ml-2 text-xs text-muted-foreground">(this window)</span>
                  )}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {profile.vaultRoot ?? 'No folder selected yet'}
                </div>
              </div>
              <AccentSwatchPickerBlock
                idPrefix={`accent-${profile.id}`}
                value={profile.accentColor}
                onChange={(color) => void setAccent(profile.id, color)}
              />
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
