#!/usr/bin/env node
// Local test harness for the range-summary contract — two-stage pipeline.
//
// Stage 1 (LABEL): ask the model to assign each chain a short theme label.
//                  Single call, small output. Model just classifies; no
//                  grouping or aggregation is asked of it here.
// Stage 2 (CLUSTER, deterministic): group chains by normalized label,
//                  aggregate time / session count / date span per cluster,
//                  demote clusters below a threshold to a "misc" bucket
//                  which becomes the "Also worked on" bullet.
// Stage 3 (NARRATE): feed the pre-grouped clusters back to the model.
//                  Model writes one numbered bullet per cluster, in the
//                  order given (biggest-time first). Cannot lose chains,
//                  cannot re-split, cannot re-order.
//
// This trades one extra model call for reliability. Local models are good
// at "look at one thing and describe it"; they're bad at "hold 12 things
// in attention and group them correctly". So we do the grouping.
//
// Usage:
//   BASE_URL=http://127.0.0.1:8080/v1 MODEL=qwen3.6-35b-ud \
//     node frontend/scripts/ai/testRangeSummary.mjs [project]

import fs from 'node:fs/promises'
import path from 'node:path'

const VAULT_ROOT =
  process.env.THINKSPC_VAULT_ROOT ||
  process.env.LTM_VAULT_ROOT ||
  '/Users/patila06/Library/Mobile Documents/iCloud~md~obsidian/Documents/Long-Term-Memory-iCloud'
const BASE_URL = (process.env.BASE_URL || 'http://127.0.0.1:1234/v1').replace(/\/+$/, '')
const MODEL = process.env.MODEL || 'qwen2.5-7b-instruct'
const API_KEY = process.env.API_KEY || 'not-needed'

// Clusters at or below this fraction of the range's total time fall into
// the "Also worked on" tail bullet. 5% keeps small experiments/one-offs out
// of the arc list without hiding anything you spent real time on.
const MISC_THRESHOLD_FRAC = 0.05
// Absolute floor — anything under this in ms is always misc, no matter
// what fraction it is (10 minutes).
const MISC_MIN_MS = 10 * 60_000
// Hard cap on numbered arcs — even with two-stage clustering, giving the
// narrator > 5 arcs at once causes silent-drop failures. Extras beyond this
// cap get demoted to misc regardless of time.
const MAX_ARCS = 5

const SAMPLES = {
  'Thinking-Space': ['2026-06-19', '2026-06-26', '2026-07-02'],
  'F9': ['2026-06-11', '2026-06-24', '2026-06-28'],
  'Understanding_Myself': ['2026-06-11', '2026-07-02', '2026-07-03'],
}

// ── Small helpers ──────────────────────────────────────────────────────

function formatDurationMinutes(ms) {
  const totalMinutes = Math.max(1, Math.round(ms / 60_000))
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  if (h === 0) return `${m}m`
  if (m === 0) return `${h}h`
  return `${h}h ${m}m`
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function fmtDate(iso) {
  const [, m, d] = iso.split('-')
  return `${MONTH_SHORT[Number(m) - 1]} ${Number(d)}`
}

function fmtDateSpan(startIso, endIso) {
  if (startIso === endIso) return `on ${fmtDate(startIso)}`
  return `across ${fmtDate(startIso)} → ${fmtDate(endIso)}`
}

// ── Vault reader ───────────────────────────────────────────────────────

function parseFrontmatter(md) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(md)
  if (!m) return { fm: {}, body: md }
  const fm = {}
  for (const line of m[1].split('\n')) {
    const kv = /^([A-Za-z0-9_]+)\s*:\s*(.*)$/.exec(line)
    if (!kv) continue
    let v = kv[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    fm[kv[1]] = v
  }
  return { fm, body: md.slice(m[0].length) }
}

async function readChainsForProjectDate(project, date) {
  const dir = path.join(VAULT_ROOT, 'ai-activity', 'chains', project, date)
  let entries
  try { entries = await fs.readdir(dir) } catch { return [] }
  const chains = []
  for (const name of entries) {
    if (!name.endsWith('.md')) continue
    const raw = await fs.readFile(path.join(dir, name), 'utf8')
    const { fm, body } = parseFrontmatter(raw)
    if (!fm.chainKey) continue
    const summary = body.replace(/^#\s+.*\n+/, '').trim()
    chains.push({
      chainKey: fm.chainKey,
      // Short readable key we hand to the model — clashes are prevented
      // by suffixing with the source ordinal.
      shortKey: `S${chains.length + 1}`,
      date: fm.date || date,
      startedIso: fm.startedIso,
      endedIso: fm.endedIso,
      title: fm.title || 'Untitled',
      summary,
      durationMs: Number(fm.durationMs) || 0,
      msgCount: Number(fm.msgCount) || 0,
    })
  }
  return chains
}

async function readRangeForProject(project) {
  const dates = SAMPLES[project]
  if (!dates) throw new Error(`Unknown project: ${project}`)
  const all = []
  for (const d of dates) all.push(...(await readChainsForProjectDate(project, d)))
  // Re-issue shortKeys sequentially across the whole range so labeling
  // output is easy to map back.
  all.forEach((c, i) => { c.shortKey = `S${i + 1}` })
  return {
    project: project.replace(/_/g, ' '),
    rangeStart: dates[0],
    rangeEnd: dates[dates.length - 1],
    chains: all,
  }
}

// ── OpenAI-compat call ─────────────────────────────────────────────────

async function callModel(systemPrompt, userPrompt, { maxTokens = 900 } = {}) {
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.15,
      max_tokens: maxTokens,
      enable_thinking: false,
      chat_template_kwargs: { enable_thinking: false },
    }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 400)}`)
  }
  const json = await res.json()
  return json.choices?.[0]?.message?.content ?? ''
}

// ── Stage 1: label ─────────────────────────────────────────────────────

const LABEL_SYSTEM = [
  'You are a THEME CLUSTERER for a range of AI-assisted work sessions.',
  '',
  'Given N sessions (title + first bullet each), your job is to propose',
  '3 to 6 THEMES that describe the whole range at a workstream level,',
  'then assign every session to exactly one theme. Aim LOW on theme',
  'count — a range with 12 sessions usually has 3 or 4 real themes, not',
  '12 distinct ones.',
  '',
  'Rules for naming themes:',
  '  - 2-5 words. No dates. No punctuation-heavy titles.',
  '  - Name the workstream, not the session (prefer "Webull work",',
  '    "AMD study", "auth pipeline overhaul" — NOT "logo fix",',
  '    "credential decryption bug").',
  '  - Sessions that touch the same product/file/company almost always',
  '    belong together, even if the session titles use different words.',
  '    Example: a session titled "Refining ticker logo rendering in',
  '    Webull positions" and one titled "Electron credential store fix,',
  '    UI spacing, and Webull workspace layout polishing" are BOTH',
  '    "Webull work" — group them.',
  '  - If a session doesn\'t fit any real theme, assign it to a theme',
  '    called "Misc". Do not invent a one-item theme for it.',
  '',
  'OUTPUT FORMAT (strict, exact structure — no markdown headings, no',
  'preamble, no trailing notes):',
  '',
  '  THEMES:',
  '  1. <theme name>',
  '  2. <theme name>',
  '  3. <theme name>',
  '  ...',
  '',
  '  ASSIGNMENTS:',
  '  S1 -> 2',
  '  S2 -> 1',
  '  S3 -> 1',
  '  ...',
  '',
  'Assignments reference themes by their number. Every session in the',
  'input MUST appear in the assignments list exactly once.',
  '',
  'Example input:',
  '  S1: Add Adyen provider adapter',
  '       Wired new charge/refund endpoints against Adyen SDK.',
  '  S2: Wire Adyen webhook signature verification',
  '       Ported HMAC verification and added replay-window check.',
  '  S3: Fix null refund amount edge case',
  '       Refunds with null amount now default to original charge total.',
  '  S4: Rebrand landing page hero section',
  '       Replaced old logo lockup and copy.',
  '  S5: Adyen dashboard failure-taxonomy view',
  '       Wired 6 canonical failure modes into a dashboard.',
  '',
  'Example output:',
  '  THEMES:',
  '  1. Adyen migration',
  '  2. Landing page rebrand',
  '',
  '  ASSIGNMENTS:',
  '  S1 -> 1',
  '  S2 -> 1',
  '  S3 -> 1',
  '  S4 -> 2',
  '  S5 -> 1',
].join('\n')

function firstBulletOfSummary(summary) {
  if (!summary) return ''
  const m = /^1[.)]\s*(.+?)(?:\n2[.)]|$)/s.exec(summary)
  if (m) return m[1].split('\n').join(' ').trim().slice(0, 300)
  return summary.split('\n').filter(Boolean)[0]?.slice(0, 300) ?? ''
}

function buildLabelUserPrompt(chains) {
  const lines = []
  chains.forEach(c => {
    lines.push(`${c.shortKey}: ${c.title}`)
    const first = firstBulletOfSummary(c.summary)
    if (first) lines.push(`       ${first}`)
  })
  return lines.join('\n')
}

function parseLabelOutput(raw, chains) {
  const byShort = new Map(chains.map(c => [c.shortKey, c]))
  // Two-phase parse: first pull the numbered THEMES list, then the
  // ASSIGNMENTS map, then flatten to a `shortKey -> label string` map so
  // the rest of the pipeline can stay identical.
  const themes = new Map() // themeNum -> theme name
  const assignments = new Map() // shortKey -> themeNum
  let mode = null
  for (const rawLine of raw.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    if (/^themes\s*[:\-—]?\s*$/i.test(line)) { mode = 'themes'; continue }
    if (/^assignments\s*[:\-—]?\s*$/i.test(line)) { mode = 'assign'; continue }
    if (mode === 'themes') {
      const m = /^(\d+)[.)]\s*(.+?)\s*$/.exec(line)
      if (m) themes.set(m[1], m[2].replace(/\*+/g, '').replace(/^["']|["']$/g, '').trim())
      continue
    }
    if (mode === 'assign') {
      const m = /^(S\d+)\s*(?:->|→|:)\s*(\d+)\s*$/.exec(line)
      if (m && byShort.has(m[1])) assignments.set(m[1], m[2])
      continue
    }
  }
  const labels = new Map()
  for (const c of chains) {
    const themeNum = assignments.get(c.shortKey)
    const themeName = themeNum ? themes.get(themeNum) : null
    labels.set(c.shortKey, themeName || 'Misc')
  }
  return labels
}

// ── Stage 2: cluster ───────────────────────────────────────────────────

function normalizeLabelKey(label) {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .sort()
    .join(' ')
}

function clusterByLabel(chains, labelMap) {
  // Labeler already grouped by proposing themes and assigning sessions to
  // them, so the clustering here is deterministic: bucket by the assigned
  // label string. No fuzzy merging — the labeler is responsible for
  // catching cross-session themes; post-hoc regex merging over-fires.
  const groups = new Map()
  for (const c of chains) {
    const label = labelMap.get(c.shortKey) || 'Misc'
    const key = normalizeLabelKey(label)
    if (!groups.has(key)) groups.set(key, { label, chains: [], totalMs: 0 })
    const g = groups.get(key)
    g.chains.push(c)
    g.totalMs += c.durationMs
    if (label.length > g.label.length) g.label = label
  }
  return Array.from(groups.values())
}

function splitArcsAndMisc(clusters, rangeTotalMs) {
  const arcs = []
  const misc = []
  for (const c of clusters) {
    const frac = rangeTotalMs > 0 ? c.totalMs / rangeTotalMs : 0
    const explicitMisc = /^misc$/i.test(c.label.trim())
    if (explicitMisc || c.totalMs < MISC_MIN_MS || frac < MISC_THRESHOLD_FRAC) {
      misc.push(c)
    } else {
      arcs.push(c)
    }
  }
  arcs.sort((a, b) => b.totalMs - a.totalMs)
  // Hard-cap arcs: extras beyond MAX_ARCS demote to misc regardless of time.
  // Narrators start dropping content silently past ~5-6 arcs; keeping the arc
  // list tight is the cheapest way to make the output reliable.
  if (arcs.length > MAX_ARCS) {
    const overflow = arcs.splice(MAX_ARCS)
    misc.push(...overflow)
  }
  return { arcs, misc }
}

// ── Stage 3: narrate ───────────────────────────────────────────────────

const NARRATE_SYSTEM = [
  'You fill in narration slots on a pre-built template. The template has',
  'a fixed number of numbered bullets, already formatted with theme label,',
  'session count, date span, and duration. Each bullet contains a single',
  '[NARRATION] placeholder — your only job is to replace each [NARRATION]',
  'with one or two sentences.',
  '',
  'HARD RULES:',
  '  - Reproduce every bullet from the template EXACTLY, in the order given.',
  '    Do not add, remove, reorder, or renumber bullets.',
  '  - Replace each [NARRATION] token with 1-2 sentences drawn ONLY from',
  '    the "Sessions block" attached to that same bullet. Never borrow',
  '    content from another bullet or invent details.',
  '  - Name concrete files, features, companies, or decisions from the',
  '    sessions. Use work-voice ("Landed X", "Fixed Y", "Named Z"). Never',
  '    "the user" / "the assistant" / "you".',
  '  - Do not modify the numbering, the theme label, the session count, or',
  '    the time — those are already correct.',
  '  - No preamble, no trailing notes, no markdown headings or code fences.',
  '    Emit the filled-in template and stop.',
].join('\n')

function buildNarrateUserPrompt(project, rangeStart, rangeEnd, arcs, misc) {
  const totalMs = [...arcs, ...misc].reduce((n, c) => n + c.totalMs, 0)
  const uniqueDays = new Set([...arcs, ...misc].flatMap(c => c.chains.map(x => x.date))).size
  const parts = []
  parts.push(`Project: ${project}`)
  parts.push(
    `Range: ${fmtDate(rangeStart)} → ${fmtDate(rangeEnd)} · ${uniqueDays} day${uniqueDays === 1 ? '' : 's'} with activity · ${arcs.length + misc.length} chains · ~${formatDurationMinutes(totalMs)} total`,
  )
  parts.push('')

  arcs.forEach((cluster, i) => {
    const clusterStart = cluster.chains.reduce((a, c) => (a && a < c.date ? a : c.date), '')
    const clusterEnd = cluster.chains.reduce((a, c) => (a && a > c.date ? a : c.date), '')
    parts.push('---')
    parts.push(`ARC ${i + 1}`)
    parts.push(`theme_label: ${cluster.label}`)
    parts.push(`session_count: ${cluster.chains.length}`)
    parts.push(`date_span: ${fmtDateSpan(clusterStart, clusterEnd)}`)
    parts.push(`duration: ${formatDurationMinutes(cluster.totalMs)}`)
    parts.push('')
    parts.push('Sessions in this arc:')
    cluster.chains
      .slice()
      .sort((a, b) => b.durationMs - a.durationMs)
      .forEach((c, j) => {
        parts.push(`  ${j + 1}. ${c.title} (${c.date}, ${formatDurationMinutes(c.durationMs)})`)
        if (c.summary?.trim()) {
          for (const line of c.summary.trim().split('\n')) {
            parts.push(`     ${line}`)
          }
        }
      })
    parts.push('')
  })

  if (misc.length > 0) {
    parts.push('---')
    parts.push('MISC (goes into the "Also worked on" bullet)')
    misc
      .slice()
      .sort((a, b) => b.totalMs - a.totalMs)
      .forEach(cluster => {
        cluster.chains.forEach(c => {
          const first = firstBulletOfSummary(c.summary)
          parts.push(`  - ${c.title} (${c.date}, ${formatDurationMinutes(c.durationMs)}): ${first}`)
        })
      })
    parts.push('')
  }

  parts.push('---')
  parts.push('OUTPUT:')
  return parts.join('\n')
}

function sanitizeBody(raw) {
  const stripped = raw.replace(/^```(?:markdown|md)?\s*/i, '').replace(/```\s*$/i, '').trim()
  const lines = stripped.split('\n')
  let firstBullet = -1
  for (let i = 0; i < lines.length; i += 1) {
    if (/^\s*1\.\s/.test(lines[i])) { firstBullet = i; break }
  }
  const body = firstBullet >= 0 ? lines.slice(firstBullet).join('\n') : stripped
  return body.replace(/\n{3,}/g, '\n\n').trim()
}

// ── Main ───────────────────────────────────────────────────────────────

async function summarizeRange(project) {
  const range = await readRangeForProject(project)
  if (range.chains.length === 0) {
    return { project: range.project, body: `_no chain digests found_`, timings: {} }
  }
  const rangeTotalMs = range.chains.reduce((n, c) => n + c.durationMs, 0)

  // Stage 1: label
  const t1 = Date.now()
  const labelPrompt = buildLabelUserPrompt(range.chains)
  const labelRaw = await callModel(LABEL_SYSTEM, labelPrompt, { maxTokens: 400 })
  const labels = parseLabelOutput(labelRaw, range.chains)
  const labelMs = Date.now() - t1

  // Stage 2: cluster (deterministic)
  const clusters = clusterByLabel(range.chains, labels)
  const { arcs, misc } = splitArcsAndMisc(clusters, rangeTotalMs)

  // Stage 3: narrate
  const t2 = Date.now()
  const narratePrompt = buildNarrateUserPrompt(range.project, range.rangeStart, range.rangeEnd, arcs, misc)
  const narrateRaw = await callModel(NARRATE_SYSTEM, narratePrompt, { maxTokens: 1200 })
  const narrateMs = Date.now() - t2
  const body = sanitizeBody(narrateRaw)

  return {
    project: range.project,
    rangeStart: range.rangeStart,
    rangeEnd: range.rangeEnd,
    chains: range.chains.length,
    totalMs: rangeTotalMs,
    labels,
    arcs,
    misc,
    body,
    timings: { labelMs, narrateMs },
  }
}

async function main() {
  const projArg = process.argv[2]
  const projects = projArg ? [projArg] : Object.keys(SAMPLES)
  console.log(`# Range-summary test (two-stage: label + narrate)\n`)
  console.log(`server: ${BASE_URL}   model: ${MODEL}\n`)

  for (const proj of projects) {
    console.log(`\n## ${proj.replace(/_/g, ' ')}`)
    try {
      const r = await summarizeRange(proj)
      const durLabel = formatDurationMinutes(r.totalMs || 0)
      console.log(`(${r.chains} chains · ~${durLabel} total)`)
      console.log(`(label ${(r.timings.labelMs / 1000).toFixed(1)}s + narrate ${(r.timings.narrateMs / 1000).toFixed(1)}s)\n`)
      console.log('### Themes assigned')
      for (const [k, v] of r.labels) console.log(`  ${k}: ${v}`)
      console.log('')
      console.log('### Clustered')
      r.arcs.forEach((c, i) => console.log(`  ARC ${i + 1}: ${c.label} — ${c.chains.length} sess, ${formatDurationMinutes(c.totalMs)}`))
      r.misc.forEach(c => console.log(`  MISC: ${c.label} — ${c.chains.length} sess, ${formatDurationMinutes(c.totalMs)}`))
      console.log('')
      console.log('### Model output')
      console.log(r.body)
    } catch (err) {
      console.error(`  ERROR: ${err.message}`)
    }
    console.log('\n---')
  }

  console.log(`\n(gold in docs/ai-activity/day-atom-gold-standard.md)`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
