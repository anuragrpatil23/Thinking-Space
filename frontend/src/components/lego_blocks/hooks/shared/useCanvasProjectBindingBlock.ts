import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CANVAS_BINDINGS_CHANGE_EVENT_BLOCK,
  readCanvasProjectBindingBlock,
  setCanvasProjectBindingBlock,
} from '@/services/lego_blocks/integrations/canvasProjectBindingBlock'
import { useProjectsBlock } from '@/components/lego_blocks/hooks/shared/useProjectsBlock'
import type { ProjectBlock } from '@/services/lego_blocks/units/projectBlock'

/**
 * useCanvasProjectBindingBlock — resolves which Project a given canvas surface
 * is bound to. Returns the bound project (or the first project as a graceful
 * default when no binding exists), plus a setter that persists a new binding.
 *
 * Surfaces (Home anchor, Webull F9 anchor) call this with their `surfaceId`
 * and render the resulting `name` / `mission`.
 */
export interface UseCanvasProjectBindingBlockResult {
  /** All projects in the settings list — convenient for the picker dropdown. */
  projects: ProjectBlock[]
  /** Currently bound projectId, or null when unset. */
  boundProjectId: string | null
  /** Resolved project: bound project if present, else the first project, else null. */
  project: ProjectBlock | null
  /** True when the binding flag is missing (not user-selected). */
  isDefaultBinding: boolean
  loading: boolean
  setBoundProjectId: (projectId: string | null) => Promise<void>
}

export function useCanvasProjectBindingBlock(surfaceId: string): UseCanvasProjectBindingBlockResult {
  const { projects, loading: projectsLoading } = useProjectsBlock()
  const [boundProjectId, setBoundProjectIdState] = useState<string | null>(null)
  const [bindingLoaded, setBindingLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    void readCanvasProjectBindingBlock(surfaceId).then(value => {
      if (cancelled) return
      setBoundProjectIdState(value)
      setBindingLoaded(true)
    })
    const handler = () => {
      void readCanvasProjectBindingBlock(surfaceId).then(value => {
        if (cancelled) return
        setBoundProjectIdState(value)
      })
    }
    if (typeof window !== 'undefined') {
      window.addEventListener(CANVAS_BINDINGS_CHANGE_EVENT_BLOCK, handler)
    }
    return () => {
      cancelled = true
      if (typeof window !== 'undefined') {
        window.removeEventListener(CANVAS_BINDINGS_CHANGE_EVENT_BLOCK, handler)
      }
    }
  }, [surfaceId])

  const setBoundProjectId = useCallback(async (projectId: string | null) => {
    await setCanvasProjectBindingBlock(surfaceId, projectId)
    setBoundProjectIdState(projectId)
  }, [surfaceId])

  const resolvedProject = useMemo<ProjectBlock | null>(() => {
    if (boundProjectId) {
      const found = projects.find(project => project.uuid === boundProjectId)
      if (found) return found
    }
    // Graceful default: if no binding (or binding points at a deleted project),
    // fall back to the first project; otherwise null so the UI can show an
    // empty-state CTA.
    return projects[0] ?? null
  }, [boundProjectId, projects])

  return {
    projects,
    boundProjectId,
    project: resolvedProject,
    isDefaultBinding: boundProjectId === null,
    loading: projectsLoading || !bindingLoaded,
    setBoundProjectId,
  }
}
