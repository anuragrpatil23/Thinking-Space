import type { NodeType } from '@/services/lego_blocks/units/yamlNoteBlock'
import type { CapabilityActor, CapabilityName } from '@/services/lego_blocks/integrations/capabilityRegistryBlock'
import { STORAGE_KEYS, getJsonStorageItem } from '@/services/orchestrators/storageOrch'

const MAX_INPUT_BYTES = 64_000

const DESTRUCTIVE_CAPABILITIES = new Set<CapabilityName>([
  'organizer.node.delete',
])

const WRITE_CAPABILITIES = new Set<CapabilityName>([
  'organizer.node.create',
  'organizer.node.rename',
  'organizer.node.update',
  'organizer.node.move',
  'organizer.node.delete',
  'task.claim',
  'task.update_status',
  'run.log',
  'handoff.create',
  'comment.add',
  'thoughts.create',
  'todos.create',
  'todos.toggle',
  'tools.excalidraw.format',
  'tools.pdf.convert',
  'tools.transcript.clean_save',
])

export interface CapabilityPolicy {
  allowedWritableProjectRoots?: string[]
  allowedProjectRoots?: string[]
  allowedNodeTypes?: NodeType[]
  allowedRecordKinds?: string[]
  allowAgentWrites: boolean
  allowAgentDestructive: boolean
  maxInputBytes: number
}

export function validateCapabilityPolicy(params: {
  capability: CapabilityName
  input: unknown
  actor: CapabilityActor
}): void {
  const policy = getCapabilityPolicy()
  const inputSize = encodeUtf8Size(JSON.stringify(params.input ?? {}))
  if (inputSize > policy.maxInputBytes) {
    throw new Error(`Capability input exceeds max payload size (${policy.maxInputBytes} bytes).`)
  }

  if (params.actor.kind === 'agent') {
    if (!policy.allowAgentWrites && WRITE_CAPABILITIES.has(params.capability)) {
      throw new Error(`Agent writes are blocked by policy for capability: ${params.capability}`)
    }

    if (!policy.allowAgentDestructive && DESTRUCTIVE_CAPABILITIES.has(params.capability)) {
      throw new Error(`Agent destructive action is blocked by policy for capability: ${params.capability}`)
    }
  }

  const input = params.input as Record<string, unknown>
  const type = input.type
  if (type && typeof type === 'string' && policy.allowedNodeTypes && policy.allowedNodeTypes.length > 0) {
    if (!policy.allowedNodeTypes.includes(type as NodeType)) {
      throw new Error(`Node type "${type}" is blocked by policy.`)
    }
  }

  const projectRoot = input.projectRoot
  if (
    projectRoot &&
    typeof projectRoot === 'string' &&
    policy.allowedProjectRoots &&
    policy.allowedProjectRoots.length > 0
  ) {
    const normalized = normalizePath(projectRoot)
    const allow = policy.allowedProjectRoots.some(root => normalizePath(root) === normalized)
    if (!allow) {
      throw new Error(`Project root "${projectRoot}" is blocked by policy.`)
    }
  }

  if (
    projectRoot &&
    typeof projectRoot === 'string' &&
    WRITE_CAPABILITIES.has(params.capability) &&
    policy.allowedWritableProjectRoots &&
    policy.allowedWritableProjectRoots.length > 0
  ) {
    const normalized = normalizePath(projectRoot)
    const allow = policy.allowedWritableProjectRoots.some(root => normalizePath(root) === normalized)
    if (!allow) {
      throw new Error(`Writable project root "${projectRoot}" is blocked by policy.`)
    }
  }

  const recordKind = extractRecordKind(input)
  if (
    recordKind &&
    policy.allowedRecordKinds &&
    policy.allowedRecordKinds.length > 0 &&
    !policy.allowedRecordKinds.includes(recordKind)
  ) {
    throw new Error(`record_kind "${recordKind}" is blocked by policy.`)
  }
}

export function getCapabilityPolicy(): CapabilityPolicy {
  const fallback: CapabilityPolicy = {
    allowAgentWrites: true,
    allowAgentDestructive: true,
    maxInputBytes: MAX_INPUT_BYTES,
  }

  try {
    const parsed = getJsonStorageItem<Partial<CapabilityPolicy>>(STORAGE_KEYS.capabilityPolicy, {})
    return {
      allowAgentWrites: parsed.allowAgentWrites ?? fallback.allowAgentWrites,
      allowAgentDestructive: parsed.allowAgentDestructive ?? fallback.allowAgentDestructive,
      maxInputBytes: parsed.maxInputBytes ?? fallback.maxInputBytes,
      allowedWritableProjectRoots: Array.isArray(parsed.allowedWritableProjectRoots)
        ? parsed.allowedWritableProjectRoots.filter(v => typeof v === 'string')
        : undefined,
      allowedProjectRoots: Array.isArray(parsed.allowedProjectRoots)
        ? parsed.allowedProjectRoots.filter(v => typeof v === 'string')
        : undefined,
      allowedNodeTypes: Array.isArray(parsed.allowedNodeTypes)
        ? parsed.allowedNodeTypes.filter(v => typeof v === 'string') as NodeType[]
        : undefined,
      allowedRecordKinds: Array.isArray(parsed.allowedRecordKinds)
        ? parsed.allowedRecordKinds.filter(v => typeof v === 'string')
        : undefined,
    }
  } catch {
    return fallback
  }
}

function encodeUtf8Size(value: string): number {
  return new TextEncoder().encode(value).length
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/g, '')
}

function extractRecordKind(input: Record<string, unknown>): string | null {
  if (typeof input.record_kind === 'string' && input.record_kind.trim()) {
    return input.record_kind.trim()
  }

  const extraFields = input.extraFields
  if (extraFields && typeof extraFields === 'object') {
    const record = extraFields as Record<string, unknown>
    if (typeof record.record_kind === 'string' && record.record_kind.trim()) {
      return record.record_kind.trim()
    }
  }

  const updates = input.updates
  if (updates && typeof updates === 'object') {
    const record = updates as Record<string, unknown>
    if (typeof record.record_kind === 'string' && record.record_kind.trim()) {
      return record.record_kind.trim()
    }
    const updateExtra = record.extraFields
    if (updateExtra && typeof updateExtra === 'object') {
      const extra = updateExtra as Record<string, unknown>
      if (typeof extra.record_kind === 'string' && extra.record_kind.trim()) {
        return extra.record_kind.trim()
      }
    }
  }

  return null
}
