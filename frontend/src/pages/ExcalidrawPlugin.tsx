import { useCallback, useEffect, useState } from 'react'
import { Download, Loader2, RefreshCw, Wrench } from 'lucide-react'
import { Button } from '@/components/lego_blocks/units/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/lego_blocks/units/ui/card'
import type { ExcalidrawPluginStatus } from '@/services/lego_blocks/units/typesBlock'
import {
  getExcalidrawPluginStatus,
  installOrUpdateExcalidrawPlugin,
} from '@/services/orchestrators/excalidrawPluginOrch'

function statusPill(status: ExcalidrawPluginStatus | null): { label: string; className: string } {
  if (!status) {
    return { label: 'Unknown', className: 'bg-muted text-muted-foreground' }
  }
  if (!status.installed) {
    return { label: 'Not Installed', className: 'bg-amber-500/10 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300' }
  }
  if (status.update_available) {
    return { label: 'Update Available', className: 'bg-blue-500/10 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300' }
  }
  if (!status.enabled) {
    return { label: 'Installed (Disabled)', className: 'bg-amber-500/10 dark:bg-amber-500/20 text-amber-700 dark:text-amber-300' }
  }
  return { label: 'Up To Date', className: 'bg-emerald-500/10 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300' }
}

function formatPublishedAt(value: string | null): string {
  if (!value) return 'Unknown'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

export default function ExcalidrawPlugin() {
  const [status, setStatus] = useState<ExcalidrawPluginStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [installing, setInstalling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastActionMessage, setLastActionMessage] = useState<string | null>(null)

  const refreshStatus = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const next = await getExcalidrawPluginStatus()
      setStatus(next)
      if (next.status_error) {
        setError(`Could not fetch latest release metadata: ${next.status_error}`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load plugin status')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  const handleInstallOrUpdate = async () => {
    setInstalling(true)
    setError(null)
    setLastActionMessage(null)
    try {
      const next = await installOrUpdateExcalidrawPlugin()
      setStatus(next)
      setLastActionMessage(
        next.update_available
          ? 'Update installed. A newer release may still be detected due to local cache; refresh to verify.'
          : next.installed
            ? 'Plugin installed and enabled in community plugins.'
            : 'Plugin install did not complete.',
      )
      if (next.status_error) {
        setError(`Installed plugin, but release check failed: ${next.status_error}`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to install/update plugin')
    } finally {
      setInstalling(false)
    }
  }

  const pill = statusPill(status)
  const actionLabel = !status?.installed
    ? 'Install Latest'
    : status.update_available
      ? 'Update To Latest'
      : 'Reinstall Latest'

  return (
    <div className="ltm-page">
      <div className="ltm-page-shell ltm-shell-narrow">
        <header className="mb-8">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2">
              <Wrench className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Excalidraw Plugin</h1>
              <p className="text-muted-foreground">
                Install and update Obsidian Excalidraw community plugin directly from GitHub releases
              </p>
            </div>
          </div>
        </header>

        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base">Plugin Status</CardTitle>
                  <CardDescription>
                    Source repo: <span className="font-mono">{status?.source_repo ?? 'zsviczian/obsidian-excalidraw-plugin'}</span>
                  </CardDescription>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-medium ${pill.className}`}>
                  {pill.label}
                </span>
              </div>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center justify-center py-8 text-muted-foreground">
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Loading plugin status...
                </div>
              ) : (
                <div className="space-y-3 text-sm">
                  <div className="flex items-center justify-between gap-4 border-b border-border/60 py-2">
                    <span className="text-muted-foreground">Installed Version</span>
                    <span className="font-mono">{status?.installed_version ?? 'Not installed'}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4 border-b border-border/60 py-2">
                    <span className="text-muted-foreground">Latest Release Version</span>
                    <span className="font-mono">{status?.latest_version ?? 'Unknown'}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4 border-b border-border/60 py-2">
                    <span className="text-muted-foreground">Published</span>
                    <span>{formatPublishedAt(status?.release_published_at ?? null)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4 border-b border-border/60 py-2">
                    <span className="text-muted-foreground">Enabled In Obsidian</span>
                    <span>{status?.enabled ? 'Yes' : 'No'}</span>
                  </div>
                  <div className="flex items-center justify-between gap-4 py-2">
                    <span className="text-muted-foreground">Plugin Directory</span>
                    <span className="max-w-[60%] truncate font-mono text-xs" title={status?.plugin_dir ?? ''}>
                      {status?.plugin_dir ?? 'Unknown'}
                    </span>
                  </div>
                  {status?.release_url && (
                    <div className="pt-2">
                      <a
                        href={status.release_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sm text-primary underline-offset-4 hover:underline"
                      >
                        Open latest release page
                      </a>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {error && (
            <div className="rounded-lg border border-red-200 dark:border-red-500/45 bg-red-50 dark:bg-red-500/20 p-4 text-sm text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          {lastActionMessage && (
            <div className="rounded-lg border border-emerald-200 dark:border-emerald-500/45 bg-emerald-50 dark:bg-emerald-500/20 p-4 text-sm text-emerald-700 dark:text-emerald-300">
              {lastActionMessage}
            </div>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Actions</CardTitle>
              <CardDescription>
                Installs required release assets (`manifest.json`, `main.js`) and optional `styles.css`
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <Button onClick={handleInstallOrUpdate} disabled={loading || installing} size="lg">
                {installing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Working...
                  </>
                ) : (
                  <>
                    <Download className="mr-2 h-4 w-4" />
                    {actionLabel}
                  </>
                )}
              </Button>
              <Button variant="secondary" onClick={() => void refreshStatus()} disabled={loading || installing} size="lg">
                <RefreshCw className="mr-2 h-4 w-4" />
                Refresh Status
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
