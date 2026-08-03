import { listChainsBlock } from '@/services/lego_blocks/integrations/aiActivityChainIndexBlock'
import {
  listSectionsBlock,
  listUndertakingsBlock,
} from '@/services/lego_blocks/integrations/aiActivityUndertakingStoreBlock'
import { extractJsonObjectBlock } from '@/services/lego_blocks/units/jsonReplyBlock'
import { sendChatWithTelemetryOrch, type AiProvider } from './chatOrch'
import { resolveAiSelectionOrch, resolveAiThinkingForScopeProviderOrch } from './aiSettingsOrch'

/**
 * Drafting the answer to "what is this work?" for a hand-picked set of chains.
 *
 * This is a *proposal*, never a commit. ASSIGNMENT.md is explicit that AI
 * proposes and a human mints; so this orch writes nothing, files nothing, and
 * returns a draft the pane drops into fields the human can edit or throw away.
 *
 * Both answers are first-class. "These chains belong to an undertaking you
 * already have" is at least as common as "this is something new" — a model that
 * can only mint would quietly shatter one piece of work into six records, which
 * is exactly the granularity failure the contract calibrates against.
 */
export interface AssignmentDraft {
  /** `existing` means file into `existingKey`; `new` means mint from title/head. */
  kind: 'existing' | 'new'
  /** Set when `kind === 'existing'` — an undertaking key that was in the list
   *  we handed the model. A key it invented is downgraded to a `new` draft. */
  existingKey?: string
  existingTitle?: string
  /** Always populated, even for an `existing` draft: the human may reject the
   *  match and mint instead, and re-asking for a title would be a second call. */
  title: string
  head: string
  sectionKey?: string
  /** One line on why, shown next to the draft. The human is checking a
   *  judgement, not accepting an oracle. */
  rationale: string
  usedAi: boolean
  provider?: AiProvider
  model?: string
}

/** Enough of a chain for the model to tell work apart, and no more — the whole
 *  transcript would blow the context for a question the digest already answers. */
interface ChainBrief {
  chainId: string
  title: string
  summary: string
  date: string
}

function titleFromBriefsBlock(briefs: ChainBrief[]): string {
  const first = briefs[0]?.title?.trim()
  return first || 'Untitled work'
}

function headFromBriefsBlock(briefs: ChainBrief[]): string {
  const joined = briefs
    .map(brief => brief.summary.trim() || brief.title.trim())
    .filter(Boolean)
    .join(' ')
  return joined.slice(0, 600)
}

/** No provider configured is a normal state, not an error: the pane still opens
 *  with the fields pre-filled from the chains themselves. */
function heuristicDraftBlock(briefs: ChainBrief[]): AssignmentDraft {
  return {
    kind: 'new',
    title: titleFromBriefsBlock(briefs),
    head: headFromBriefsBlock(briefs),
    rationale: 'Drafted from the chain digests — no AI provider is configured for AI activity.',
    usedAi: false,
  }
}

export async function draftUndertakingForChainsOrch(params: {
  projectId: string
  chainIds: string[]
}): Promise<AssignmentDraft> {
  const wanted = new Set(params.chainIds)
  const stored = await listChainsBlock({ projectId: params.projectId })
  const briefs: ChainBrief[] = stored
    .filter(chain => wanted.has(chain.chainId))
    .map(chain => ({
      chainId: chain.chainId,
      title: chain.title || chain.chainKey,
      summary: chain.summary || '',
      date: chain.date,
    }))
    .sort((a, b) => a.date.localeCompare(b.date))

  const fallback = heuristicDraftBlock(briefs)
  if (briefs.length === 0) return fallback

  const [undertakings, sections] = await Promise.all([
    listUndertakingsBlock(params.projectId),
    listSectionsBlock(params.projectId),
  ])
  const candidates = undertakings.map(record => ({
    key: record.key,
    title: record.title || record.head || record.key,
    head: record.head || '',
  }))

  const selection = await resolveAiSelectionOrch({ scope: 'ai_activity' })
  if (!selection) return fallback

  const prompt = [
    'You are triaging AI coding sessions into "undertakings" — named pieces of',
    'work that a person would recognise as one thing they were doing.',
    '',
    'Return STRICT JSON only, with keys:',
    'existing_key, title, head, section_key, rationale',
    '',
    'Rules:',
    '- existing_key: if these sessions are more of an undertaking that already',
    '  exists, return its key exactly as listed. Otherwise return "".',
    '- Prefer an existing undertaking when the work is a continuation. Minting a',
    '  new one for every burst of sessions is the most common mistake.',
    '- title: a short human name for the work (<= 60 chars). Always fill this in,',
    '  even when you chose an existing undertaking.',
    '- head: 1-3 sentences on what this work is and why it happened.',
    '- section_key: choose from the section list, or "".',
    '- rationale: one sentence on why, addressed to the person deciding.',
    '',
    `Sessions (${briefs.length}):`,
    ...briefs.map(brief => `- ${brief.date} | ${brief.title} | ${brief.summary}`),
    '',
    'Existing undertakings (key | title | head):',
    ...(candidates.length > 0
      ? candidates.map(item => `- ${item.key} | ${item.title} | ${item.head}`)
      : ['- (none yet)']),
    '',
    'Sections (key | title):',
    ...(sections.length > 0
      ? sections.map(item => `- ${item.key} | ${item.title}`)
      : ['- (none)']),
  ].join('\n')

  try {
    const { response } = await sendChatWithTelemetryOrch(
      selection.provider,
      [{ role: 'user', content: prompt }],
      {
        model: selection.model,
        opensourceAi: selection.provider === 'opensource-ai'
          ? { think: resolveAiThinkingForScopeProviderOrch('ai_activity', 'opensource-ai') }
          : undefined,
      },
      {
        useCase: 'assignment.undertaking.draft',
        metadata: {
          projectId: params.projectId,
          chains: briefs.length,
          candidates: candidates.length,
          configuredProvider: selection.provider,
          configuredModel: selection.model,
        },
      },
    )

    const parsed = extractJsonObjectBlock(response.content)
    if (!parsed) return { ...fallback, provider: response.provider, model: response.model }

    const readString = (key: string): string =>
      typeof parsed[key] === 'string' ? (parsed[key] as string).trim() : ''

    const title = readString('title') || fallback.title
    const head = readString('head') || fallback.head
    const rationale = readString('rationale') || 'Drafted from the selected sessions.'

    // A key the model invented is worse than no match: filing into it would
    // create a record nobody named. Downgrade to a mint and let the human look.
    const proposedKey = readString('existing_key')
    const match = proposedKey
      ? candidates.find(item => item.key.toLowerCase() === proposedKey.toLowerCase())
      : undefined

    const proposedSection = readString('section_key')
    const section = sections.find(item => item.key === proposedSection)

    return {
      kind: match ? 'existing' : 'new',
      existingKey: match?.key,
      existingTitle: match?.title,
      title,
      head,
      sectionKey: section?.key,
      rationale,
      usedAi: true,
      provider: response.provider,
      model: response.model,
    }
  } catch {
    return fallback
  }
}
