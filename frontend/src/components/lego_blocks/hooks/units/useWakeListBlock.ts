import { useEffect, useState } from 'react'
import {
  getOpenTasksOrch,
  listTaskProjectsOrch,
  type TaskProject,
  type OpenTasksResult,
} from '@/services/orchestrators/aiActivityUndertakingOrch'

// Loads the wake list for Home: which projects have an old organizer with tasks
// (the chips), and the open tasks for whichever is selected. Selection defaults
// to the project with the most tasks. Thin — all derivation is in the orch.

export interface WakeListState {
  projects: TaskProject[]
  selected: string | null
  select: (projectId: string) => void
  tasks: OpenTasksResult | null
  loadingProjects: boolean
  loadingTasks: boolean
  error: string | null
}

export function useWakeListBlock(): WakeListState {
  const [projects, setProjects] = useState<TaskProject[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [tasks, setTasks] = useState<OpenTasksResult | null>(null)
  const [loadingProjects, setLoadingProjects] = useState(true)
  const [loadingTasks, setLoadingTasks] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoadingProjects(true)
    void listTaskProjectsOrch()
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
      setTasks(null)
      return
    }
    let cancelled = false
    setLoadingTasks(true)
    void getOpenTasksOrch({ projectId: project.projectId, projectRoot: project.projectRoot })
      .then(result => {
        if (cancelled) return
        setTasks(result)
        setLoadingTasks(false)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setLoadingTasks(false)
      })
    return () => {
      cancelled = true
    }
  }, [selected, projects])

  return {
    projects,
    selected,
    select: setSelected,
    tasks,
    loadingProjects,
    loadingTasks,
    error,
  }
}
