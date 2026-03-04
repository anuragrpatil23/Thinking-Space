import { getActiveSpaceIdBlock, getStoredVaultRoot } from '@/services/orchestrators/storageOrch'
import { getVaultFS } from '@/services/orchestrators/runtimeOrch'
import {
  AI_ASSIST_PROMPT_HISTORY_DIR_PATH_BLOCK,
  AI_ASSIST_PROMPT_HISTORY_FILE_PATH_BLOCK,
  normalizeAiAssistPromptHistoryBlock,
  upsertAiAssistPromptHistoryEntryBlock,
  type AiAssistPromptHistoryEntryBlock,
} from '@/services/lego_blocks/integrations/aiAssistPromptHistoryBlock'

export type { AiAssistPromptHistoryEntryBlock }

let cachedPromptHistoryOrch: AiAssistPromptHistoryEntryBlock[] | null = null
let cachedPromptHistorySpaceIdOrch: string | null = null
let promptHistoryWriteQueueOrch: Promise<AiAssistPromptHistoryEntryBlock[]> = Promise.resolve([])

function normalizeVaultRootBlock(value: string | null | undefined): string {
  if (typeof value !== 'string') return ''
  return value.trim()
}

function hasActiveVaultRootBlock(): boolean {
  return normalizeVaultRootBlock(getStoredVaultRoot()).length > 0
}

async function readPromptHistoryFromVaultBlock(): Promise<AiAssistPromptHistoryEntryBlock[]> {
  if (!hasActiveVaultRootBlock()) return []
  const fs = getVaultFS()
  if (!(await fs.exists(AI_ASSIST_PROMPT_HISTORY_FILE_PATH_BLOCK))) {
    return []
  }
  const raw = await fs.read(AI_ASSIST_PROMPT_HISTORY_FILE_PATH_BLOCK)
  if (!raw.trim()) return []
  try {
    const parsed = JSON.parse(raw)
    return normalizeAiAssistPromptHistoryBlock(parsed)
  } catch (error) {
    console.warn('[aiAssistPromptHistoryOrch] Failed to parse prompt history:', error)
    return []
  }
}

async function writePromptHistoryToVaultBlock(entries: AiAssistPromptHistoryEntryBlock[]): Promise<void> {
  if (!hasActiveVaultRootBlock()) return
  const fs = getVaultFS()
  if (!(await fs.exists(AI_ASSIST_PROMPT_HISTORY_DIR_PATH_BLOCK))) {
    await fs.mkdir(AI_ASSIST_PROMPT_HISTORY_DIR_PATH_BLOCK)
  }
  await fs.write(
    AI_ASSIST_PROMPT_HISTORY_FILE_PATH_BLOCK,
    `${JSON.stringify(entries, null, 2)}\n`,
  )
}

async function getPromptHistoryForWriteBlock(): Promise<AiAssistPromptHistoryEntryBlock[]> {
  const normalizedRoot = normalizeVaultRootBlock(getStoredVaultRoot())
  const spaceId = getActiveSpaceIdBlock()
  if (!normalizedRoot) {
    cachedPromptHistoryOrch = []
    cachedPromptHistorySpaceIdOrch = null
    return []
  }

  if (cachedPromptHistoryOrch && cachedPromptHistorySpaceIdOrch === spaceId) {
    return cachedPromptHistoryOrch
  }

  const fromVault = await readPromptHistoryFromVaultBlock()
  cachedPromptHistoryOrch = fromVault
  cachedPromptHistorySpaceIdOrch = spaceId
  return fromVault
}

export async function listAiAssistPromptHistoryOrch(limit = 20): Promise<AiAssistPromptHistoryEntryBlock[]> {
  const normalizedRoot = normalizeVaultRootBlock(getStoredVaultRoot())
  const spaceId = getActiveSpaceIdBlock()
  if (!normalizedRoot) {
    cachedPromptHistoryOrch = []
    cachedPromptHistorySpaceIdOrch = null
    return []
  }

  if (!cachedPromptHistoryOrch || cachedPromptHistorySpaceIdOrch !== spaceId) {
    try {
      cachedPromptHistoryOrch = await readPromptHistoryFromVaultBlock()
      cachedPromptHistorySpaceIdOrch = spaceId
    } catch (error) {
      console.warn('[aiAssistPromptHistoryOrch] Failed to read prompt history:', error)
      cachedPromptHistoryOrch = []
      cachedPromptHistorySpaceIdOrch = spaceId
    }
  }

  const normalizedLimit = Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 20
  if (normalizedLimit <= 0) return []
  return cachedPromptHistoryOrch.slice(0, normalizedLimit)
}

export async function recordAiAssistPromptHistoryOrch(prompt: string): Promise<AiAssistPromptHistoryEntryBlock[]> {
  promptHistoryWriteQueueOrch = promptHistoryWriteQueueOrch.catch(() => []).then(async () => {
    let current: AiAssistPromptHistoryEntryBlock[] = []
    try {
      current = await getPromptHistoryForWriteBlock()
    } catch (error) {
      console.warn('[aiAssistPromptHistoryOrch] Failed to load prompt history for write:', error)
      current = []
    }
    if (!hasActiveVaultRootBlock()) return current

    const next = upsertAiAssistPromptHistoryEntryBlock(current, prompt)
    if (next === current) return current

    try {
      await writePromptHistoryToVaultBlock(next)
      cachedPromptHistoryOrch = next
      cachedPromptHistorySpaceIdOrch = getActiveSpaceIdBlock()
    } catch (error) {
      console.warn('[aiAssistPromptHistoryOrch] Failed to persist prompt history:', error)
      return current
    }
    return next
  })

  return promptHistoryWriteQueueOrch
}
