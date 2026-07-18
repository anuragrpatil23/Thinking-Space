// Resolve a chain (one or more sessions) to a single readable markdown
// transcript by concatenating each session's already-rendered vault md.
// Nothing is cached — the read happens on demand when the user opens the
// transcript modal. Sessions whose md isn't on disk get a placeholder block
// so a partial chain still renders something useful.

import { getVaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import type { ActivityChain, ParsedSession } from '@/services/lego_blocks/units/aiActivityParserBlock'
import { readNativeAiSession } from '@/services/lego_blocks/integrations/nativeAiSessionsBlock'

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
    const rendered = renderJsonlTranscript(jsonl)
    return rendered || '_Transcript appears empty._'
  }
  // Vault md path — read directly. Strip the boilerplate H1 the SessionEnd
  // hook writes so the per-session heading we emit stays the top-level scope.
  const fs = getVaultFS()
  const content = await fs.read(cleanPath)
  return content.replace(/^# Claude Code Session[^\n]*\n+(_Last saved:[^\n]*_\n+)?/m, '')
}

export async function getChainTranscriptBlock(chain: ActivityChain): Promise<string> {
  // Sessions in display order — chronological.
  const ordered = [...chain.sessions].sort(
    (a, b) => Date.parse(a.startedIso) - Date.parse(b.startedIso),
  )
  const parts: string[] = []
  parts.push(
    `# ${chain.project} · ${ordered.length} session${ordered.length === 1 ? '' : 's'}`,
    '',
    `_${fmtWhen(chain.startedIso)} → ${fmtWhen(chain.endedIso ?? chain.startedIso)} · ${chain.msgCount} msgs_`,
    '',
  )
  for (let i = 0; i < ordered.length; i += 1) {
    const s = ordered[i]
    parts.push('---', '', `## Session ${i + 1} — ${s.topic || '(no topic)'}`, '')
    parts.push(`_${fmtWhen(s.startedIso)}${s.model ? ` · ${s.model}` : ''}_`, '')
    try {
      parts.push(await loadSessionContent(s))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      parts.push(`_Could not load session transcript at \`${s.path}\` — ${message}_`)
    }
    parts.push('')
  }
  return parts.join('\n')
}
