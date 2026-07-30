import {
  CAPABILITY_REGISTRY,
  type CapabilityDefinition,
  getCapabilityDefinition,
  type CapabilityActor,
  type CapabilityInputMap,
  type CapabilityName,
  type CapabilityOutputMap,
} from '@/services/lego_blocks/integrations/capabilityRegistryBlock'
import type { NodeRecord } from '@/services/lego_blocks/integrations/dbBlock'
import { ALLOWED_RECORD_KINDS, NODE_TYPES, type NodeType, type YAMLCommentEntry } from '@/services/lego_blocks/units/yamlNoteBlock'
import {
  deriveEpicStatusFromTaskStatuses,
  isTaskLikeNode,
  nodeStatusFromTaskStatus,
  normalizeTaskStatus,
  taskStatusFromNodeStatus,
} from '@/services/lego_blocks/integrations/statusPolicyBlock'
import {
  createCapabilityInputHash,
  writeCapabilityAuditEntry,
} from '@/services/lego_blocks/integrations/capabilityAuditLogBlock'
import { getCapabilityPolicy, validateCapabilityPolicy } from '@/services/lego_blocks/integrations/capabilityPolicyBlock'
import {
  createYamlNode,
  deleteYamlNode,
  getYamlNode,
  getYamlNodeByKey,
  listAllYamlNodes,
  listYamlChildren,
  listYamlRootNodes,
  moveYamlNode,
  readYamlFrontmatterByPath,
  renameYamlNode,
  searchYamlNodes,
  updateYamlNode,
} from '@/services/lego_blocks/integrations/yamlHierarchyBlock'
import {
  getVaultFS,
  peekVaultFSInstance,
  resetVaultFSInstance,
  setVaultFSInstance,
  type VaultFS,
} from '@/services/lego_blocks/integrations/fsBlock'
import { startActivity } from '@/services/lego_blocks/units/backgroundActivityBlock'
import { getStoredVaultRoot } from '@/services/lego_blocks/units/storageKeyBlock'
import { getUserCommentAuthorBlock } from '@/services/lego_blocks/units/userProfileBlock'
import { createThought } from './thoughtsOrch'
import { logDailyInsight } from '@/services/lego_blocks/integrations/dailyInsightsBlock'
import { createTodos, toggleTodo } from './todosOrch'
import { listFiles, listFolders, listPdfFiles } from './fileSystemOrch'
import { formatAndSave, previewFormat } from './formatExcalidrawOrch'
import { extractExcalidrawHighlights } from './excalidrawHighlightsOrch'
import { convertPdf, previewPdf } from './pdfToMarkdownOrch'
import { cleanAndSave, previewTranscript } from './transcriptCleanerOrch'
import { getCapabilityFeatureFlags } from '@/services/lego_blocks/integrations/capabilityFeatureFlagsBlock'
import {
  createAiSynthesisNoteOrch,
  getImpactedAiSynthesisNotesOrch,
  listDomainAiSynthesisHealthOrch,
  patchNoteFrontmatterOrch,
  readNoteOrch,
  resolveAiSynthesisPathOrch,
  updateAiSynthesisCompileStateOrch,
  writeNoteOrch,
} from './aiSynthesisInfraOrch'
import { readTelegramCredsBlock, sendTelegramMessageBlock } from '@/services/lego_blocks/integrations/telegramBotBlock'
import {
  closeConversationBlock,
  openConversationBlock,
} from '@/services/lego_blocks/integrations/telegramConversationBlock'
import {
  getUndertakingOrch,
  listChainsOrch,
  listUndertakingsOrch,
  recordAssignmentOrch,
  setChainFilesOrch,
  setChainProjectOrch,
  tagUndertakingOrch,
  updateUndertakingHeadOrch,
} from './aiActivityUndertakingOrch'

export interface CapabilityInvokeRequest<Name extends CapabilityName = CapabilityName> {
  capability: Name
  input: CapabilityInputMap[Name]
  actor?: CapabilityActor
  requestId?: string
  dryRun?: boolean
  extensionContext?: CapabilityInvokeExtensionContext
}

export interface CapabilityInvokeExtensionContext {
  extensionId: string
  extensionRegistryKey?: string
}

export interface CapabilityInvokeSuccess<Name extends CapabilityName> {
  ok: true
  capability: Name
  requestId: string
  actor: CapabilityActor
  dryRun: boolean
  auditId: string
  warnings: string[]
  data: CapabilityOutputMap[Name]
}

export interface CapabilityInvokeFailure<Name extends CapabilityName> {
  ok: false
  capability: Name
  requestId: string
  actor: CapabilityActor
  dryRun: boolean
  auditId: string
  warnings: string[]
  error: {
    code: 'CAPABILITY_VALIDATION_FAILED' | 'CAPABILITY_NOT_FOUND' | 'CAPABILITY_EXECUTION_FAILED' | 'CAPABILITY_DRY_RUN_UNSUPPORTED'
    message: string
  }
}

export type CapabilityInvokeResponse<Name extends CapabilityName> =
  | CapabilityInvokeSuccess<Name>
  | CapabilityInvokeFailure<Name>

const DEFAULT_ACTOR: CapabilityActor = {
  kind: 'human',
  id: 'ui.unknown',
}

const WRITE_CAPABILITIES = new Set<CapabilityName>([
  'write_note',
  'patch_note_frontmatter',
  'create_ai_synthesis_note',
  'update_ai_synthesis_compile_state',
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
  'daily.log_insight',
  'todos.create',
  'todos.toggle',
  'tools.excalidraw.format',
  'tools.pdf.convert',
  'tools.transcript.clean_save',
  'telegram.send_message',
  'telegram.open_conversation',
  'telegram.close_conversation',
])

export function listCapabilitiesOrch() {
  return CAPABILITY_REGISTRY
}

export interface CapabilityListAdapterResponse {
  ok: boolean
  capabilities?: CapabilityDefinition[]
}

export async function listCapabilitiesViaElectronAdapterOrch(): Promise<CapabilityListAdapterResponse> {
  if (!window.electronAPI?.isElectron) {
    throw new Error('Electron capability adapter is only available in Electron runtime.')
  }
  if (!window.electronAPI.capabilitiesList) {
    throw new Error('Electron capability adapter IPC is unavailable in preload.')
  }
  const response = await window.electronAPI.capabilitiesList()
  return response as CapabilityListAdapterResponse
}

export async function invokeCapabilityViaElectronAdapterOrch<Name extends CapabilityName>(
  request: CapabilityInvokeRequest<Name>,
): Promise<CapabilityInvokeResponse<Name>> {
  if (!window.electronAPI?.isElectron) {
    throw new Error('Electron capability adapter is only available in Electron runtime.')
  }
  if (!window.electronAPI.capabilitiesInvoke) {
    throw new Error('Electron capability adapter IPC is unavailable in preload.')
  }

  const vaultRoot = getStoredVaultRoot()
  if (!vaultRoot) {
    throw new Error('Vault root not configured')
  }

  const response = await window.electronAPI.capabilitiesInvoke({
    vaultRoot,
    request: request as unknown as {
      capability: string
      input: Record<string, unknown>
      actor?: { kind: 'human' | 'agent' | 'system'; id?: string }
      requestId?: string
      dryRun?: boolean
    },
  })
  return response as CapabilityInvokeResponse<Name>
}

export async function invokeCapabilityOrch<Name extends CapabilityName>(
  request: CapabilityInvokeRequest<Name>,
  options?: { fs?: VaultFS },
): Promise<CapabilityInvokeResponse<Name>> {
  const requestId = request.requestId || createRequestId()
  const auditId = createAuditId()
  const actor = request.actor ?? DEFAULT_ACTOR
  const dryRun = !!request.dryRun
  const warnings: string[] = []
  const fs = options?.fs

  const activity = startActivity({
    kind: 'capability',
    label: formatCapabilityLabel(request.capability),
    detail: dryRun ? 'Dry run' : undefined,
  })

  // When the caller supplies an fs, point the singleton at it for the duration
  // of this invoke. Most capabilities thread `fs` down explicitly, but several
  // orchestrators (thoughts.create, todos.toggle, the ai_activity blocks) reach
  // for `getVaultFS()` instead — which outside a browser hands back the web
  // fallback and fails, or worse returns empty. The CLI and the parity harness
  // both supply an fs precisely because the singleton is not the right answer
  // there; honoring it here is what makes those two paths agree.
  //
  // Restored in the finally: the parity harness runs two adapters against two
  // temp vaults in one process, so a singleton left pointing at a since-deleted
  // vault breaks the next call.
  const previousFs = peekVaultFSInstance()
  if (fs) setVaultFSInstance(fs)

  try {

  const definition = getCapabilityDefinition(request.capability)
  if (!definition) {
    const response: CapabilityInvokeFailure<Name> = {
      ok: false,
      capability: request.capability,
      requestId,
      actor,
      dryRun,
      auditId,
      warnings,
      error: {
        code: 'CAPABILITY_NOT_FOUND',
        message: `Unknown capability: ${request.capability}`,
      },
    }
    await auditCapability({
      auditId,
      requestId,
      request,
      actor,
      dryRun,
      warnings,
      ok: false,
      errorCode: response.error.code,
      errorMessage: response.error.message,
      fs,
    })
    return response
  }

  try {
    if (actor.kind === 'agent' && !getCapabilityFeatureFlags().agent_capabilities_enabled) {
      throw new Error('Agent capabilities are disabled by feature flag.')
    }

    validateCapabilityPolicy({
      capability: request.capability,
      input: request.input,
      actor,
    })

    if (dryRun && WRITE_CAPABILITIES.has(request.capability)) {
      const preview = await executeDryRunCapability(request.capability, request.input)
      if (preview) {
        warnings.push('Dry-run preview only. No files were modified.')
        const success: CapabilityInvokeSuccess<Name> = {
          ok: true,
          capability: request.capability,
          requestId,
          actor,
          dryRun,
          auditId,
          warnings,
          data: preview as CapabilityOutputMap[Name],
        }
        await auditCapability({
          auditId,
          requestId,
          request,
          actor,
          dryRun,
          warnings,
          ok: true,
          touchedPaths: extractTouchedPaths(request.capability, success.data),
          fs,
        })
        return success
      }

      const unsupported: CapabilityInvokeFailure<Name> = {
        ok: false,
        capability: request.capability,
        requestId,
        actor,
        dryRun,
        auditId,
        warnings,
        error: {
          code: 'CAPABILITY_DRY_RUN_UNSUPPORTED',
          message: `Dry-run is not implemented for ${request.capability}.`,
        },
      }
      await auditCapability({
        auditId,
        requestId,
        request,
        actor,
        dryRun,
        warnings,
        ok: false,
        errorCode: unsupported.error.code,
        errorMessage: unsupported.error.message,
        fs,
      })
      return unsupported
    }

    const data = await executeCapability(request.capability, request.input, fs)
    const success: CapabilityInvokeSuccess<Name> = {
      ok: true,
      capability: request.capability,
      requestId,
      actor,
      dryRun,
      auditId,
      warnings,
      data,
    }
    await auditCapability({
      auditId,
      requestId,
      request,
      actor,
      dryRun,
      warnings,
      ok: true,
      touchedPaths: extractTouchedPaths(request.capability, data),
      fs,
    })
    return success
  } catch (error) {
    const failure: CapabilityInvokeFailure<Name> = {
      ok: false,
      capability: request.capability,
      requestId,
      actor,
      dryRun,
      auditId,
      warnings,
      error: {
        code: 'CAPABILITY_EXECUTION_FAILED',
        message: error instanceof Error ? error.message : String(error),
      },
    }
    await auditCapability({
      auditId,
      requestId,
      request,
      actor,
      dryRun,
      warnings,
      ok: false,
      errorCode: failure.error.code,
      errorMessage: failure.error.message,
      fs,
    })
    return failure
  }

  } finally {
    activity.end()
    if (fs) {
      if (previousFs) setVaultFSInstance(previousFs)
      else resetVaultFSInstance()
    }
  }
}

export async function invokeCapabilityOrThrow<Name extends CapabilityName>(
  request: CapabilityInvokeRequest<Name>,
  options?: { fs?: VaultFS },
): Promise<CapabilityOutputMap[Name]> {
  const response = await invokeCapabilityOrch(request, options)
  if (!response.ok) {
    throw new Error(response.error.message)
  }
  return response.data
}

async function executeCapability<Name extends CapabilityName>(
  capability: Name,
  input: CapabilityInputMap[Name],
  fs?: VaultFS,
): Promise<CapabilityOutputMap[Name]> {
  switch (capability) {
    case 'read_note': {
      const payload = input as CapabilityInputMap['read_note']
      assertNonEmptyString(payload.path, 'path')
      const note = await readNoteOrch(fs ?? getVaultFS(), payload.path)
      return note as CapabilityOutputMap[Name]
    }
    case 'write_note': {
      const payload = input as CapabilityInputMap['write_note']
      assertNonEmptyString(payload.path, 'path')
      const result = await writeNoteOrch(fs ?? getVaultFS(), payload)
      return result as CapabilityOutputMap[Name]
    }
    case 'patch_note_frontmatter': {
      const payload = input as CapabilityInputMap['patch_note_frontmatter']
      assertNonEmptyString(payload.path, 'path')
      const result = await patchNoteFrontmatterOrch(fs ?? getVaultFS(), payload)
      return result as CapabilityOutputMap[Name]
    }
    case 'resolve_ai_synthesis_path': {
      const payload = input as CapabilityInputMap['resolve_ai_synthesis_path']
      assertNonEmptyString(payload.domain_root, 'domain_root')
      assertNonEmptyString(payload.synthesis_type, 'synthesis_type')
      assertNonEmptyString(payload.slug, 'slug')
      const result = await resolveAiSynthesisPathOrch(fs ?? getVaultFS(), payload)
      return result as CapabilityOutputMap[Name]
    }
    case 'create_ai_synthesis_note': {
      const payload = input as CapabilityInputMap['create_ai_synthesis_note']
      assertNonEmptyString(payload.domain_root, 'domain_root')
      assertNonEmptyString(payload.layer, 'layer')
      assertNonEmptyString(payload.synthesis_type, 'synthesis_type')
      if (!Array.isArray(payload.derived_from) || payload.derived_from.length === 0) {
        throw new Error('derived_from must contain at least one path')
      }
      const result = await createAiSynthesisNoteOrch(fs ?? getVaultFS(), payload)
      return result as CapabilityOutputMap[Name]
    }
    case 'get_impacted_ai_synthesis_notes': {
      const payload = input as CapabilityInputMap['get_impacted_ai_synthesis_notes']
      if (!Array.isArray(payload.changed_paths) || payload.changed_paths.length === 0) {
        throw new Error('changed_paths must contain at least one path')
      }
      const result = await getImpactedAiSynthesisNotesOrch(fs ?? getVaultFS(), payload)
      return result as CapabilityOutputMap[Name]
    }
    case 'update_ai_synthesis_compile_state': {
      const payload = input as CapabilityInputMap['update_ai_synthesis_compile_state']
      assertNonEmptyString(payload.path, 'path')
      assertNonEmptyString(payload.compile_status, 'compile_status')
      const result = await updateAiSynthesisCompileStateOrch(fs ?? getVaultFS(), payload)
      return result as CapabilityOutputMap[Name]
    }
    case 'list_domain_ai_synthesis_health': {
      const payload = input as CapabilityInputMap['list_domain_ai_synthesis_health']
      assertNonEmptyString(payload.domain_root, 'domain_root')
      const result = await listDomainAiSynthesisHealthOrch(fs ?? getVaultFS(), payload)
      return result as CapabilityOutputMap[Name]
    }
    case 'organizer.nodes.list_roots': {
      const payload = input as CapabilityInputMap['organizer.nodes.list_roots']
      const nodes = await listYamlRootNodes(payload.typeFilter)
      return { nodes } as CapabilityOutputMap[Name]
    }
    case 'organizer.nodes.list_children': {
      const payload = input as CapabilityInputMap['organizer.nodes.list_children']
      assertNonEmptyString(payload.parentKey, 'parentKey')
      const nodes = await listYamlChildren(payload.parentKey)
      return { nodes } as CapabilityOutputMap[Name]
    }
    case 'organizer.nodes.list_all': {
      const nodes = await listAllYamlNodes()
      return { nodes } as CapabilityOutputMap[Name]
    }
    case 'organizer.nodes.search': {
      const payload = input as CapabilityInputMap['organizer.nodes.search']
      assertNonEmptyString(payload.query, 'query')
      const nodes = await searchYamlNodes(payload.query, payload.limit)
      return { nodes } as CapabilityOutputMap[Name]
    }
    case 'organizer.node.get': {
      const payload = input as CapabilityInputMap['organizer.node.get']
      assertNonEmptyString(payload.uuid, 'uuid')
      const node = await getYamlNode(payload.uuid)
      return { node: node ?? null } as CapabilityOutputMap[Name]
    }
    case 'organizer.node.get_by_key': {
      const payload = input as CapabilityInputMap['organizer.node.get_by_key']
      assertNonEmptyString(payload.key, 'key')
      const node = await getYamlNodeByKey(payload.key)
      return { node: node ?? null } as CapabilityOutputMap[Name]
    }
    case 'organizer.node.read_frontmatter': {
      const payload = input as CapabilityInputMap['organizer.node.read_frontmatter']
      assertNonEmptyString(payload.filePath, 'filePath')
      const frontmatter = await readYamlFrontmatterByPath(payload.filePath, fs)
      return { frontmatter } as CapabilityOutputMap[Name]
    }
    case 'organizer.node.create': {
      const payload = input as CapabilityInputMap['organizer.node.create']
      assertNonEmptyString(payload.title, 'title')
      assertValidNodeType(payload.type)
      assertValidRecordKind(payload.extraFields?.record_kind)
      assertWritableProjectRootAllowed(payload.projectRoot, 'organizer.node.create')
      const normalizedCreatePayload = normalizeCreatePayloadForStatusPolicy(payload)
      const node = await createYamlNode({ ...normalizedCreatePayload, fs })
      await applyEpicStatusPolicyForAffectedNodes({
        changedNodes: [node],
        changedParentKeys: [payload.parentKey],
        fs,
      })
      return { node } as CapabilityOutputMap[Name]
    }
    case 'organizer.node.rename': {
      const payload = input as CapabilityInputMap['organizer.node.rename']
      assertNonEmptyString(payload.uuid, 'uuid')
      assertNonEmptyString(payload.newTitle, 'newTitle')
      const node = await renameYamlNode(payload.uuid, payload.newTitle, fs)
      return { node } as CapabilityOutputMap[Name]
    }
    case 'organizer.node.update': {
      const payload = input as CapabilityInputMap['organizer.node.update']
      assertNonEmptyString(payload.uuid, 'uuid')
      if (payload.updates.type !== undefined) assertValidNodeType(payload.updates.type)
      assertValidRecordKind(payload.updates.extraFields?.record_kind)
      const existing = await getYamlNode(payload.uuid)
      if (!existing) throw new Error(`Node not found: ${payload.uuid}`)
      const normalizedUpdates = normalizeNodeUpdatesForStatusPolicy(existing, payload.updates)
      const manualEpicStatusOverrideKey = (
        existing.type === 'epic' && normalizedUpdates.status !== undefined
      )
        ? existing.key
        : undefined
      const node = await updateYamlNode(payload.uuid, normalizedUpdates, fs)
      await applyEpicStatusPolicyForAffectedNodes({
        changedNodes: [node],
        changedParentKeys: [existing.parent, node.parent],
        skipEpicKeys: manualEpicStatusOverrideKey ? [manualEpicStatusOverrideKey] : undefined,
        fs,
      })
      return { node } as CapabilityOutputMap[Name]
    }
    case 'organizer.node.move': {
      const payload = input as CapabilityInputMap['organizer.node.move']
      assertNonEmptyString(payload.uuid, 'uuid')
      const existing = await getYamlNode(payload.uuid)
      const node = await moveYamlNode(payload.uuid, payload.newParentKey, fs)
      await applyEpicStatusPolicyForAffectedNodes({
        changedNodes: [node],
        changedParentKeys: [existing?.parent, node.parent, payload.newParentKey],
        fs,
      })
      return { node } as CapabilityOutputMap[Name]
    }
    case 'organizer.node.delete': {
      const payload = input as CapabilityInputMap['organizer.node.delete']
      assertNonEmptyString(payload.uuid, 'uuid')
      const existing = await getYamlNode(payload.uuid)
      const childCount = existing ? (await listYamlChildren(existing.key)).length : 0
      await deleteYamlNode(payload.uuid, fs)
      await applyEpicStatusPolicyForAffectedNodes({
        changedNodes: [],
        changedParentKeys: [existing?.parent],
        fs,
      })
      return {
        deleted: true,
        preview: existing
          ? {
            nodeUuid: existing.uuid,
            filePath: existing.filePath,
            parentKey: existing.parent ?? null,
            childCount,
            touchedPaths: [existing.filePath],
          }
          : undefined,
      } as CapabilityOutputMap[Name]
    }
    case 'task.claim': {
      const payload = input as CapabilityInputMap['task.claim']
      assertNonEmptyString(payload.uuid, 'uuid')
      assertNonEmptyString(payload.owner, 'owner')

      const source = await getYamlNode(payload.uuid)
      if (!source) throw new Error(`Node not found: ${payload.uuid}`)
      assertTaskNode(source)
      assertWritableProjectRootAllowed(source.projectRoot, 'task.claim')

      const status = payload.taskStatus?.trim() || 'in_progress'
      const normalizedTaskStatus = normalizeTaskStatus(status) ?? 'in_progress'
      const history = appendStateHistory(source, {
        from: source.taskStatus,
        to: normalizedTaskStatus,
        note: payload.note ?? `Claimed by ${payload.owner}`,
      }, payload.owner)

      const node = await updateYamlNode(payload.uuid, {
        status: nodeStatusFromTaskStatus(normalizedTaskStatus),
        extraFields: {
          record_kind: 'task',
          task_status: normalizedTaskStatus,
          owner: payload.owner.trim(),
          state_history: history,
          schema_version: '2',
        },
      }, fs)
      await applyEpicStatusPolicyForAffectedNodes({
        changedNodes: [node],
        changedParentKeys: [source.parent, node.parent],
        fs,
      })
      return { node } as CapabilityOutputMap[Name]
    }
    case 'task.update_status': {
      const payload = input as CapabilityInputMap['task.update_status']
      assertNonEmptyString(payload.uuid, 'uuid')
      assertNonEmptyString(payload.taskStatus, 'taskStatus')

      const source = await getYamlNode(payload.uuid)
      if (!source) throw new Error(`Node not found: ${payload.uuid}`)
      assertTaskNode(source)
      assertWritableProjectRootAllowed(source.projectRoot, 'task.update_status')

      const status = normalizeTaskStatus(payload.taskStatus.trim()) ?? 'in_progress'
      const history = appendStateHistory(source, {
        from: source.taskStatus,
        to: status,
        note: payload.note,
      }, source.owner || 'unknown')

      const node = await updateYamlNode(payload.uuid, {
        status: nodeStatusFromTaskStatus(status),
        extraFields: {
          record_kind: 'task',
          task_status: status,
          state_history: history,
          schema_version: '2',
        },
      }, fs)
      await applyEpicStatusPolicyForAffectedNodes({
        changedNodes: [node],
        changedParentKeys: [source.parent, node.parent],
        fs,
      })
      return { node } as CapabilityOutputMap[Name]
    }
    case 'run.log': {
      const payload = input as CapabilityInputMap['run.log']
      assertNonEmptyString(payload.title, 'title')
      assertNonEmptyString(payload.projectRoot, 'projectRoot')
      assertWritableProjectRootAllowed(payload.projectRoot, 'run.log')

      const node = await createYamlNode({
        type: 'run',
        title: payload.title,
        parentKey: payload.parentKey,
        parentUuid: payload.parentUuid,
        parentType: payload.parentType,
        body: payload.body,
        tags: ['ops/run'],
        projectRoot: payload.projectRoot,
        extraFields: {
          record_kind: 'run',
          schema_version: '2',
          run_id: payload.runId || createRunId(),
          session_id: payload.sessionId,
          agent_name: payload.agentName,
          model: payload.model,
          started_at: payload.startedAt || new Date().toISOString(),
          ended_at: payload.endedAt,
          result: payload.result,
          source_repo: payload.sourceRepo,
          branch: payload.branch,
          commit: payload.commit,
          artifacts: payload.artifacts,
          related_nodes: payload.relatedNodes,
        },
        fs,
      })
      return { node } as CapabilityOutputMap[Name]
    }
    case 'handoff.create': {
      const payload = input as CapabilityInputMap['handoff.create']
      assertNonEmptyString(payload.title, 'title')
      assertNonEmptyString(payload.projectRoot, 'projectRoot')
      assertNonEmptyString(payload.summary, 'summary')
      assertWritableProjectRootAllowed(payload.projectRoot, 'handoff.create')

      const body = payload.body || buildHandoffBody({
        summary: payload.summary,
        fromAgent: payload.fromAgent,
        toAgent: payload.toAgent,
      })

      const node = await createYamlNode({
        type: 'handoff',
        title: payload.title,
        parentKey: payload.parentKey,
        parentUuid: payload.parentUuid,
        parentType: payload.parentType,
        body,
        description: payload.summary.trim(),
        tags: ['ops/handoff'],
        projectRoot: payload.projectRoot,
        extraFields: {
          record_kind: 'handoff',
          schema_version: '2',
          source_repo: payload.sourceRepo,
          branch: payload.branch,
          commit: payload.commit,
          artifacts: payload.artifacts,
          related_nodes: payload.relatedNodes,
          state_history: [
            {
              at: new Date().toISOString(),
              from: '',
              to: 'created',
              note: payload.summary || 'Handoff created',
            },
          ],
        },
        fs,
      })
      return { node } as CapabilityOutputMap[Name]
    }
    case 'comment.add': {
      const payload = input as CapabilityInputMap['comment.add']
      assertNonEmptyString(payload.uuid, 'uuid')
      assertNonEmptyString(payload.text, 'text')

      const source = await getYamlNode(payload.uuid)
      if (!source) throw new Error(`Node not found: ${payload.uuid}`)
      assertWritableProjectRootAllowed(source.projectRoot, 'comment.add')

      const comments: YAMLCommentEntry[] = [
        ...(source.comments ?? []),
        {
          text: payload.text.trim(),
          added_at: new Date().toISOString(),
          added_by: payload.addedBy?.trim() || getUserCommentAuthorBlock(),
        },
      ]

      const node = await updateYamlNode(payload.uuid, { comments }, fs)
      return { node } as CapabilityOutputMap[Name]
    }
    case 'thoughts.create': {
      const payload = input as CapabilityInputMap['thoughts.create']
      assertNonEmptyString(payload.folder_path, 'folder_path')
      assertNonEmptyString(payload.filename, 'filename')
      assertNonEmptyString(payload.content, 'content')
      const output = await createThought(payload)
      return output as CapabilityOutputMap[Name]
    }
    case 'daily.log_insight': {
      const payload = input as CapabilityInputMap['daily.log_insight']
      if (!Array.isArray(payload.insights)) {
        throw new Error('insights must be an array of strings')
      }
      const output = await logDailyInsight(payload, fs ?? getVaultFS())
      return output as CapabilityOutputMap[Name]
    }
    case 'todos.create': {
      const payload = input as CapabilityInputMap['todos.create']
      assertNonEmptyString(payload.folderPath, 'folderPath')
      assertNonEmptyString(payload.date, 'date')
      const output = await createTodos(payload.folderPath, payload.date, payload.items)
      return output as CapabilityOutputMap[Name]
    }
    case 'todos.toggle': {
      const payload = input as CapabilityInputMap['todos.toggle']
      assertNonEmptyString(payload.filePath, 'filePath')
      if (!Number.isInteger(payload.lineNumber) || payload.lineNumber <= 0) {
        throw new Error('lineNumber must be a positive integer')
      }
      await toggleTodo(payload.filePath, payload.lineNumber)
      return {
        toggled: true,
        filePath: payload.filePath,
      } as CapabilityOutputMap[Name]
    }
    case 'tools.files.list_markdown': {
      const payload = input as CapabilityInputMap['tools.files.list_markdown']
      const files = await listFiles(payload.limit)
      return { files } as CapabilityOutputMap[Name]
    }
    case 'tools.files.list_pdf': {
      const payload = input as CapabilityInputMap['tools.files.list_pdf']
      const files = await listPdfFiles(payload.limit)
      return { files } as CapabilityOutputMap[Name]
    }
    case 'tools.folders.list': {
      const payload = input as CapabilityInputMap['tools.folders.list']
      const folders = await listFolders(payload.limit)
      return { folders } as CapabilityOutputMap[Name]
    }
    case 'tools.excalidraw.preview': {
      const payload = input as CapabilityInputMap['tools.excalidraw.preview']
      assertNonEmptyString(payload.inputPath, 'inputPath')
      const preview = await previewFormat(payload.inputPath, payload.options)
      return { preview } as CapabilityOutputMap[Name]
    }
    case 'tools.excalidraw.format': {
      const payload = input as CapabilityInputMap['tools.excalidraw.format']
      assertNonEmptyString(payload.inputPath, 'inputPath')
      const result = await formatAndSave(payload.inputPath, payload.options)
      return { result } as CapabilityOutputMap[Name]
    }
    case 'tools.excalidraw.highlights': {
      const payload = input as CapabilityInputMap['tools.excalidraw.highlights']
      assertNonEmptyString(payload.inputPath, 'inputPath')
      const result = await extractExcalidrawHighlights(payload.inputPath, fs)
      return { result } as CapabilityOutputMap[Name]
    }
    case 'tools.pdf.preview': {
      const payload = input as CapabilityInputMap['tools.pdf.preview']
      assertNonEmptyString(payload.inputPath, 'inputPath')
      const preview = await previewPdf(payload.inputPath, payload.options)
      return { preview } as CapabilityOutputMap[Name]
    }
    case 'tools.pdf.convert': {
      const payload = input as CapabilityInputMap['tools.pdf.convert']
      assertNonEmptyString(payload.inputPath, 'inputPath')
      const result = await convertPdf(payload.inputPath, payload.options)
      return { result } as CapabilityOutputMap[Name]
    }
    case 'tools.transcript.preview': {
      const payload = input as CapabilityInputMap['tools.transcript.preview']
      assertNonEmptyString(payload.inputText, 'inputText')
      const result = previewTranscript(payload.inputText, payload.headingsText, payload.options)
      return { result } as CapabilityOutputMap[Name]
    }
    case 'tools.transcript.clean_save': {
      const payload = input as CapabilityInputMap['tools.transcript.clean_save']
      assertNonEmptyString(payload.input_text, 'input_text')
      assertNonEmptyString(payload.output_folder, 'output_folder')
      assertNonEmptyString(payload.output_name, 'output_name')
      const result = await cleanAndSave({ ...payload, fs })
      return { result } as CapabilityOutputMap[Name]
    }
    case 'telegram.send_message': {
      const payload = input as CapabilityInputMap['telegram.send_message']
      assertNonEmptyString(payload.text, 'text')
      const sent = await sendTelegramMessageBlock({
        text: payload.text,
        parseMode: payload.parseMode,
        chatId: payload.chatId,
      })
      return {
        messageId: sent.messageId,
        chatId: sent.chatId,
        sentAt: new Date(sent.date * 1000).toISOString(),
      } as CapabilityOutputMap[Name]
    }
    case 'telegram.open_conversation': {
      const payload = input as CapabilityInputMap['telegram.open_conversation']
      assertNonEmptyString(payload.scheduleKey, 'scheduleKey')
      assertNonEmptyString(payload.sessionId, 'sessionId')
      const chatId = payload.chatId ?? readTelegramCredsBlock().chatId
      const result = openConversationBlock({
        convId: payload.convId,
        chatId,
        scheduleKey: payload.scheduleKey,
        sessionId: payload.sessionId,
        cwd: payload.cwd,
        ttlAt: payload.ttlAt,
      })
      return result as CapabilityOutputMap[Name]
    }
    case 'telegram.close_conversation': {
      const payload = input as CapabilityInputMap['telegram.close_conversation']
      assertNonEmptyString(payload.convId, 'convId')
      const result = closeConversationBlock({
        convId: payload.convId,
        reason: payload.reason,
        deleteClaudeSession: payload.deleteClaudeSession,
      })
      return result as CapabilityOutputMap[Name]
    }
    case 'ai_activity.undertakings.list': {
      const payload = input as CapabilityInputMap['ai_activity.undertakings.list']
      assertNonEmptyString(payload.projectId, 'projectId')
      const undertakings = await listUndertakingsOrch(payload.projectId, payload.section)
      return { undertakings } as CapabilityOutputMap[Name]
    }
    case 'ai_activity.undertaking.get': {
      const payload = input as CapabilityInputMap['ai_activity.undertaking.get']
      assertNonEmptyString(payload.projectId, 'projectId')
      assertNonEmptyString(payload.key, 'key')
      const undertaking = await getUndertakingOrch(payload.projectId, payload.key)
      return { undertaking } as CapabilityOutputMap[Name]
    }
    case 'ai_activity.undertaking.update_head': {
      const payload = input as CapabilityInputMap['ai_activity.undertaking.update_head']
      assertNonEmptyString(payload.projectId, 'projectId')
      assertNonEmptyString(payload.key, 'key')
      assertNonEmptyString(payload.text, 'text')
      const result = await updateUndertakingHeadOrch(payload.projectId, payload.key, payload.text)
      return result as CapabilityOutputMap[Name]
    }
    case 'ai_activity.undertaking.tag': {
      const payload = input as CapabilityInputMap['ai_activity.undertaking.tag']
      assertNonEmptyString(payload.projectId, 'projectId')
      assertNonEmptyString(payload.key, 'key')
      const result = await tagUndertakingOrch(payload.projectId, payload.key, {
        add: payload.add,
        remove: payload.remove,
        accept: payload.accept,
        reject: payload.reject,
        allowNew: payload.allowNew,
      })
      return result as CapabilityOutputMap[Name]
    }
    case 'ai_activity.assignment.record': {
      const payload = input as CapabilityInputMap['ai_activity.assignment.record']
      assertNonEmptyString(payload.sessionId, 'sessionId')
      if (!Array.isArray(payload.undertakings) || payload.undertakings.length === 0) {
        throw new Error('Missing required field: undertakings')
      }
      const result = await recordAssignmentOrch(payload)
      return result as CapabilityOutputMap[Name]
    }
    case 'ai_activity.chains.list': {
      const payload = input as CapabilityInputMap['ai_activity.chains.list']
      assertNonEmptyString(payload.projectId, 'projectId')
      const chains = await listChainsOrch(payload)
      return { chains } as CapabilityOutputMap[Name]
    }
    case 'ai_activity.chain.set_project': {
      const payload = input as CapabilityInputMap['ai_activity.chain.set_project']
      assertNonEmptyString(payload.projectId, 'projectId')
      assertNonEmptyString(payload.chainKey, 'chainKey')
      assertNonEmptyString(payload.toProjectId, 'toProjectId')
      const result = await setChainProjectOrch(
        payload.projectId,
        payload.chainKey,
        payload.toProjectId,
      )
      return result as CapabilityOutputMap[Name]
    }
    case 'ai_activity.chain.set_files': {
      const payload = input as CapabilityInputMap['ai_activity.chain.set_files']
      assertNonEmptyString(payload.projectId, 'projectId')
      assertNonEmptyString(payload.chainKey, 'chainKey')
      const result = await setChainFilesOrch(payload.projectId, payload.chainKey, {
        written: payload.written,
        read: payload.read,
      })
      return result as CapabilityOutputMap[Name]
    }
    default:
      throw new Error(`Capability not implemented: ${String(capability)}`)
  }
}

async function executeDryRunCapability<Name extends CapabilityName>(
  capability: Name,
  input: CapabilityInputMap[Name],
): Promise<CapabilityOutputMap[Name] | null> {
  switch (capability) {
    case 'write_note':
    case 'patch_note_frontmatter':
    case 'create_ai_synthesis_note':
    case 'update_ai_synthesis_compile_state':
    case 'organizer.node.move': {
      if (capability !== 'organizer.node.move') return null
      const payload = input as CapabilityInputMap['organizer.node.move']
      assertNonEmptyString(payload.uuid, 'uuid')
      const source = await getYamlNode(payload.uuid)
      if (!source) throw new Error(`Node not found: ${payload.uuid}`)

      const fromParentKey = source.parent ?? null
      let toParentKey: string | null = payload.newParentKey
      let toParentUuid = source.parentUuid
      let toParentType = source.parentType
      if (payload.newParentKey) {
        const parent = await getYamlNodeByKey(payload.newParentKey)
        if (!parent) throw new Error(`Parent not found: ${payload.newParentKey}`)
        toParentKey = parent.key
        toParentUuid = parent.uuid
        toParentType = parent.type
      } else {
        toParentKey = null
        toParentUuid = undefined
        toParentType = undefined
      }

      const previewNode = {
        ...source,
        parent: toParentKey ?? undefined,
        parentUuid: toParentUuid,
        parentType: toParentType,
        updatedAt: new Date().toISOString(),
      }

      return {
        node: previewNode,
        preview: {
          nodeUuid: source.uuid,
          fromParentKey,
          toParentKey,
          touchedPaths: [source.filePath],
        },
      } as unknown as CapabilityOutputMap[Name]
    }

    case 'organizer.node.delete': {
      const payload = input as CapabilityInputMap['organizer.node.delete']
      assertNonEmptyString(payload.uuid, 'uuid')
      const target = await getYamlNode(payload.uuid)
      if (!target) {
        return {
          deleted: true,
          preview: {
            nodeUuid: payload.uuid,
            parentKey: null,
            childCount: 0,
            touchedPaths: [],
          },
        } as unknown as CapabilityOutputMap[Name]
      }

      const childCount = (await listYamlChildren(target.key)).length
      return {
        deleted: true,
        preview: {
          nodeUuid: target.uuid,
          filePath: target.filePath,
          parentKey: target.parent ?? null,
          childCount,
          touchedPaths: [target.filePath],
        },
      } as unknown as CapabilityOutputMap[Name]
    }
    default:
      return null
  }
}

function assertNonEmptyString(value: string | undefined, field: string): void {
  if (!value || !value.trim()) {
    throw new Error(`Missing required field: ${field}`)
  }
}

function createRequestId(): string {
  const rand = Math.random().toString(36).slice(2, 8)
  return `cap-${Date.now().toString(36)}-${rand}`
}

function createAuditId(): string {
  const rand = Math.random().toString(36).slice(2, 8)
  return `audit-${Date.now().toString(36)}-${rand}`
}

function createRunId(): string {
  const rand = Math.random().toString(36).slice(2, 8)
  return `run-${Date.now().toString(36)}-${rand}`
}

function extractTouchedPaths<Name extends CapabilityName>(
  capability: Name,
  data: CapabilityOutputMap[Name],
): string[] {
  switch (capability) {
    case 'write_note':
    case 'patch_note_frontmatter':
    case 'resolve_ai_synthesis_path':
    case 'create_ai_synthesis_note':
    case 'update_ai_synthesis_compile_state': {
      const output = data as
        | CapabilityOutputMap['write_note']
        | CapabilityOutputMap['patch_note_frontmatter']
        | CapabilityOutputMap['resolve_ai_synthesis_path']
        | CapabilityOutputMap['create_ai_synthesis_note']
        | CapabilityOutputMap['update_ai_synthesis_compile_state']
      return output.path ? [output.path] : []
    }
    case 'organizer.node.create':
    case 'organizer.node.rename':
    case 'organizer.node.update':
    case 'organizer.node.move': {
      const node = (data as
        | CapabilityOutputMap['organizer.node.create']
        | CapabilityOutputMap['organizer.node.rename']
        | CapabilityOutputMap['organizer.node.update']
        | CapabilityOutputMap['organizer.node.move']).node
      return node?.filePath ? [node.filePath] : []
    }
    case 'task.claim':
    case 'task.update_status':
    case 'run.log':
    case 'handoff.create':
    case 'comment.add': {
      const node = (data as
        | CapabilityOutputMap['task.claim']
        | CapabilityOutputMap['task.update_status']
        | CapabilityOutputMap['run.log']
        | CapabilityOutputMap['handoff.create']
        | CapabilityOutputMap['comment.add']).node
      return node?.filePath ? [node.filePath] : []
    }
    case 'organizer.node.delete': {
      const preview = (data as CapabilityOutputMap['organizer.node.delete']).preview
      return preview?.touchedPaths ?? []
    }
    case 'thoughts.create': {
      const output = data as CapabilityOutputMap['thoughts.create']
      return output.output_path ? [output.output_path] : []
    }
    case 'daily.log_insight': {
      const output = data as CapabilityOutputMap['daily.log_insight']
      return output.output_path ? [output.output_path] : []
    }
    case 'todos.create': {
      const output = data as CapabilityOutputMap['todos.create']
      return output.output_path ? [output.output_path] : []
    }
    case 'todos.toggle': {
      const output = data as CapabilityOutputMap['todos.toggle']
      return output.filePath ? [output.filePath] : []
    }
    case 'tools.excalidraw.format': {
      const output = data as CapabilityOutputMap['tools.excalidraw.format']
      return output.result.output_path ? [output.result.output_path] : []
    }
    case 'tools.pdf.convert': {
      const output = data as CapabilityOutputMap['tools.pdf.convert']
      return output.result.output_path ? [output.result.output_path] : []
    }
    case 'tools.transcript.clean_save': {
      const output = data as CapabilityOutputMap['tools.transcript.clean_save']
      return output.result.output_path ? [output.result.output_path] : []
    }
    default:
      return []
  }
}

function normalizeCreatePayloadForStatusPolicy(
  payload: CapabilityInputMap['organizer.node.create'],
): CapabilityInputMap['organizer.node.create'] {
  const extra = payload.extraFields ? { ...payload.extraFields } : {}
  const recordKind = typeof extra.record_kind === 'string' ? extra.record_kind.trim() : undefined
  const rawTaskStatus = typeof extra.task_status === 'string' ? extra.task_status : undefined
  const normalizedTaskStatus = normalizeTaskStatus(rawTaskStatus)
  const taskType = payload.type === 'task' || recordKind === 'task' || !!normalizedTaskStatus
  const nextType = taskType ? 'task' : payload.type

  const normalizedExtra: Record<string, unknown> = {
    ...extra,
    record_kind: nextType,
  }
  if (nextType === 'task') normalizedExtra.task_status = normalizedTaskStatus ?? 'in_progress'
  else delete normalizedExtra.task_status

  return {
    ...payload,
    type: nextType,
    extraFields: normalizedExtra,
  }
}

function normalizeNodeUpdatesForStatusPolicy(
  existing: NodeRecord,
  updates: CapabilityInputMap['organizer.node.update']['updates'],
): CapabilityInputMap['organizer.node.update']['updates'] {
  const normalized: CapabilityInputMap['organizer.node.update']['updates'] = {
    ...updates,
    extraFields: updates.extraFields ? { ...updates.extraFields } : undefined,
  }

  const extraFields = normalized.extraFields ? { ...normalized.extraFields } : {}
  if (existing.type === 'epic' && normalized.status !== undefined) {
    if (normalized.status === 'completed') {
      const explicitEpicCompletedAt = normalizeEpicCompletedDate(
        typeof extraFields.epic_completed_at === 'string'
          ? extraFields.epic_completed_at
          : undefined,
      )
      if (!explicitEpicCompletedAt && !normalizeEpicCompletedDate(existing.epicCompletedAt)) {
        extraFields.epic_completed_at = currentDateStamp()
      }
    } else {
      extraFields.epic_completed_at = null
    }
  }

  const nextRecordKind = typeof extraFields.record_kind === 'string'
    ? extraFields.record_kind.trim()
    : existing.recordKind
  let nextType = normalized.type ?? existing.type
  const rawTaskStatus = typeof extraFields.task_status === 'string' ? extraFields.task_status : undefined
  const normalizedTaskStatus = normalizeTaskStatus(rawTaskStatus)
  if (nextType === 'task' || nextRecordKind === 'task' || normalizedTaskStatus || isTaskLikeNode(existing)) {
    nextType = 'task'
  }
  normalized.type = nextType

  if (normalizedTaskStatus) {
    extraFields.task_status = normalizedTaskStatus
    normalized.status = nodeStatusFromTaskStatus(normalizedTaskStatus)
  } else if (nextType === 'task' && normalized.status) {
    extraFields.task_status = taskStatusFromNodeStatus(normalized.status)
  } else if (nextType !== 'task') {
    delete extraFields.task_status
  }

  extraFields.record_kind = nextType
  normalized.extraFields = extraFields

  return normalized
}

async function applyEpicStatusPolicyForAffectedNodes(params: {
  changedNodes: NodeRecord[]
  changedParentKeys?: Array<string | null | undefined>
  skipEpicKeys?: string[]
  fs?: VaultFS
}): Promise<void> {
  const allNodes = await listAllYamlNodes()
  if (allNodes.length === 0) return

  const nodesByKey = new Map(allNodes.map(node => [node.key, node]))
  const childrenByParent = new Map<string, NodeRecord[]>()
  for (const node of allNodes) {
    if (!node.parent) continue
    const siblings = childrenByParent.get(node.parent) ?? []
    siblings.push(node)
    childrenByParent.set(node.parent, siblings)
  }

  const candidateEpicKeys = new Set<string>()

  const visitAncestors = (startParentKey: string | null | undefined) => {
    let cursor = startParentKey ?? undefined
    const seen = new Set<string>()
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor)
      const node = nodesByKey.get(cursor)
      if (!node) break
      if (node.type === 'epic') candidateEpicKeys.add(node.key)
      cursor = node.parent
    }
  }

  for (const node of params.changedNodes) {
    if (node.type === 'epic') candidateEpicKeys.add(node.key)
    visitAncestors(node.parent)
  }
  for (const parentKey of params.changedParentKeys ?? []) {
    visitAncestors(parentKey)
  }

  if (candidateEpicKeys.size === 0) return

  const skipEpicKeys = new Set(
    (params.skipEpicKeys ?? [])
      .map(key => key.trim())
      .filter(Boolean),
  )

  for (const epicKey of candidateEpicKeys) {
    if (skipEpicKeys.has(epicKey)) continue
    const epic = nodesByKey.get(epicKey)
    if (!epic || epic.type !== 'epic') continue
    const taskStatuses = collectDescendantTaskStatuses(epic.key, childrenByParent)
    const derivedStatus = deriveEpicStatusFromTaskStatuses(taskStatuses)
    if (!derivedStatus) continue

    const normalizedEpicCompletedAt = normalizeEpicCompletedDate(epic.epicCompletedAt)
    const shouldUpdateStatus = derivedStatus !== epic.status
    const shouldSetCompletionDate = (
      derivedStatus === 'completed' &&
      epic.status !== 'completed' &&
      !normalizedEpicCompletedAt
    )
    if (!shouldUpdateStatus && !shouldSetCompletionDate) continue

    const updated = await updateYamlNode(epic.uuid, {
      status: shouldUpdateStatus ? derivedStatus : undefined,
      extraFields: shouldSetCompletionDate
        ? { epic_completed_at: currentDateStamp() }
        : undefined,
    }, params.fs)
    nodesByKey.set(updated.key, updated)
  }
}

const CAPABILITY_LABELS: Partial<Record<CapabilityName, string>> = {
  'organizer.nodes.search': 'Searching organizer…',
  'organizer.nodes.list_all': 'Loading organizer…',
  'organizer.nodes.list_roots': 'Loading organizer roots…',
  'organizer.nodes.list_children': 'Loading children…',
  'organizer.node.create': 'Creating node…',
  'organizer.node.update': 'Updating node…',
  'organizer.node.move': 'Moving node…',
  'organizer.node.rename': 'Renaming node…',
  'organizer.node.delete': 'Deleting node…',
  'read_note': 'Reading note…',
  'write_note': 'Writing note…',
  'patch_note_frontmatter': 'Updating note…',
  'task.claim': 'Claiming task…',
  'task.update_status': 'Updating task…',
  'handoff.create': 'Creating handoff…',
  'comment.add': 'Adding comment…',
  'run.log': 'Logging run…',
  'thoughts.create': 'Saving thought…',
  'daily.log_insight': 'Saving daily insights…',
  'todos.create': 'Saving todo…',
  'todos.toggle': 'Updating todo…',
}

function formatCapabilityLabel(capability: CapabilityName): string {
  return CAPABILITY_LABELS[capability] ?? `Running ${capability}…`
}

function currentDateStamp(): string {
  return new Date().toISOString().slice(0, 10)
}

function normalizeEpicCompletedDate(value: string | undefined): string | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed
  const parsed = new Date(trimmed)
  if (Number.isNaN(parsed.getTime())) return undefined
  return parsed.toISOString().slice(0, 10)
}

function collectDescendantTaskStatuses(
  rootKey: string,
  childrenByParent: Map<string, NodeRecord[]>,
): Array<string | undefined> {
  const collected: Array<string | undefined> = []
  const seen = new Set<string>()
  const stack = [...(childrenByParent.get(rootKey) ?? [])]

  while (stack.length > 0) {
    const current = stack.pop()!
    if (seen.has(current.key)) continue
    seen.add(current.key)

    if (isTaskLikeNode(current)) {
      collected.push(current.taskStatus ?? 'in_progress')
    }

    const children = childrenByParent.get(current.key)
    if (!children || children.length === 0) continue
    for (const child of children) stack.push(child)
  }

  return collected
}

function assertValidRecordKind(recordKind: unknown): void {
  if (recordKind === undefined || recordKind === null || recordKind === '') return
  if (typeof recordKind !== 'string') {
    throw new Error(`record_kind must be a string, received ${typeof recordKind}`)
  }
  if (!ALLOWED_RECORD_KINDS.includes(recordKind as (typeof ALLOWED_RECORD_KINDS)[number])) {
    throw new Error(`Invalid record_kind: ${recordKind}`)
  }
}

function assertValidNodeType(type: unknown): asserts type is NodeType {
  if (typeof type !== 'string') {
    throw new Error(`type must be a string, received ${typeof type}`)
  }
  const normalized = type.trim() as NodeType
  if (!NODE_TYPES.includes(normalized)) {
    throw new Error(`Invalid type: ${type}`)
  }
}

function assertTaskNode(node: { type?: string; recordKind?: string; taskStatus?: string }): void {
  if (!(node.type === 'task' || node.recordKind === 'task' || !!normalizeTaskStatus(node.taskStatus))) {
    throw new Error('Node is not a task record (type=task or record_kind=task or task_status required).')
  }
}

function assertWritableProjectRootAllowed(
  projectRoot: string | undefined,
  capability: CapabilityName,
): void {
  if (!projectRoot) return
  const policy = getCapabilityPolicy()
  const allowlist = policy.allowedWritableProjectRoots
  if (!allowlist || allowlist.length === 0) return

  const normalized = normalizePath(projectRoot)
  const allowed = allowlist.some(root => normalizePath(root) === normalized)
  if (!allowed) {
    throw new Error(`Writable project root "${projectRoot}" is blocked for ${capability}.`)
  }
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/g, '')
}

function appendStateHistory(
  source: { stateHistory?: Array<Record<string, unknown>>; taskStatus?: string; owner?: string },
  transition: { from?: string; to: string; note?: string },
  by: string,
): Array<Record<string, unknown>> {
  const existing = Array.isArray(source.stateHistory)
    ? source.stateHistory.map(entry => ({ ...entry }))
    : []
  existing.push({
    at: new Date().toISOString(),
    by,
    from: transition.from ?? source.taskStatus ?? '',
    to: transition.to,
    note: transition.note,
  })
  return existing
}

function buildHandoffBody(params: {
  summary?: string
  fromAgent?: string
  toAgent?: string
}): string {
  const lines: string[] = ['## Handoff']
  if (params.summary) {
    lines.push('')
    lines.push(params.summary)
  }
  if (params.fromAgent || params.toAgent) {
    lines.push('')
    lines.push('## Routing')
    lines.push('')
    if (params.fromAgent) lines.push(`- From: ${params.fromAgent}`)
    if (params.toAgent) lines.push(`- To: ${params.toAgent}`)
  }
  return lines.join('\n')
}

async function auditCapability<Name extends CapabilityName>(params: {
  auditId: string
  requestId: string
  request: CapabilityInvokeRequest<Name>
  actor: CapabilityActor
  dryRun: boolean
  warnings: string[]
  ok: boolean
  touchedPaths?: string[]
  errorCode?: string
  errorMessage?: string
  fs?: VaultFS
}): Promise<void> {
  try {
    const fs = params.fs ?? getVaultFS()
    await writeCapabilityAuditEntry({
      auditId: params.auditId,
      timestamp: new Date().toISOString(),
      requestId: params.requestId,
      capability: params.request.capability,
      origin: params.request.extensionContext ? 'extension' : 'core',
      extensionId: params.request.extensionContext?.extensionId,
      extensionRegistryKey: params.request.extensionContext?.extensionRegistryKey,
      actorKind: params.actor.kind,
      actorId: params.actor.id,
      dryRun: params.dryRun,
      ok: params.ok,
      inputHash: createCapabilityInputHash(params.request.input),
      touchedPaths: params.touchedPaths ?? [],
      warnings: params.warnings,
      errorCode: params.errorCode,
      errorMessage: params.errorMessage,
    }, fs)
  } catch {
    // Audit logging must never break the primary capability flow.
  }
}
