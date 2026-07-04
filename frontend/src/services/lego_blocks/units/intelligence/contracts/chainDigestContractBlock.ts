import type { ActivityChain } from '@/services/lego_blocks/units/aiActivityParserBlock'
import { defineContractBlock, type ContractOutput } from '../promptContractBlock'
import { s } from '../schemaBlock'
import {
  CHAIN_DIGEST_LEAK_PREFIX_RE,
  CHAIN_DIGEST_USER_QUOTE_LEAD_RE,
  extractChainContextBlock,
  stripWrappersBlock,
} from './chainContextExtractionBlock'

// Contract that produces both a one-line TITLE and a 1-3 sentence SUMMARY
// for one activity chain. Replaces the earlier `session-title` contract —
// callers now get durable per-chain content instead of just a label.
//
// Output format is delimited plain text, not JSON. Small local models
// (Qwen, Gemma, Llama-3-8B) reliably follow a "TITLE:" + blank line +
// summary layout but stumble on strict JSON — string schema keeps this
// contract portable across the openai-compat provider matrix.

const MAX_TITLE_CHARS = 240
const MAX_SUMMARY_CHARS = 800

const TITLE_LINE_RE = /^\s*(?:title\s*[:\-—]\s*)?(.+)$/i

function sanitizeTitle(raw: string, projectName: string): string | null {
  const lines = raw.split('\n').map(stripWrappersBlock).filter(Boolean)
  let pick: string | null = null
  for (const rawLine of lines) {
    let line = rawLine
    for (let i = 0; i < 2; i += 1) {
      const next = line.replace(CHAIN_DIGEST_LEAK_PREFIX_RE, '').trim()
      if (next === line) break
      line = next
    }
    line = stripWrappersBlock(line)
    if (!line) continue
    if (CHAIN_DIGEST_USER_QUOTE_LEAD_RE.test(line)) continue
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

function sanitizeSummary(raw: string): string {
  const cleaned = raw
    .split('\n')
    .map(l => l.replace(/^(summary|body|notes)\s*[:\-—]\s*/i, '').trim())
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return ''
  if (cleaned.length <= MAX_SUMMARY_CHARS) return cleaned
  const cut = cleaned.slice(0, MAX_SUMMARY_CHARS)
  const lastPunct = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('? '), cut.lastIndexOf('! '))
  return (lastPunct > MAX_SUMMARY_CHARS * 0.6 ? cut.slice(0, lastPunct + 1) : cut).trim() + '…'
}

const SYSTEM_PROMPT = [
  'You describe what an AI-assisted session was about, in two parts.',
  'Sessions cover anything: coding, business research, studying, writing,',
  'math, life planning. Stay neutral on domain — describe the actual subject.',
  '',
  'INPUT FORMAT:',
  '  <<<USER>>>      one or two user messages (the original ask)',
  '  <<<RECAP>>>     zero or more assistant recaps (what was done or covered)',
  '',
  'OUTPUT FORMAT (strict):',
  '  Line 1 must be: TITLE: <one line, no line breaks>',
  '  Line 2 must be blank.',
  '  Lines 3+ are the summary body: 1-3 sentences in plain prose.',
  '',
  '  Example:',
  '  TITLE: Refactored auth middleware to remove session token storage',
  '',
  '  Extracted the token-storage code path out of the middleware into a',
  '  dedicated service, then updated the two callers. Legal-driven change;',
  '  session cookies now carry only a signed reference, not the token.',
  '',
  '  - NO preamble ("Here is the output", "Looking at the input"). NO trailing',
  '    meta-notes. NO quoting the user verbatim. NO markdown headings, bullets,',
  '    or code fences.',
  '',
  'TITLE GUIDELINES:',
  '  - Concrete and specific: name the feature, company, concept, file, or',
  '    decision. Avoid generic words like "prompt", "request", "skill" when a',
  '    real noun is available.',
  '  - Use past-tense action verbs when RECAPs are present ("Fixed…",',
  '    "Walked through…", "Researched…"). Use present-progressive when only',
  '    USER is present ("Studying…", "Debugging…", "Planning…").',
  '  - If multiple sub-tasks happened, lead with the dominant one and mention',
  '    a second briefly.',
  '  - Never just the project or app name.',
  '',
  'SUMMARY GUIDELINES:',
  '  - 1-3 sentences. Concrete: what was done, what decisions were made,',
  '    what open questions remain (if any).',
  '  - Prefer the recap voice ("landed the change to X, deferred Y") over',
  '    describing the conversation ("the user asked about X and the assistant',
  '    explained…"). Never refer to "the user" or "the assistant".',
  '  - If nothing substantive happened (session ended in a slash-command,',
  '    empty scratch), write a single short sentence noting it and stop.',
].join('\n')

async function buildUserPromptBlock(chain: ActivityChain): Promise<string> {
  const ctx = await extractChainContextBlock(chain)
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

// The extraction step reads native JSONL from disk to find recaps. The
// orchestrator's buildRequest hook is sync, so we pre-flight the extraction
// here and stash the result on the input via WeakMap.
const PREPARED = new WeakMap<ActivityChain, string>()

export async function prepareChainDigestInputBlock(chain: ActivityChain): Promise<void> {
  if (PREPARED.has(chain)) return
  const prompt = await buildUserPromptBlock(chain)
  PREPARED.set(chain, prompt)
}

export interface ChainDigestOutput {
  title: string
  summary: string
}

function splitTitleAndSummary(raw: string): { title: string; summary: string } {
  const lines = raw.split('\n')
  let titleIdx = -1
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim()
    if (!line) continue
    if (/^title\s*[:\-—]/i.test(line)) {
      titleIdx = i
      break
    }
    // Model dropped the TITLE: prefix — treat the first substantive line as
    // the title anyway, keep the rest as summary.
    titleIdx = i
    break
  }
  if (titleIdx < 0) return { title: '', summary: '' }
  const titleRaw = lines[titleIdx].replace(/^title\s*[:\-—]\s*/i, '').trim()
  const titleMatch = TITLE_LINE_RE.exec(titleRaw)
  const title = titleMatch ? titleMatch[1].trim() : titleRaw
  const summary = lines.slice(titleIdx + 1).join('\n').trim()
  return { title, summary }
}

export const chainDigestContract = defineContractBlock({
  id: 'chain-digest',
  promptVersion: 1,
  outputSchema: s.string({ description: 'TITLE line + blank line + summary body' }),
  buildRequest: (chain: ActivityChain, ctx) => {
    const userPrompt = PREPARED.get(chain)
    const prompt = userPrompt ?? [
      '<<<USER>>>',
      chain.topic || '(none)',
      '',
      '<<<RECAP>>>',
      '(none)',
      '',
      '<<<OUTPUT>>>',
    ].join('\n')
    return {
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user' as const, content: prompt }],
      maxTokens: Math.max(ctx.recommendedMaxTokens, 320),
      temperature: 0.2,
    }
  },
  finalize: (raw: string, chain: ActivityChain): ContractOutput<ChainDigestOutput> | null => {
    const { title: rawTitle, summary: rawSummary } = splitTitleAndSummary(raw)
    const title = sanitizeTitle(rawTitle, chain.project)
    if (!title) return null
    const summary = sanitizeSummary(rawSummary)
    return { value: { title, summary }, meta: {} }
  },
  cacheKey: (chain: ActivityChain) => {
    const first = chain.sessions[0]?.sessionId ?? chain.key
    return `${first}#${chain.msgCount}`
  },
})
