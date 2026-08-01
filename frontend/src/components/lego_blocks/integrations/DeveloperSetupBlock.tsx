import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/lego_blocks/units/ui/button'
import { isEmbeddedTerminalSupported } from '@/services/orchestrators/runtimeOrch'
import { Switch } from '@/components/lego_blocks/units/ui/switch'
import { isElectron } from '@/services/orchestrators/runtimeOrch'
import SourceEnvCheckBlock from './SourceEnvCheckBlock'
import AppRebuildBlock from './AppRebuildBlock'

interface SourceConfig {
  mode: 'live-source' | 'locked'
  sourcePath: string | null
  vitePort: number
  viteRunning: boolean
}

interface EnvStatus {
  nodeVersion: string | null
  nodeMeetsMinimum: boolean
  npmVersion: string | null
  depsInstalled: boolean
  isGitRepo: boolean
  gitBranch: string | null
}

function StepRow({
  number,
  done,
  label,
  children,
}: {
  number: number
  done: boolean
  label: string
  children?: React.ReactNode
}) {
  return (
    <div className="flex gap-4">
      <div className="flex flex-col items-center pt-0.5">
        <div
          className={[
            'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
            done
              ? 'bg-emerald-500 text-white'
              : 'bg-muted text-muted-foreground',
          ].join(' ')}
        >
          {done ? '✓' : number}
        </div>
        {children && <div className="mt-1 w-px flex-1 bg-border/50" />}
      </div>
      <div className="min-w-0 flex-1 pb-5">
        <p className={['text-sm font-medium leading-6', done ? 'text-muted-foreground' : 'text-foreground'].join(' ')}>
          {label}
        </p>
        {children && <div className="mt-2">{children}</div>}
      </div>
    </div>
  )
}

export default function DeveloperSetupBlock() {
  const terminalSupported = isEmbeddedTerminalSupported()
  const [config, setConfig] = useState<SourceConfig | null>(null)
  const [envStatus, setEnvStatus] = useState<EnvStatus | null>(null)
  const [saving, setSaving] = useState(false)
  const [restartNeeded, setRestartNeeded] = useState(false)
  const [pathError, setPathError] = useState<string | null>(null)
  const [rebuildOpen, setRebuildOpen] = useState(false)

  // Load config once
  useEffect(() => {
    if (!isElectron()) return
    void window.electronAPI!.sourceConfigGet!().then((c) => setConfig(c as SourceConfig))
  }, [])

  // Load env status (called after install too)
  const refreshEnv = useCallback(async () => {
    if (!isElectron()) return
    const result = await window.electronAPI!.sourceEnvCheck!()
    setEnvStatus(result)
  }, [])

  useEffect(() => { void refreshEnv() }, [refreshEnv])

  const toggleEditMode = async (on: boolean) => {
    if (!config) return
    setSaving(true)
    try {
      await window.electronAPI!.sourceConfigSet!({ mode: on ? 'live-source' : 'locked' })
      setConfig(prev => prev ? { ...prev, mode: on ? 'live-source' : 'locked' } : prev)
      setRestartNeeded(true)
    } finally {
      setSaving(false)
    }
  }

  const handlePickPath = async () => {
    const picked = await window.electronAPI!.selectVaultFolder()
    if (!picked) return
    setPathError(null)
    setSaving(true)
    try {
      await window.electronAPI!.sourceConfigSet!({ sourcePath: picked })
      setConfig(prev => prev ? { ...prev, sourcePath: picked } : prev)
      setRestartNeeded(true)
      void refreshEnv()
    } catch (e) {
      setPathError(e instanceof Error ? e.message : 'Failed to save path')
    } finally {
      setSaving(false)
    }
  }

  if (!isElectron()) {
    return (
      <p className="text-sm text-muted-foreground">
        Developer features are only available in the desktop app.
      </p>
    )
  }

  if (!config) {
    return <p className="text-sm text-muted-foreground">Loading…</p>
  }

  const toolsReady = !!(envStatus?.nodeMeetsMinimum && envStatus?.npmVersion && envStatus?.depsInstalled)
  const editModeOn = config.mode === 'live-source'
  const liveChangesWorking = editModeOn && config.viteRunning
  const fullyReady = toolsReady && liveChangesWorking

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="space-y-2 rounded-xl border border-border/60 bg-card px-3.5 py-3 text-[12px] leading-relaxed text-muted-foreground">
        <p>
          This app ships with its own source code. You can use Claude Code in the terminal to
          change anything — the layout, features, shortcuts — and see the result live after Edit Mode is fully set up.
        </p>
        <p>
          When you&apos;re happy with your changes, <strong className="text-foreground">Build a permanent version</strong> below.
          That compiles everything into a production app (same as a fresh install) and replaces
          the one running right now. Edit Mode is then no longer needed — your changes are baked in.
        </p>
      </div>

      {/* Setup steps */}
      <div className="space-y-0">
        {/* Step 1: Tools */}
        <StepRow number={1} done={toolsReady} label="Install development tools">
          <SourceEnvCheckBlock onStatusChange={setEnvStatus} />
        </StepRow>

        {/* Step 2: Edit Mode */}
        <StepRow number={2} done={editModeOn} label="Turn on Edit Mode">
          <div className="space-y-3">
            <label className="flex cursor-pointer items-center justify-between gap-4 rounded-md border border-border/60 bg-background px-3 py-2.5">
              <div className="space-y-0.5">
                <div className="text-sm font-medium">Edit Mode</div>
                <div className="text-xs text-muted-foreground">
                  The app loads from your source files instead of the built-in copy.
                  Turn this on, then restart the app once.
                </div>
              </div>
              <Switch
                checked={editModeOn}
                onCheckedChange={(checked) => void toggleEditMode(checked)}
                disabled={saving}
                aria-label="Edit Mode"
              />
            </label>

            {editModeOn ? (
              liveChangesWorking ? (
                <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300 space-y-1">
                  <p className="font-medium">No restart needed</p>
                  <p>Edit Mode is active right now. Screen changes should show up live.</p>
                </div>
              ) : (
                <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300 space-y-1">
                  <p className="font-medium">Restart needed</p>
                  <p>Edit Mode is turned on, but this window is still using the old app.</p>
                  <p>Close and open the app again before testing your change.</p>
                </div>
              )
            ) : restartNeeded ? (
              <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-700 dark:text-amber-300 space-y-1">
                <p className="font-medium">Restart needed</p>
                <p>Close and open the app again to finish applying this change.</p>
              </div>
            ) : (
              <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground space-y-1">
                <p className="font-medium text-foreground">Restart not needed</p>
                <p>Edit Mode is off.</p>
              </div>
            )}
          </div>
        </StepRow>

        {/* Step 3: Use it */}
        <div className="flex gap-4">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground mt-0.5">
            3
          </div>
          <div className="min-w-0 flex-1">
            <p className={['text-sm font-medium leading-6', !fullyReady ? 'text-muted-foreground' : 'text-foreground'].join(' ')}>
              {terminalSupported ? 'Open the terminal and ask Claude to make changes' : 'Terminal-based edit mode is unavailable in this build'}
            </p>
            {fullyReady && (
              <div className="mt-2 rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-3 space-y-2.5">
                <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
                  Ready — Edit Mode is on
                </p>
                {terminalSupported ? (
                  <>
                    <p className="text-xs text-muted-foreground">
                      Open the <strong>Terminal</strong> tab and run:
                    </p>
                    <code className="block rounded bg-black/20 px-2 py-1.5 text-xs font-mono text-emerald-700 dark:text-emerald-300">
                      claude
                    </code>
                    <p className="text-xs text-muted-foreground">
                      Tell Claude what you want to change. If the change is on an app screen, you should
                      usually see it live in this window.
                    </p>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    This build keeps the live-source tooling, but omits the embedded terminal. Use a full desktop build if you need in-app Claude or Codex terminal workflows.
                  </p>
                )}
                <div className="rounded-md border border-emerald-500/20 bg-background/60 px-3 py-2 text-xs text-muted-foreground space-y-1.5">
                  <p className="font-medium text-foreground">If you do not see your change</p>
                  <p>1. Make sure you restarted the app after turning on Edit Mode.</p>
                  <p>2. Make sure Claude edited the same folder shown in <strong>Source files location</strong> below.</p>
                  <p>3. Changes to the app screens usually show up live. Some deeper desktop changes still need a restart.</p>
                </div>
                <p className="text-xs text-muted-foreground">
                  Once you&apos;re happy, use <strong className="text-foreground">Build a permanent version</strong> below
                  to bake your changes into a production app.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Source path (advanced) */}
      <details className="overflow-hidden rounded-xl border border-border/60 bg-card [&>summary]:cursor-pointer">
        <summary className="select-none px-3.5 py-3 text-[13px] font-medium text-foreground hover:bg-muted/40">
          Source files location
        </summary>
        <div className="space-y-2 border-t border-border/60 px-3.5 py-3">
          <p className="text-xs text-muted-foreground">
            Point this at your own copy of the Thinking Space code (a GitHub fork you or your AI
            assistant cloned). Your changes stay version-controlled and survive app updates.
          </p>
          <p className="text-xs text-muted-foreground">
            Claude must edit this exact folder for live changes to appear.
          </p>
          <div className="flex gap-2">
            <div className="flex-1 rounded-md border border-input bg-muted/30 px-3 py-2 text-xs font-mono truncate text-foreground">
              {config.sourcePath ?? (
                <span className="text-muted-foreground">Not set</span>
              )}
            </div>
            <Button size="sm" variant="outline" onClick={() => void handlePickPath()} disabled={saving}>
              Change
            </Button>
          </div>
          {config.sourcePath && envStatus && (
            <div className="flex items-center gap-2 text-xs">
              {envStatus.isGitRepo ? (
                <>
                  <span className="text-emerald-600 dark:text-emerald-400">git repo</span>
                  {envStatus.gitBranch && (
                    <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-muted-foreground">
                      {envStatus.gitBranch}
                    </span>
                  )}
                </>
              ) : (
                <span className="text-muted-foreground">no git repo found at this path</span>
              )}
            </div>
          )}
          {pathError && <p className="text-xs text-destructive">{pathError}</p>}
        </div>
      </details>

      {/* Rebuild */}
      <details
        className="overflow-hidden rounded-xl border border-border/60 bg-card [&>summary]:cursor-pointer"
        open={rebuildOpen}
        onToggle={(e) => setRebuildOpen((e.currentTarget as HTMLDetailsElement).open)}
      >
        <summary className="select-none px-3.5 py-3 text-[13px] font-medium text-foreground hover:bg-muted/40">
          Build a permanent version
        </summary>
        <div className="space-y-3 border-t border-border/60 px-3.5 py-3">
          <p className="text-xs text-muted-foreground">
            Compiles your source files into a full production app — the same as a clean install,
            with your changes baked in. Takes about 2 minutes. When done, click{' '}
            <strong className="text-foreground">Apply & Relaunch</strong> and the new version
            replaces this one automatically.
          </p>
          <p className="text-xs text-muted-foreground">
            After this, Edit Mode is no longer needed. Turn it off and the app runs entirely from
            the built bundle.
          </p>
          <AppRebuildBlock />
        </div>
      </details>
    </div>
  )
}
