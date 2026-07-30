import { useEffect, useState } from 'react'
import {
  getOpenAsksOrch,
  listAskProjectsOrch,
  type AskProject,
  type OpenAsksResult,
} from '@/services/orchestrators/aiActivityUndertakingOrch'

// Loads the wake list for Home: which projects have an old organizer with asks
// (the chips), and the open asks for whichever is selected. Selection defaults
// to the project with the most asks. Thin — all derivation is in the orch.

export interface WakeListState {
  projects: AskProject[]
  selected: string | null
  select: (projectId: string) => void
  asks: OpenAsksResult | null
  loadingProjects: boolean
  loadingAsks: boolean
  error: string | null
}

export function useWakeListBlock(): WakeListState {
  const [projects, setProjects] = useState<AskProject[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [asks, setAsks] = useState<OpenAsksResult | null>(null)
  const [loadingProjects, setLoadingProjects] = useState(true)
  const [loadingAsks, setLoadingAsks] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoadingProjects(true)
    void listAskProjectsOrch()
      .then(found => {
        if (cancelled) return
        setProjects(found)
        setSelected(prev => prev ?? found[0]?.projectId ?? null)
        setLoadingProjects(false)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setLoadingProjects(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const project = projects.find(p => p.projectId === selected)
    if (!project) {
      setAsks(null)
      return
    }
    let cancelled = false
    setLoadingAsks(true)
    void getOpenAsksOrch({ projectId: project.projectId, projectRoot: project.projectRoot })
      .then(result => {
        if (cancelled) return
        setAsks(result)
        setLoadingAsks(false)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setLoadingAsks(false)
      })
    return () => {
      cancelled = true
    }
  }, [selected, projects])

  return {
    projects,
    selected,
    select: setSelected,
    asks,
    loadingProjects,
    loadingAsks,
    error,
  }
}
