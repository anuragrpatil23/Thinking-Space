// Intelligence contract for AI-activity session titles. Preserves the two
// hard-won ideas from the previous implementation:
//   1. Feed the model the first 1-2 user turns plus every assistant "recap"
//      (summary-shaped turn), never the full transcript — recaps are what
//      capture the actual work done.
//   2. Reject titles that just echo the project name or verbatim user prose.
//
// Everything else — prompt shape, model quirks, cache, telemetry — is now
// the orchestrator/provider's problem, not this file's.

import type { ActivityChain } from '@/services/lego_blocks/units/aiActivityParserBlock'
import { readNativeAiSession } from '@/services/lego_blocks/integrations/nativeAiSessionsBlock'
import { defineContractBlock, type ContractOutput } from '../promptContractBlock'
import { s } from '../schemaBlock'

const MAX_USER_TURNS = 2
const MAX_PROMPT_CHARS = 5000
const MAX_PER_TURN_CHARS = 1200
const MAX_TITLE_CHARS = 240

const SUMMARY_PHRASE_RE = /\b(fix summary|what landed|what changed|summary:|all done|done\s*[\-—]|here'?s what|changes:|the result is|to recap)\b/i
const HEADING_RE = /^\s*#{2,4}\s+\S/m
const ACTION_BULLET_RE = /^[\s>]*[-*]\s+(?:I\s+|We\s+)?(added|fixed|updated|refactored|moved|removed|wired|renamed|introduced|extracted|deleted|created|switched|migrated|tightened|loosened|reworked|simplified|inlined|replaced|gated|exposed|persisted|cached|invalidated|landed)\b/mi

const LEAK_PREFIX_RE =
  /^(?:first user message|user (?:message|input|prompt|\d+)|recap \d+|the user(?:'s)?(?: message| input| prompt| ask)?|note|topic|title|label|summary|description|output|project|input|response|here(?:'s| is)|looking at|based on)\s*[:\-—–]\s*/i
const USER_QUOTE_LEAD_RE = /^(?:hey|hi|hello|can you|could you|please|i want|i need|let'?s)\b/i

interface ExtractedTurn {
  role: 'user' | 'assistant'
  text: string
  order: number
}

interface ChainContext {
  userIntro: ExtractedTurn[]
  summaryTurns: ExtractedTurn[]
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

async function extractChainContext(chain: ActivityChain): Promise<ChainContext> {
  const userIntro: ExtractedTurn[] = []
  const summaryTurns: ExtractedTurn[] = []
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
  const kept: ExtractedTurn[] = []
  for (let i = summaryTurns.length - 1; i >= 0; i -= 1) {
    const t = summaryTurns[i]
    if (t.text.length > budget) break
    kept.push(t)
    budget -= t.text.length
  }
  kept.reverse()
  return { userIntro, summaryTurns: kept }
}

function stripWrappers(s: string): string {
  return s
    .replace(/^["'`*\-\s>]+/, '')
    .replace(/["'`*\s]+$/, '')
    .trim()
}

function sanitizeTitle(raw: string, projectName: string): string | null {
  const lines = raw.split('\n').map(stripWrappers).filter(Boolean)
  let pick: string | null = null
  for (const rawLine of lines) {
    let line = rawLine
    for (let i = 0; i < 2; i += 1) {
      const next = line.replace(LEAK_PREFIX_RE, '').trim()
      if (next === line) break
      line = next
    }
    line = stripWrappers(line)
    if (!line) continue
    if (USER_QUOTE_LEAD_RE.test(line)) continue
    if (line.split(/\s+/).length < 3) continue
    pick = line
    break
  }
  if (!pick) return null
  pick = pick.replace(/^(topic( label)?|title|label|summary|description|project)\s*[:\-—]\s*/i, '').trim()
  pick = pick.replace(/[.!?;]+$/, '').trim()
  if (!pick) return null
  const normalize = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, '')
  if (projectName && normalize(pick) === normalize(projectName)) return null
  if (pick.length > MAX_TITLE_CHARS) {
    const cut = pick.slice(0, MAX_TITLE_CHARS)
    const lastSpace = cut.lastIndexOf(' ')
    pick = (lastSpace > MAX_TITLE_CHARS * 0.6 ? cut.slice(0, lastSpace) : cut).trim() + '…'
  }
  return pick
}

const SYSTEM_PROMPT = [
  'You write a single-line description of what a session was about.',
  'Sessions cover anything: coding, business research, studying, writing,',
  'math, life planning. Stay neutral on domain — describe the actual subject.',
  '',
  'INPUT FORMAT:',
  '  <<<USER>>>      one or two user messages (the original ask)',
  '  <<<RECAP>>>     zero or more assistant recaps (what was done or covered)',
  '',
  'OUTPUT FORMAT (strict):',
  '  - Plain text. ONE line. No line breaks. No bullet list. No paragraphs.',
  '  - NO preamble. NO "First user message:", "User 1:", "User input:",',
  '    "User message:", "Note:", "Topic:", "Title:", "Summary:" prefix.',
  '  - NO quoting of the input. Do not begin with the user\'s words verbatim.',
  '  - NO meta-commentary like "(Note: ...)" or "Looking at the recaps...".',
  '  - Just the description, nothing else.',
  '',
  'CONTENT GUIDELINES:',
  '  - Concrete and specific: name the feature, company, concept, file, or',
  '    decision actually being discussed. Avoid generic words like "prompt",',
  '    "request", "skill" when a real noun is available.',
  '  - Use past-tense action verbs when RECAPs are present ("Fixed…",',
  '    "Walked through…", "Researched…"). Use present-progressive when only',
  '    USER is present ("Studying…", "Debugging…", "Planning…").',
  '  - If multiple sub-tasks happened, lead with the dominant one and mention',
  '    a second briefly ("Studied TSMC capacity; also covered foundry pricing").',
  '  - Never just the project or app name.',
].join('\n')

async function buildUserPromptBlock(chain: ActivityChain): Promise<string> {
  const ctx = await extractChainContext(chain)
  if (ctx.userIntro.length === 0 && chain.topic) {
    ctx.userIntro.push({ role: 'user', text: chain.topic, order: 0 })
  }
  const sections: string[] = ['<<<USER>>>']
  sections.push(ctx.userIntro.length ? ctx.userIntro.map(t => t.text).join('\n---\n') : '(none)')
  sections.push('', '<<<RECAP>>>')
  sections.push(ctx.summaryTurns.length ? ctx.summaryTurns.map(t => t.text).join('\n---\n') : '(none — infer from the user messages alone)')
  sections.push('', '<<<OUTPUT>>>')
  return sections.join('\n')
}

// Contracts are declarative, but this one has an async build step (reads
// session JSONL from disk to find recaps). The orchestrator's build hook is
// synchronous, so we pre-flight the extraction here and stash the built
// prompt on the input. Consumers call `prepareSessionTitleInput` before
// `runContract` — cheap on cache hit since we short-circuit disk reads by
// caching the extracted prompt in a WeakMap keyed by the chain object.

const PREPARED = new WeakMap<ActivityChain, string>()

export async function prepareSessionTitleInput(chain: ActivityChain): Promise<void> {
  if (PREPARED.has(chain)) return
  const prompt = await buildUserPromptBlock(chain)
  PREPARED.set(chain, prompt)
}

export interface SessionTitleOutput {
  title: string
}

export const sessionTitleContract = defineContractBlock({
  id: 'session-title',
  promptVersion: 8,
  outputSchema: s.string({ description: 'One-line title', minLength: 3, maxLength: MAX_TITLE_CHARS }),
  buildRequest: (chain: ActivityChain, ctx) => {
    const userPrompt = PREPARED.get(chain)
    if (!userPrompt) {
      // Prepared prompt missing — fall back to the raw topic so we still
      // produce something. Caller was supposed to await prepareSessionTitleInput.
      const fallback = ['<<<USER>>>', chain.topic || '(none)', '', '<<<RECAP>>>', '(none)', '', '<<<OUTPUT>>>'].join('\n')
      return {
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user' as const, content: fallback }],
        maxTokens: ctx.recommendedMaxTokens,
        temperature: 0.2,
      }
    }
    return {
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user' as const, content: userPrompt }],
      maxTokens: ctx.recommendedMaxTokens,
      temperature: 0.2,
    }
  },
  finalize: (raw: string, chain: ActivityChain): ContractOutput<SessionTitleOutput> | null => {
    const cleaned = sanitizeTitle(raw, chain.project)
    if (!cleaned) return null
    return { value: { title: cleaned }, meta: {} }
  },
  // Cache key: first session id + message count. Regenerate when the session
  // grows; ignore mtime and other volatile chain fields.
  cacheKey: (chain: ActivityChain) => {
    const first = chain.sessions[0]?.sessionId ?? chain.key
    return `${first}#${chain.msgCount}`
  },
})
