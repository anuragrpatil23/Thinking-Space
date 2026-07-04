import type { ActivityChain } from '@/services/lego_blocks/units/aiActivityParserBlock'
import { readNativeAiSession } from '@/services/lego_blocks/integrations/nativeAiSessionsBlock'

// Shared chain-context extraction. Both the (legacy) session-title contract
// and the (new) chain-digest contract feed the model:
//   - the first 1-2 substantive user turns (the original ask)
//   - every assistant "recap" (summary-shaped turn)
// …never the full transcript. Recaps are what capture the actual work done;
// full transcripts blow the context budget with tool churn.

const MAX_USER_TURNS = 2
const MAX_PROMPT_CHARS = 5000
const MAX_PER_TURN_CHARS = 1200

const SUMMARY_PHRASE_RE = /\b(fix summary|what landed|what changed|summary:|all done|done\s*[\-—]|here'?s what|changes:|the result is|to recap)\b/i
const HEADING_RE = /^\s*#{2,4}\s+\S/m
const ACTION_BULLET_RE = /^[\s>]*[-*]\s+(?:I\s+|We\s+)?(added|fixed|updated|refactored|moved|removed|wired|renamed|introduced|extracted|deleted|created|switched|migrated|tightened|loosened|reworked|simplified|inlined|replaced|gated|exposed|persisted|cached|invalidated|landed)\b/mi

export interface ExtractedTurnBlock {
  role: 'user' | 'assistant'
  text: string
  order: number
}

export interface ChainContextBlock {
  userIntro: ExtractedTurnBlock[]
  summaryTurns: ExtractedTurnBlock[]
}

function flattenContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const part of content) {
    if (!part || typeof part !== 'object') continue
    const p = part as Record<string, unknown>
    if (p.type === 'text' && typeof p.text === 'string') parts.push(p.text)
  }
  return parts.join('\n')
}

function isLabelOnly(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return true
  if (/^<command-name>/i.test(trimmed)) return true
  if (/^\//.test(trimmed) && trimmed.length < 40) return true
  return false
}

function clip(text: string): string {
  return text.length > MAX_PER_TURN_CHARS ? `${text.slice(0, MAX_PER_TURN_CHARS)}…` : text
}

function looksLikeSummary(text: string): boolean {
  if (text.length < 60) return false
  if (SUMMARY_PHRASE_RE.test(text)) return true
  if (HEADING_RE.test(text)) return true
  const matches = text.match(new RegExp(ACTION_BULLET_RE.source, 'gmi'))
  if (matches && matches.length >= 2) return true
  return false
}

/**
 * Walk a chain's native-jsonl sessions and pull out the intro user turns +
 * the assistant recap turns that carry summary shape. Vault-md-only chains
 * yield empty; callers fall back to `chain.topic`.
 */
export async function extractChainContextBlock(chain: ActivityChain): Promise<ChainContextBlock> {
  const userIntro: ExtractedTurnBlock[] = []
  const summaryTurns: ExtractedTurnBlock[] = []
  const ordered = [...chain.sessions]
    .sort((a, b) => Date.parse(a.startedIso) - Date.parse(b.startedIso))
    .slice(0, 5)
  let order = 0
  for (const s of ordered) {
    const cleanPath = s.path.replace(/#w\d+$/, '')
    if (!cleanPath.startsWith('native/')) continue
    const rest = cleanPath.slice('native/'.length)
    const slash = rest.indexOf('/')
    if (slash < 0) continue
    const source = rest.slice(0, slash) as 'claude' | 'codex'
    const relPath = rest.slice(slash + 1)
    let jsonl: string
    try {
      jsonl = await readNativeAiSession(source, relPath)
    } catch {
      continue
    }
    for (const line of jsonl.split('\n')) {
      if (!line.trim()) continue
      let ev: Record<string, unknown>
      try { ev = JSON.parse(line) } catch { continue }
      if (ev.type !== 'user' && ev.type !== 'assistant') continue
      const msg = ev.message as Record<string, unknown> | undefined
      const text = flattenContent(msg?.content).trim()
      if (!text) continue
      order += 1
      if (ev.type === 'user') {
        if (isLabelOnly(text)) continue
        if (userIntro.length < MAX_USER_TURNS) {
          userIntro.push({ role: 'user', text: clip(text), order })
        }
      } else if (looksLikeSummary(text)) {
        summaryTurns.push({ role: 'assistant', text: clip(text), order })
      }
    }
  }
  const introChars = userIntro.reduce((n, t) => n + t.text.length, 0)
  let budget = Math.max(0, MAX_PROMPT_CHARS - introChars)
  const kept: ExtractedTurnBlock[] = []
  for (let i = summaryTurns.length - 1; i >= 0; i -= 1) {
    const t = summaryTurns[i]
    if (t.text.length > budget) break
    kept.push(t)
    budget -= t.text.length
  }
  kept.reverse()
  return { userIntro, summaryTurns: kept }
}

// Regex + helpers used by both contracts for output cleanup.

export const CHAIN_DIGEST_LEAK_PREFIX_RE =
  /^(?:first user message|user (?:message|input|prompt|\d+)|recap \d+|the user(?:'s)?(?: message| input| prompt| ask)?|note|topic|title|label|summary|description|output|project|input|response|here(?:'s| is)|looking at|based on)\s*[:\-—–]\s*/i

export const CHAIN_DIGEST_USER_QUOTE_LEAD_RE = /^(?:hey|hi|hello|can you|could you|please|i want|i need|let'?s)\b/i

export function stripWrappersBlock(text: string): string {
  return text
    .replace(/^["'`*\-\s>]+/, '')
    .replace(/["'`*\s]+$/, '')
    .trim()
}
