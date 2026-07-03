import { useCallback, useEffect, useState } from 'react'
import type { DragEvent, Dispatch, SetStateAction } from 'react'
import type { NodeRecord } from '@/services/lego_blocks/integrations/dbBlock'
import {
  hasNodeDragType,
  readDroppedNodeId,
  reorderNodesWithEdge,
  sortNodesForDisplay,
  type ChildStateBlock,
  type DropEdge,
} from '@/components/lego_blocks/units/BacklogListDomainBlock'

interface UseBacklogDragAndReorderBlockParams {
  allowProgramLayoutEditing: boolean
  programs: NodeRecord[]
  childrenByNode: Record<string, ChildStateBlock>
  setChildrenByNode: Dispatch<SetStateAction<Record<string, ChildStateBlock>>>
  setExpandedNodes: Dispatch<SetStateAction<Record<string, boolean>>>
  onDropNodeToNode?: (sourceUuid: string, target: NodeRecord) => Promise<void>
  onReorderSiblings?: (params: { parentKey: string | null; orderedNodes: NodeRecord[] }) => Promise<NodeRecord[] | void>
  setLocalError: (message: string | null) => void
}

interface UseBacklogDragAndReorderBlockResult {
  draggingNodeId: string | null
  dragOverNodeId: string | null
  dragOverEdge: DropEdge | null
  makeDragStart: (node: NodeRecord) => (event: DragEvent) => void
  handleDragEnd: () => void
  handleDragOver: (node: NodeRecord, event: DragEvent) => void
  handleDragLeave: (nodeId: string) => void
  handleDrop: (target: NodeRecord, event: DragEvent) => Promise<void>
  moveProgramByOffset: (program: NodeRecord, offset: -1 | 1) => Promise<void>
  moveProgramToIndex: (program: NodeRecord, nextIndex: number) => Promise<void>
}

export function useBacklogDragAndReorderBlock({
  allowProgramLayoutEditing,
  programs,
  childrenByNode,
  setChildrenByNode,
  setExpandedNodes,
  onDropNodeToNode,
  onReorderSiblings,
  setLocalError,
}: UseBacklogDragAndReorderBlockParams): UseBacklogDragAndReorderBlockResult {
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null)
  const [dragOverNodeId, setDragOverNodeId] = useState<string | null>(null)
  const [dragOverEdge, setDragOverEdge] = useState<DropEdge | null>(null)

  useEffect(() => {
    if (allowProgramLayoutEditing) return
    setDraggingNodeId(null)
    setDragOverNodeId(null)
    setDragOverEdge(null)
  }, [allowProgramLayoutEditing])

  const makeDragStart = useCallback((node: NodeRecord) => (event: DragEvent) => {
    if (!allowProgramLayoutEditing) {
      event.preventDefault()
      return
    }
    setDraggingNodeId(node.uuid)
    event.dataTransfer.setData('application/x-ltm-node-id', node.uuid)
    event.dataTransfer.setData('text/ltm-node-id', node.uuid)
    event.dataTransfer.setData('text/plain', `ltm-node:${node.uuid}`)
    event.dataTransfer.effectAllowed = 'move'
  }, [allowProgramLayoutEditing])

  const handleDragEnd = useCallback(() => {
    setDraggingNodeId(null)
    setDragOverNodeId(null)
    setDragOverEdge(null)
  }, [])

  const handleDragOver = useCallback((node: NodeRecord, event: DragEvent) => {
    if (!allowProgramLayoutEditing) return
    event.preventDefault()
    event.stopPropagation()
    if (draggingNodeId || hasNodeDragType(event)) {
      event.dataTransfer.dropEffect = 'move'
      const rowRect = (event.currentTarget as HTMLElement).getBoundingClientRect()
      const pointerOffsetY = event.clientY - rowRect.top
      const edge: DropEdge = pointerOffsetY < rowRect.height / 2 ? 'before' : 'after'
      setDragOverNodeId(node.uuid)
      setDragOverEdge(edge)
    }
  }, [allowProgramLayoutEditing, draggingNodeId])

  const handleDragLeave = useCallback((nodeId: string) => {
    if (dragOverNodeId !== nodeId) return
    setDragOverNodeId(null)
    setDragOverEdge(null)
  }, [dragOverNodeId])

  const patchMovedNode = useCallback((sourceUuid: string, targetNode: NodeRecord) => {
    let shouldExpandTarget = false

    setChildrenByNode(prev => {
      let changed = false
      let movedNode: NodeRecord | null = null
      const next: Record<string, ChildStateBlock> = {}

      for (const [key, state] of Object.entries(prev)) {
        const filteredNodes = state.nodes.filter(node => {
          if (node.uuid !== sourceUuid) return true
          movedNode = node
          return false
        })

        if (filteredNodes.length !== state.nodes.length) {
          changed = true
          next[key] = { ...state, nodes: filteredNodes }
        } else {
          next[key] = state
        }
      }

      if (movedNode) {
        const targetState = next[targetNode.uuid]
        if (targetState?.loaded) {
          const alreadyPresent = targetState.nodes.some(node => node.uuid === sourceUuid)
          if (!alreadyPresent) {
            const movedSource = movedNode as NodeRecord
            changed = true
            shouldExpandTarget = true
            next[targetNode.uuid] = {
              ...targetState,
              nodes: sortNodesForDisplay([
                ...targetState.nodes,
                {
                  ...movedSource,
                  parent: targetNode.key,
                  parentUuid: targetNode.uuid,
                  parentType: targetNode.type,
                  updatedAt: new Date().toISOString(),
                },
              ]),
            }
          }
        }
      }

      return changed ? next : prev
    })

    if (shouldExpandTarget) {
      setExpandedNodes(prev => ({ ...prev, [targetNode.uuid]: true }))
    }
  }, [setChildrenByNode, setExpandedNodes])

  const findSiblingContext = useCallback((nodeId: string): {
    parentUuid: string | null
    parentKey: string | null
    nodes: NodeRecord[]
  } | null => {
    if (programs.some(program => program.uuid === nodeId)) {
      return { parentUuid: null, parentKey: null, nodes: programs }
    }

    for (const [parentUuid, state] of Object.entries(childrenByNode)) {
      if (!state.loaded) continue
      if (state.nodes.some(node => node.uuid === nodeId)) {
        const parentNode = programs.find(program => program.uuid === parentUuid)
          ?? Object.values(childrenByNode)
            .flatMap(entry => entry.nodes)
            .find(node => node.uuid === parentUuid)
        return {
          parentUuid,
          parentKey: parentNode?.key ?? null,
          nodes: state.nodes,
        }
      }
    }
    return null
  }, [childrenByNode, programs])

  const patchSiblingOrderForParent = useCallback((parentUuid: string | null, orderedNodes: NodeRecord[]) => {
    if (!parentUuid) return
    setChildrenByNode(prev => {
      const state = prev[parentUuid]
      if (!state?.loaded) return prev
      return {
        ...prev,
        [parentUuid]: {
          ...state,
          nodes: orderedNodes,
        },
      }
    })
  }, [setChildrenByNode])

  const handleDrop = useCallback(async (target: NodeRecord, event: DragEvent) => {
    if (!allowProgramLayoutEditing) return
    event.preventDefault()
    event.stopPropagation()
    setDragOverNodeId(null)
    const edge = dragOverEdge ?? 'after'
    setDragOverEdge(null)

    const sourceId = readDroppedNodeId(event) ?? draggingNodeId
    if (!sourceId) return
    if (sourceId === target.uuid) {
      setLocalError('Cannot drop a node onto itself.')
      return
    }

    const sourceContext = findSiblingContext(sourceId)
    const targetContext = findSiblingContext(target.uuid)

    if (
      sourceContext
      && targetContext
      && sourceContext.parentUuid === targetContext.parentUuid
      && onReorderSiblings
    ) {
      const reordered = reorderNodesWithEdge(targetContext.nodes, sourceId, target.uuid, edge)
      if (!reordered) return

      const beforeOrder = targetContext.nodes.map(node => node.uuid).join('|')
      const nextOrder = reordered.map(node => node.uuid).join('|')
      if (beforeOrder === nextOrder) return

      setLocalError(null)
      try {
        const persisted = await onReorderSiblings({
          parentKey: targetContext.parentKey,
          orderedNodes: reordered,
        })
        const persistedById = new Map((persisted ?? []).map(node => [node.uuid, node]))
        const nextNodes = reordered.map(node => persistedById.get(node.uuid) ?? node)
        patchSiblingOrderForParent(targetContext.parentUuid, nextNodes)
      } catch (err) {
        setLocalError(err instanceof Error ? err.message : 'Failed to reorder nodes')
      }
      return
    }

    if (!onDropNodeToNode) return
    setLocalError(null)
    try {
      await onDropNodeToNode(sourceId, target)
      patchMovedNode(sourceId, target)
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to move node')
    }
  }, [
    allowProgramLayoutEditing,
    dragOverEdge,
    draggingNodeId,
    findSiblingContext,
    onDropNodeToNode,
    onReorderSiblings,
    patchMovedNode,
    patchSiblingOrderForParent,
    setLocalError,
  ])

  const moveProgramByOffset = useCallback(async (program: NodeRecord, offset: -1 | 1) => {
    if (!allowProgramLayoutEditing) return
    if (!onReorderSiblings) return
    const currentIndex = programs.findIndex(entry => entry.uuid === program.uuid)
    if (currentIndex < 0) return
    const nextIndex = currentIndex + offset
    if (nextIndex < 0 || nextIndex >= programs.length) return

    const reordered = [...programs]
    const [moved] = reordered.splice(currentIndex, 1)
    reordered.splice(nextIndex, 0, moved)

    setLocalError(null)
    try {
      await onReorderSiblings({
        parentKey: null,
        orderedNodes: reordered,
      })
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to reorder programs')
    }
  }, [allowProgramLayoutEditing, onReorderSiblings, programs, setLocalError])

  const moveProgramToIndex = useCallback(async (program: NodeRecord, nextIndex: number) => {
    if (!allowProgramLayoutEditing) return
    if (!onReorderSiblings) return
    if (!Number.isFinite(nextIndex)) return
    const currentIndex = programs.findIndex(entry => entry.uuid === program.uuid)
    if (currentIndex < 0) return
    const clamped = Math.max(0, Math.min(programs.length - 1, Math.trunc(nextIndex)))
    if (clamped === currentIndex) return

    const reordered = [...programs]
    const [moved] = reordered.splice(currentIndex, 1)
    reordered.splice(clamped, 0, moved)

    setLocalError(null)
    try {
      await onReorderSiblings({
        parentKey: null,
        orderedNodes: reordered,
      })
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Failed to reorder programs')
    }
  }, [allowProgramLayoutEditing, onReorderSiblings, programs, setLocalError])

  return {
    draggingNodeId,
    dragOverNodeId,
    dragOverEdge,
    makeDragStart,
    handleDragEnd,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    moveProgramByOffset,
    moveProgramToIndex,
  }
}
