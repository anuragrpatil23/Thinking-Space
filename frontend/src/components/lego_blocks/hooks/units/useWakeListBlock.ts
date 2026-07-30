import { useEffect, useState } from 'react'
import {
  getOpenNotesOrch,
  listNoteProjectsOrch,
  type NoteProject,
  type OpenNotesResult,
} from '@/services/orchestrators/aiActivityUndertakingOrch'

// Loads the wake list for Home: which projects have an old organizer with notes
// (the chips), and the open notes for whichever is selected. Selection defaults
// to the project with the most notes. Thin — all derivation is in the orch.

export interface WakeListState {
  projects: NoteProject[]
  selected: string | null
  select: (projectId: string) => void
  notes: OpenNotesResult | null
  loadingProjects: boolean
  loadingNotes: boolean
  error: string | null
}

export function useWakeListBlock(): WakeListState {
  const [projects, setProjects] = useState<NoteProject[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [notes, setNotes] = useState<OpenNotesResult | null>(null)
  const [loadingProjects, setLoadingProjects] = useState(true)
  const [loadingNotes, setLoadingAsks] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoadingProjects(true)
    void listNoteProjectsOrch()
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
      setNotes(null)
      return
    }
    let cancelled = false
    setLoadingAsks(true)
    void getOpenNotesOrch({ projectId: project.projectId, projectRoot: project.projectRoot })
      .then(result => {
        if (cancelled) return
        setNotes(result)
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
    notes,
    loadingProjects,
    loadingNotes,
    error,
  }
}
