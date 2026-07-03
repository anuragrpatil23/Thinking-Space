import { useMemo, useState } from 'react'
import { CheckCircle2, Loader2, Sparkles } from 'lucide-react'
import { Button } from '@/components/lego_blocks/units/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/lego_blocks/units/ui/card'
import {
  generateExtensionArtifactsOrch,
  saveGeneratedExtensionArtifactsOrch,
  type GeneratedExtensionArtifactSet,
} from '@/services/orchestrators/extensionBuilderOrch'

const DEFAULT_INTENT = 'Add a quick thought metadata inspector in the thought context panel.'

export default function ExtensionBuilderOrch() {
  const [intent, setIntent] = useState(DEFAULT_INTENT)
  const [generated, setGenerated] = useState<GeneratedExtensionArtifactSet | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [approvePermissions, setApprovePermissions] = useState(false)
  const [activateAfterSave, setActivateAfterSave] = useState(true)
  const [saveMessage, setSaveMessage] = useState<string | null>(null)

  const previewSummary = useMemo(() => {
    if (!generated) return null
    const added = generated.preview.filter(item => item.status === 'added').length
    const modified = generated.preview.filter(item => item.status === 'modified').length
    const unchanged = generated.preview.filter(item => item.status === 'unchanged').length
    return { added, modified, unchanged }
  }, [generated])

  const runGenerate = async () => {
    setBusy(true)
    setError(null)
    setSaveMessage(null)
    setApprovePermissions(false)
    try {
      const next = await generateExtensionArtifactsOrch({ intent })
      setGenerated(next)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setGenerated(null)
    } finally {
      setBusy(false)
    }
  }

  const runSave = async () => {
    if (!generated) return
    setBusy(true)
    setError(null)
    setSaveMessage(null)
    try {
      const result = await saveGeneratedExtensionArtifactsOrch({
        artifactSet: generated,
        approvePermissions,
        activateAfterSave,
      })
      setSaveMessage(
        `Saved ${result.savedPaths.length} files to ${result.extensionPath} (${result.activated ? 'activated' : 'saved'}).`,
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Build Feature with AI</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Describe the feature intent. The builder generates declarative extension artifacts,
            shows a file diff preview, then saves to your vault extension folder.
          </p>
          <textarea
            value={intent}
            onChange={event => setIntent(event.target.value)}
            rows={5}
            className="w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            placeholder="Describe your feature..."
          />
          <div className="flex items-center gap-2">
            <Button onClick={() => { void runGenerate() }} disabled={busy || !intent.trim()}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="mr-1.5 h-4 w-4" />}
              Generate Artifacts
            </Button>
          </div>
        </CardContent>
      </Card>

      {generated && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Preview and Activate</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="rounded-md border border-border/70 bg-muted/30 p-3">
              <p><span className="font-medium">Feature:</span> {generated.draft.name}</p>
              <p><span className="font-medium">ID:</span> {generated.featureId}</p>
              <p><span className="font-medium">Mode:</span> {generated.generationMode}</p>
              <p><span className="font-medium">Extension Path:</span> {generated.extensionPath}</p>
            </div>

            {previewSummary && (
              <p className="text-xs text-muted-foreground">
                Diff preview: {previewSummary.added} added, {previewSummary.modified} modified, {previewSummary.unchanged} unchanged.
              </p>
            )}

            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Permission Review</p>
              <div className="flex flex-wrap gap-1.5">
                {generated.permissionSet.map(permission => (
                  <span key={permission} className="rounded-full bg-muted px-2 py-0.5 text-xs">
                    {permission}
                  </span>
                ))}
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={approvePermissions}
                onChange={(event) => setApprovePermissions(event.target.checked)}
              />
              I reviewed and approve extension permissions
            </label>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={activateAfterSave}
                onChange={(event) => setActivateAfterSave(event.target.checked)}
              />
              Activate extension immediately after save
            </label>

            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Generated Files</p>
              {generated.preview.map(file => (
                <details key={file.path} className="rounded-md border border-border/70 bg-background">
                  <summary className="cursor-pointer px-3 py-2 text-xs">
                    [{file.status}] {file.path}
                  </summary>
                  <pre className="max-h-60 overflow-auto border-t border-border/70 p-3 text-xs">
                    {generated.files.find(item => item.path === file.path)?.content || ''}
                  </pre>
                </details>
              ))}
            </div>

            <Button
              onClick={() => { void runSave() }}
              disabled={busy || !approvePermissions}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save and Apply'}
            </Button>
          </CardContent>
        </Card>
      )}

      {saveMessage && (
        <div className="flex items-center gap-2 rounded-md border border-green-500/40 bg-green-500/10 dark:bg-green-500/20 px-3 py-2 text-sm text-green-700 dark:text-green-300">
          <CheckCircle2 className="h-4 w-4" />
          {saveMessage}
        </div>
      )}

      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
    </div>
  )
}

