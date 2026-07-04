#!/usr/bin/env node
// Alt experiment: single model call, reasoning enabled, no pre-clustering.
//
// We do the ONE thing that's deterministic (sort chains by duration
// descending) and hand the model a sorted list with a generic input→output
// example. Model is asked to group + narrate in one pass, using its
// reasoning tokens to think through the arcs before emitting the summary.
//
// Bet: with reasoning enabled, the model has enough working memory to
// group + rank + narrate in one shot, and we don't need the two-stage
// scaffolding we built for the no-reasoning path.
//
// Usage:
//   BASE_URL=http://127.0.0.1:8080/v1 MODEL=qwen3.6-35b-ud \
//     node frontend/scripts/ai/testRangeSummaryReason.mjs [project]

import fs from 'node:fs/promises'
import path from 'node:path'

const VAULT_ROOT =
  process.env.THINKSPC_VAULT_ROOT ||
  process.env.LTM_VAULT_ROOT ||
  '/Users/patila06/Library/Mobile Documents/iCloud~md~obsidian/Documents/Long-Term-Memory-iCloud'
const BASE_URL = (process.env.BASE_URL || 'http://127.0.0.1:1234/v1').replace(/\/+$/, '')
const MODEL = process.env.MODEL || 'qwen2.5-7b-instruct'
const API_KEY = process.env.API_KEY || 'not-needed'

const SAMPLES = {
  'Thinking-Space': ['2026-06-19', '2026-06-26', '2026-07-02'],
  'F9': ['2026-06-11', '2026-06-24', '2026-06-28'],
  'Understanding_Myself': ['2026-06-11', '2026-07-02', '2026-07-03'],
}

// ── Helpers (shared shape with the two-stage runner) ───────────────────

function formatDurationMinutes(ms) {
  const totalMinutes = Math.max(1, Math.round(ms / 60_000))
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}
const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
function fmtDate(iso) { const [, m, d] = iso.split('-'); return `${MONTH_SHORT[Number(m)-1]} ${Number(d)}` }
function fmtClock(iso) { const d = new Date(iso); return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}` }

function parseFm(md) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(md)
  if (!m) return { fm: {}, body: md }
  const fm = {}
  for (const line of m[1].split('\n')) {
    const kv = /^([A-Za-z0-9_]+)\s*:\s*(.*)$/.exec(line); if (!kv) continue
    let v = kv[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    fm[kv[1]] = v
  }
  return { fm, body: md.slice(m[0].length) }
}

async function readRange(project) {
  const dates = SAMPLES[project]
  const all = []
  for (const d of dates) {
    const dir = path.join(VAULT_ROOT, 'ai-activity', 'chains', project, d)
    let entries; try { entries = await fs.readdir(dir) } catch { continue }
    for (const name of entries) {
      if (!name.endsWith('.md')) continue
      const { fm, body } = parseFm(await fs.readFile(path.join(dir, name), 'utf8'))
      if (!fm.chainKey) continue
      all.push({
        chainKey: fm.chainKey,
        date: fm.date || d,
        startedIso: fm.startedIso,
        endedIso: fm.endedIso,
        title: fm.title || 'Untitled',
        summary: body.replace(/^#\s+.*\n+/, '').trim(),
        durationMs: Number(fm.durationMs) || 0,
        msgCount: Number(fm.msgCount) || 0,
      })
    }
  }
  return { project: project.replace(/_/g, ' '), rangeStart: dates[0], rangeEnd: dates[dates.length - 1], chains: all }
}

// ── System prompt with one generic input/output example ─────────────────

const SYSTEM = [
  'You summarize a range of AI-assisted project work as a short list of',
  'ARCS ordered by time spent — the arc that ate more wall-clock time',
  'matters more, full stop.',
  '',
  'You will be given the sessions already SORTED BY DURATION DESCENDING.',
  'Your job:',
  '  1. GROUP the sessions into 2-5 arcs by shared workstream (same',
  '     product / file / concept / study subject). Sessions on the same',
  '     underlying effort belong together even if their session titles',
  '     use slightly different words.',
  '  2. RANK arcs by total time descending (sum of session durations in',
  '     the arc).',
  '  3. NARRATE each arc as one numbered bullet, drawing content only',
  '     from the sessions IN that arc.',
  '  4. Roll one-off / tiny sessions into a final "Also worked on"',
  '     numbered bullet.',
  '',
  'OUTPUT FORMAT (strict): numbered bullets `1.` `2.` `3.` — one per arc,',
  'plus one final "Also worked on" bullet only if there are misc items.',
  'Each arc bullet follows this shape exactly:',
  '',
  '  N. **<theme label>** — <M> sessions <date span>, **~Xh Ym**.',
  '     <One or two sentences on the arc, naming concrete files, features,',
  '     companies, or decisions from the sessions in that arc.>',
  '',
  'Generic example — INPUT:',
  '',
  '  Project: Weather App',
  '  Range: Mar 3 → Mar 14 · 5 chains · ~4h 40m',
  '',
  '  Session 1: Add radar overlay to daily forecast (Mar 5, 1h 45m)',
  '     Wired NWS radar tile source into the daily-forecast card, added a',
  '     click-to-expand handler, and cached the last 6 frames.',
  '  Session 2: Radar cache eviction policy (Mar 10, 1h 20m)',
  '     Bumped LRU limit and added a background cleanup pass for stale',
  '     tiles older than 24h.',
  '  Session 3: Fix wind gust chart null crash (Mar 8, 40m)',
  '     Null-guarded the gust series so days with missing readings render',
  '     an empty band instead of throwing.',
  '  Session 4: Radar tile CORS fallback (Mar 11, 35m)',
  '     Added a same-origin proxy for tiles the CDN sometimes serves',
  '     without CORS headers.',
  '  Session 5: Bump copyright year in About page (Mar 3, 5m)',
  '     Trivial edit.',
  '',
  'Generic example — OUTPUT:',
  '',
  '  1. **Radar overlay pipeline** — 3 sessions across Mar 5 → Mar 11,',
  '     **~3h 40m**. Wired the NWS radar tile source into the daily',
  '     forecast, added click-to-expand + a 6-frame cache, tuned the LRU',
  '     eviction policy for stale tiles, and added a same-origin proxy',
  '     fallback for CDN tiles missing CORS headers.',
  '  2. **Wind gust chart null crash fix** — 1 session on Mar 8, **~40m**.',
  '     Null-guarded the gust series so days with missing readings render',
  '     an empty band instead of throwing.',
  '  3. **Also worked on:** copyright-year bump on the About page.',
  '',
  'RULES:',
  '  - Sort arcs by total time descending. NEVER drop an arc silently — if',
  '    two sessions are unrelated, either give them separate arc bullets',
  '    or roll them into "Also worked on".',
  '  - Draw narration ONLY from the sessions IN that arc. Do NOT invent',
  '    facts. Do NOT borrow from the example above — it\'s about a weather',
  '    app that does not exist in your input.',
  '  - Use the work-voice ("Landed X", "Fixed Y", "Named Z"). Never "the',
  '    user" / "the assistant" / "you".',
  '  - Bullets are numbered `1.` `2.` etc. No markdown headings, no code',
  '    fences, no preamble, no trailing notes.',
].join('\n')

// ── Build user prompt (sorted by duration desc) ────────────────────────

function buildUserPrompt(range) {
  const totalMs = range.chains.reduce((n, c) => n + c.durationMs, 0)
  const uniqueDays = new Set(range.chains.map(c => c.date)).size
  const ranked = [...range.chains].sort((a, b) => b.durationMs - a.durationMs)
  const parts = []
  parts.push(`Project: ${range.project}`)
  parts.push(
    `Range: ${fmtDate(range.rangeStart)} → ${fmtDate(range.rangeEnd)} · ${uniqueDays} day${uniqueDays === 1 ? '' : 's'} with activity · ${ranked.length} chains · ~${formatDurationMinutes(totalMs)} total`,
  )
  parts.push('')
  parts.push('Sessions (sorted by duration descending — biggest first):')
  parts.push('')
  ranked.forEach((c, i) => {
    parts.push(`Session ${i + 1}: ${c.title}`)
    parts.push(`  ${c.date} · ${fmtClock(c.startedIso)}–${fmtClock(c.endedIso)} · ${c.msgCount} msgs · ${formatDurationMinutes(c.durationMs)}`)
    if (c.summary?.trim()) {
      for (const line of c.summary.trim().split('\n')) parts.push(`  ${line}`)
    }
    parts.push('')
  })
  parts.push('---')
  parts.push('OUTPUT:')
  return parts.join('\n')
}

// ── Model call — reasoning ENABLED ─────────────────────────────────────

async function callModel(userPrompt) {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.2,
      // Reasoning eats output tokens; Qwen 3.6-35B MoE reasoning traces
      // for a 12-chain range run 15-20k chars. Give plenty of room so we
      // don't run out mid-thought.
      max_tokens: 16000,
      // Turn reasoning ON — this is the whole point of this experiment.
      enable_thinking: true,
      chat_template_kwargs: { enable_thinking: true },
    }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 400)}`)
  const json = await res.json()
  const msg = json.choices?.[0]?.message ?? {}
  const content = msg.content ?? ''
  const reasoning = msg.reasoning ?? msg.reasoning_content ?? ''
  return { content, reasoning }
}

function stripReasoningWrappers(raw) {
  // Some servers embed reasoning in <think>...</think>; strip it if present.
  return raw
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```(?:markdown|md)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim()
}

// ── Main ───────────────────────────────────────────────────────────────

async function main() {
  const projArg = process.argv[2]
  const projects = projArg ? [projArg] : Object.keys(SAMPLES)
  console.log(`# Range-summary experiment (single-shot, reasoning ON)\n`)
  console.log(`server: ${BASE_URL}   model: ${MODEL}\n`)

  for (const proj of projects) {
    const range = await readRange(proj)
    if (range.chains.length === 0) { console.log(`\n## ${range.project}\n_no digests_\n`); continue }
    const totalMs = range.chains.reduce((n, c) => n + c.durationMs, 0)
    console.log(`\n## ${range.project}`)
    console.log(`(${range.chains.length} chains · ~${formatDurationMinutes(totalMs)} total)`)
    const prompt = buildUserPrompt(range)
    const t0 = Date.now()
    try {
      const { content, reasoning } = await callModel(prompt)
      const dt = ((Date.now() - t0) / 1000).toFixed(1)
      console.log(`(done in ${dt}s · reasoning ${reasoning.length} chars · content ${content.length} chars)\n`)
      if (reasoning) {
        console.log('### Reasoning (excerpt)')
        console.log(reasoning.slice(0, 800) + (reasoning.length > 800 ? '\n…' : ''))
        console.log('')
      }
      console.log('### Model output')
      console.log(stripReasoningWrappers(content))
    } catch (err) {
      console.error(`  ERROR: ${err.message}`)
    }
    console.log('\n---')
  }
}

main().catch(err => { console.error(err); process.exit(1) })
