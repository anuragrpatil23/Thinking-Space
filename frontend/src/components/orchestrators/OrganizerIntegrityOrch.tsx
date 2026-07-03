import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, ShieldCheck, Wrench } from 'lucide-react'
import { Button } from '@/components/lego_blocks/units/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/lego_blocks/units/ui/card'
import {
  applyOrganizerStatusPolicy,
  runOrganizerIntegrityCheck,
  type OrganizerIntegrityIssue,
  type OrganizerIntegrityReport,
} from '@/services/orchestrators/organizerIntegrityOrch'
import { smartSync } from '@/services/orchestrators/vaultSyncOrch'

function errorMessage(value: unknown, fallback: string): string {
  if (value instanceof Error && value.message) return value.message
  if (typeof value === 'string' && value.trim()) return value
  return fallback
}

function issueSortWeight(issue: OrganizerIntegrityIssue): number {
  if (issue.severity === 'error') return 0
  if (issue.kind === 'epic_status_violation') return 1
  return 2
}

export default function OrganizerIntegrityOrch() {
  const [report, setReport] = useState<OrganizerIntegrityReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [applying, setApplying] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const runCheck = useCallback(async (syncFirst: boolean) => {
    setLoading(true)
    setError(null)
    setMessage(null)

    try {
      if (syncFirst) {
        setSyncing(true)
        await smartSync()
      }

      const next = await runOrganizerIntegrityCheck()
      setReport(next)
      if (next.issueCount === 0) {
        setMessage('Integrity check passed with no violations.')
      } else {
        setMessage(`Integrity check found ${next.issueCount} issue(s).`)
      }
    } catch (err) {
      setError(errorMessage(err, 'Failed to run integrity check'))
    } finally {
      setLoading(false)
      setSyncing(false)
    }
  }, [])

  useEffect(() => {
    void runCheck(false)
  }, [runCheck])

  const issueCountsByKind = useMemo(() => {
    if (!report) return []
    const counts = new Map<string, number>()
    for (const issue of report.issues) {
      counts.set(issue.kind, (counts.get(issue.kind) ?? 0) + 1)
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([kind, count]) => ({ kind, count }))
  }, [report])

  const sortedIssues = useMemo(() => {
    if (!report) return []
    return [...report.issues].sort((a, b) => issueSortWeight(a) - issueSortWeight(b))
  }, [report])

  const applyPolicyFixes = useCallback(async () => {
    setApplying(true)
    setError(null)
    setMessage(null)

    try {
      const result = await applyOrganizerStatusPolicy()
      setMessage(`Applied status policy updates: ${result.taskUpdates} task(s), ${result.epicUpdates} epic(s).`)
      await runCheck(false)
    } catch (err) {
      setError(errorMessage(err, 'Failed to apply status policy fixes'))
    } finally {
      setApplying(false)
    }
  }, [runCheck])

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Integrity Checks</CardTitle>
          <CardDescription>
            Validate hierarchy and status policy consistency. Epic status is derived from descendant task states.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => { void runCheck(true) }} disabled={loading || syncing || applying}>
              {syncing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1.5 h-3.5 w-3.5" />}
              Sync + Run Check
            </Button>
            <Button size="sm" variant="secondary" onClick={() => { void runCheck(false) }} disabled={loading || syncing || applying}>
              {loading && !syncing ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />}
              Run Check (Cache)
            </Button>
            <Button size="sm" onClick={() => { void applyPolicyFixes() }} disabled={loading || syncing || applying}>
              {applying ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Wrench className="mr-1.5 h-3.5 w-3.5" />}
              Apply Status Policy Fixes
            </Button>
          </div>

          {(message || error) && (
            <div className="space-y-2">
              {message && (
                <div className="rounded-md border border-emerald-500/30 bg-emerald-500/10 dark:bg-emerald-500/20 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
                  {message}
                </div>
              )}
              {error && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div>Nodes scanned: <span className="font-medium">{report?.nodeCount ?? '-'}</span></div>
          <div>Issues found: <span className="font-medium">{report?.issueCount ?? '-'}</span></div>
          {issueCountsByKind.length > 0 && (
            <div className="space-y-1 pt-1">
              {issueCountsByKind.map(item => (
                <div key={item.kind} className="text-xs text-muted-foreground">
                  {item.kind}: <span className="text-foreground">{item.count}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Issue List</CardTitle>
        </CardHeader>
        <CardContent>
          {sortedIssues.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="h-4 w-4" />
              No integrity issues detected.
            </div>
          ) : (
            <div className="space-y-2">
              {sortedIssues.map((issue, index) => (
                <div key={`${issue.kind}-${issue.nodeKey ?? issue.filePath ?? index}`} className="rounded-lg border border-border/70 bg-muted/20 p-3">
                  <div className="flex items-center gap-2 text-xs">
                    {issue.severity === 'error' ? (
                      <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                    ) : (
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                    )}
                    <span className="font-medium uppercase tracking-wide text-muted-foreground">{issue.kind}</span>
                  </div>
                  <p className="mt-1 text-sm text-foreground">{issue.message}</p>
                  <div className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                    {issue.nodeTitle && <div>Node: <span className="text-foreground">{issue.nodeTitle}</span></div>}
                    {issue.nodeKey && <div>Key: <span className="font-mono text-foreground">{issue.nodeKey}</span></div>}
                    {issue.parentKey && <div>Parent: <span className="font-mono text-foreground">{issue.parentKey}</span></div>}
                    {issue.expected && <div>Expected: <span className="text-foreground">{issue.expected}</span></div>}
                    {issue.actual && <div>Actual: <span className="text-foreground">{issue.actual}</span></div>}
                    {issue.filePath && <div>File: <span className="font-mono text-foreground">{issue.filePath}</span></div>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
