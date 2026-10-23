import { useCallback, useEffect, useState } from 'react'
import {
  cachedValueLineIssuesOrch,
  fetchValueLineIssueOrch,
  listValueLineIssuesOrch,
  syncValueLineOrch,
  valueLineAvailableOrch,
  valueLineNotCoveredOrch,
} from '@/personal_extension/services/orchestrators/webullValueLineOrch'

/** A library failure in words: the IPC wrapper stripped, known network faults named. */
function libraryErrorTextBlock(err: unknown, fallback: string): string {
  const raw = err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : ''
  if (/ERR_TOO_MANY_REDIRECTS/.test(raw)) return 'The library session got stuck. Try again.'
  if (/ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_NETWORK_CHANGED/.test(raw)) return 'No connection to the library.'
  return raw || fallback
}

/**
 * Opening a company brings its Value Line report up to date (desktop only).
 * `fetchedCount` goes up when a new issue lands, so the page can reload.
 * `issues` is every issue the library has (cached; `loadIssues` refreshes a
 * stale list), and `fetchIssue` downloads one older issue on demand.
 */
export function useValueLineCompanyBlock(executionRoot: string | null, ticker: string) {
  const symbol = ticker.trim().toUpperCase()
  const available = Boolean(executionRoot && symbol && valueLineAvailableOrch())
  const [checking, setChecking] = useState(false)
  const [notCovered, setNotCovered] = useState(false)
  const [fetchedCount, setFetchedCount] = useState(0)
  const [issues, setIssues] = useState<string[] | null>(null)
  const [fetchingIssue, setFetchingIssue] = useState<string | null>(null)
  const [issueError, setIssueError] = useState<string | null>(null)

  useEffect(() => {
    setNotCovered(symbol ? valueLineNotCoveredOrch(symbol) : false)
    setIssues(symbol ? cachedValueLineIssuesOrch(symbol) : null)
    setIssueError(null)
    if (!available) return
    let cancelled = false
    setChecking(true)
    void syncValueLineOrch(executionRoot!, symbol)
      .then((result) => {
        if (cancelled) return
        setNotCovered(result.outcome === 'not-covered')
        setIssues(cachedValueLineIssuesOrch(symbol))
        if (result.outcome === 'fetched') setFetchedCount(n => n + 1)
      })
      .finally(() => { if (!cancelled) setChecking(false) })
    return () => {
      cancelled = true
    }
  }, [available, executionRoot, symbol])

  const loadIssues = useCallback(() => {
    if (!available) return
    setIssueError(null)
    void listValueLineIssuesOrch(symbol)
      .then(setIssues)
      .catch((err) => setIssueError(libraryErrorTextBlock(err, 'Could not list the issues.')))
  }, [available, symbol])

  /** Download an issue and return its vault path, or null when it failed. */
  const fetchIssue = useCallback(async (issueDate: string): Promise<string | null> => {
    if (!available) return null
    setFetchingIssue(issueDate)
    setIssueError(null)
    try {
      const path = await fetchValueLineIssueOrch(executionRoot!, symbol, issueDate)
      setFetchedCount(n => n + 1)
      return path
    } catch (err) {
      setIssueError(libraryErrorTextBlock(err, 'Download failed.'))
      return null
    } finally {
      setFetchingIssue(null)
    }
  }, [available, executionRoot, symbol])

  return { available, checking, notCovered, fetchedCount, issues, loadIssues, fetchIssue, fetchingIssue, issueError }
}
