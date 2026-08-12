// Resolve a chain (one or more sessions) to readable transcripts.
//
// Resolution is **per session** and each session carries its own status, because
// a chain is routinely part-readable: one session's JSONL is on disk, another's
// was deleted, a third only ever existed as prompts in `history.jsonl`. Folding
// those into a single markdown blob is how a chain that is two-thirds missing
// came to render indistinguishably from a complete one — the failure was a line
// of italics in the middle of a long scroll, which is exactly the silent
// degradation DERIVATION.md forbids. Callers get the per-session list and are
// expected to disclose the gaps; `getChainTranscriptBlock` is the concatenated
// convenience view built on top of the same results.
//
// Nothing is cached — reads happen on demand when the user opens the panel.

import { getVaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import type { ActivityChain, ParsedSession } from '@/services/lego_blocks/units/aiActivityParserBlock'
import { readNativeAiSession } from '@/services/lego_blocks/integrations/nativeAiSessionsBlock'

/**
 * Why a session's transcript does or doesn't render.
 *
 * `reconstructed` is deliberately distinct from `unavailable`: both leave you
 * without assistant turns, but one is a permanent property of the source (the
 * prompt log never held a transcript) and the other is a loss (the file was
 * there and is not now). Collapsing them would hide the only signal that
 * something was deleted.
 */
export type ChainSessionStatusBlock = 'ok' | 'empty' | 'reconstructed' | 'unavailable'

export interface ChainSessionTranscriptBlock {
  session: ParsedSession
  /** 1-based, chronological — the number shown against the session. */
  index: number
  status: ChainSessionStatusBlock
  /** This session's transcript alone. Empty unless `status === 'ok'`. */
  markdown: string
  /** Human-readable reason, for every status except `ok`. */
  note?: string
}

function fmtWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

// Compact per-message stamp: "Jun 11, 4:48 PM". Returns '' for missing/unparseable.
function fmtMsgWhen(iso: unknown): string {
  if (typeof iso !== 'string' || !iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

// Native Claude transcripts are JSONL — one JSON event per line. We render
// user + assistant turns inline (text + thinking blocks); tool_use, system
// events, and other plumbing are summarized as a quiet one-liner so the
// reader sees the conversation arc without drowning in tool traffic.
function flattenContent(content: unknown): { text: string; thinking: string } {
  let text = ''
  let thinking = ''
  if (typeof content === 'string') {
    text = content
  } else if (Array.isArray(content)) {
    for (const part of content) {
      if (!part || typeof part !== 'object') continue
      const p = part as Record<string, unknown>
      if (p.type === 'text' && typeof p.text === 'string') text += (text ? '\n' : '') + p.text
      else if (p.type === 'thinking' && typeof p.thinking === 'string') thinking += (thinking ? '\n' : '') + p.thinking
    }
  }
  return { text: text.trim(), thinking: thinking.trim() }
}

function renderJsonlTranscript(jsonl: string): string {
  const out: string[] = []
  for (const line of jsonl.split('\n')) {
    if (!line.trim()) continue
    let ev: Record<string, unknown>
    try { ev = JSON.parse(line) }
    catch { continue }
    const type = ev.type
    if (type !== 'user' && type !== 'assistant') continue
    const msg = ev.message as Record<string, unknown> | undefined
    const content = msg?.content
    const { text, thinking } = flattenContent(content)
    if (!text && !thinking) continue
    const when = fmtMsgWhen(ev.timestamp)
    const heading = `### ${type === 'user' ? 'User' : 'Assistant'}${when ? ` · ${when}` : ''}`
    out.push('---', '', heading, '')
    if (thinking) {
      out.push('> **[thinking]**')
      for (const ln of thinking.split('\n')) out.push(`> ${ln}`)
      out.push('')
    }
    if (text) out.push(text, '')
  }
  return out.join('\n')
}

// `session.path` formats observed:
//   - "ai-activity/raw-sessions/claude-code/YYYY-MM-DD_<sid8>[_slug].md"  (vault md mirror)
//   - "native/claude/<encoded-cwd>/<sid>.jsonl[#wN]"         (native JSONL)
//   - "native/codex/.../rollout-...jsonl[#wN]"
//   - "history/claude/<sid>[#wN]"                            (prompt-log rebuild)
// Strip the optional `#wN` activity-window suffix the cache appends when one
// transcript splits into multiple ParsedSession rows.
async function loadSessionContent(s: ParsedSession): Promise<string> {
  const cleanPath = s.path.replace(/#w\d+$/, '')
  if (cleanPath.startsWith('native/')) {
    // "native/<source>/<relPath>"
    const rest = cleanPath.slice('native/'.length)
    const slash = rest.indexOf('/')
    if (slash < 0) throw new Error(`Malformed native path: ${s.path}`)
    const source = rest.slice(0, slash) as 'claude' | 'codex'
    const relPath = rest.slice(slash + 1)
    const jsonl = await readNativeAiSession(source, relPath)
    return renderJsonlTranscript(jsonl)
  }
  // Vault md path — read directly. Strip the boilerplate H1 the SessionEnd
  // hook writes so the per-session heading we emit stays the top-level scope.
  const fs = getVaultFS()
  const content = await fs.read(cleanPath)
  return content.replace(/^# Claude Code Session[^\n]*\n+(_Last saved:[^\n]*_\n+)?/m, '')
}

/**
 * A session rebuilt from `~/.claude/history.jsonl` has no transcript to read —
 * the prompt log keeps user prompts and timestamps, never assistant turns. It
 * is checked before any read is attempted, because `history/…` paths resolve to
 * nothing on disk and a read would report this permanent condition as a file
 * error, which reads as data loss when it isn't.
 */
function isReconstructedBlock(s: ParsedSession): boolean {
  return s.reconstructed === true || s.path.startsWith('history/')
}

/**
 * Every session in the chain, chronological, each with its own status.
 *
 * One session failing never fails the chain: a chain is part-readable far more
 * often than it is wholly readable, and the partial view plus an honest account
 * of what is missing beats an error page.
 */
export async function getChainSessionTranscriptsBlock(
  chain: ActivityChain,
): Promise<ChainSessionTranscriptBlock[]> {
  const ordered = [...chain.sessions].sort(
    (a, b) => Date.parse(a.startedIso) - Date.parse(b.startedIso),
  )
  return Promise.all(
    ordered.map(async (session, i): Promise<ChainSessionTranscriptBlock> => {
      const index = i + 1
      if (isReconstructedBlock(session)) {
        return {
          session,
          index,
          status: 'reconstructed',
          markdown: '',
          note:
            'Rebuilt from the prompt log — the original transcript was deleted, so prompt '
            + 'counts and timing survive but the conversation itself does not.',
        }
      }
      try {
        const markdown = (await loadSessionContent(session)).trim()
        if (!markdown) {
          return {
            session,
            index,
            status: 'empty',
            markdown: '',
            note: 'The source file was read but contained no renderable turns.',
          }
        }
        return { session, index, status: 'ok', markdown }
      } catch (err) {
        return {
          session,
          index,
          status: 'unavailable',
          markdown: '',
          note: err instanceof Error ? err.message : String(err),
        }
      }
    }),
  )
}

/** How many sessions are actually readable — the number a header should
 *  disclose alongside the total, so a part-empty chain says so. */
export function countReadableSessionsBlock(parts: ChainSessionTranscriptBlock[]): number {
  return parts.filter(part => part.status === 'ok').length
}

/**
 * The whole chain as one markdown document, for reading straight through or
 * copying out. Built on the per-session results so the two views can never
 * disagree about what loaded.
 */
export async function getChainTranscriptBlock(chain: ActivityChain): Promise<string> {
  const parts = await getChainSessionTranscriptsBlock(chain)
  const readable = countReadableSessionsBlock(parts)
  const out: string[] = [
    `# ${chain.project} · ${parts.length} session${parts.length === 1 ? '' : 's'}`,
    '',
    `_${fmtWhen(chain.startedIso)} → ${fmtWhen(chain.endedIso ?? chain.startedIso)} · ${chain.msgCount} msgs_`,
    '',
  ]
  if (readable < parts.length) {
    out.push(`> **${parts.length - readable} of ${parts.length} sessions could not be read.**`, '')
  }
  for (const part of parts) {
    const s = part.session
    out.push('---', '', `## Session ${part.index} — ${s.topic || '(no topic)'}`, '')
    out.push(`_${fmtWhen(s.startedIso)}${s.model ? ` · ${s.model}` : ''}_`, '')
    if (part.status === 'ok') out.push(part.markdown)
    else out.push(`> **${part.status}** — ${part.note ?? ''}`, '>', `> \`${s.path}\``)
    out.push('')
  }
  return out.join('\n')
}
