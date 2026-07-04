#!/usr/bin/env node
// End-to-end test of the claude-cli range-summary path — shells `claude -p`
// with the exact same system prompt + user prompt shape production sends,
// so if this works from the shell it works from the Electron main-process
// handler (which spawns the same binary with the same args).
//
// Reuses the 9 hand-picked gold-standard chain digests as fixtures.
//
// Usage:
//   node frontend/scripts/ai/testClaudeCliRangeSummary.mjs [project]
//   MODEL=opus node frontend/scripts/ai/testClaudeCliRangeSummary.mjs

import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'

const VAULT_ROOT =
  process.env.THINKSPC_VAULT_ROOT ||
  process.env.LTM_VAULT_ROOT ||
  '/Users/patila06/Library/Mobile Documents/iCloud~md~obsidian/Documents/Long-Term-Memory-iCloud'
const CLAUDE_BIN = '/opt/homebrew/bin/claude'
const MODEL = process.env.MODEL || 'sonnet'

const SAMPLES = {
  'Thinking-Space': ['2026-06-19', '2026-06-26', '2026-07-02'],
  'F9': ['2026-06-11', '2026-06-24', '2026-06-28'],
  'Understanding_Myself': ['2026-06-11', '2026-07-02', '2026-07-03'],
}

// ── SYSTEM prompt — exact copy from rangeSummaryContractBlock.ts ──────

const SYSTEM_PROMPT = [
  'You summarize a range of AI-assisted project work — usually a week or two,',
  'sometimes a month — as a short list of ARCS ordered by time spent. Time',
  'is the honest importance signal: an arc that ate three hours over two',
  'days matters more than one that took twenty minutes, regardless of how',
  'interesting either topic sounds.',
  '',
  'INPUT: aggregate stats for the range, then per-chain sections in',
  'descending duration. Each chain section starts with a metadata line',
  '(`date · started HH:MM-HH:MM · Nmsgs · Xm`) followed by the chain\'s',
  'title and numbered-bullet summary from the chain-digest step.',
  '',
  'OUTPUT FORMAT (strict): numbered bullets `1.` `2.` `3.` etc, one per',
  'line-start (bullet body may span multiple lines). Each ARC bullet',
  'follows this shape:',
  '',
  '  N. **<theme>** — <M sessions> across <date range>, **~Xh Ym** (raw',
  '     durations shown compactly). <One or two sentences on what the arc',
  '     was actually about, naming concrete files/companies/decisions.>',
  '',
  'Rank arcs by total time DESCENDING. After the arcs, add tail bullets',
  '(also numbered, continuing the sequence) in this fixed order:',
  '',
  '  - one bullet counting bugs fixed across the range (with rough combined',
  '    time if you can estimate it),',
  '  - one bullet counting features/artifacts shipped or filed,',
  '  - a final "**Also worked on:**" bullet for small cross-cutting items',
  '    that don\'t deserve their own arc (blocked/deferred work, one-off',
  '    experiments, tangents). Small-scale outcome-less sessions belong',
  '    here regardless of topic.',
  '',
  'Example (payments-system engineering range):',
  '  Range: 2026-04-08 → 2026-04-21 · 11 chains · ~8h 40m',
  '',
  '  1. **Stripe → Adyen migration** — 4 sessions across Apr 8 → Apr 15,',
  '     **~3h 30m**. New charge/refund endpoints wired, webhook signature',
  '     verification ported, backwards-compat shim for the two callers',
  '     still on Stripe. Rollout gated on `PAYMENTS_ADYEN_ENABLED`.',
  '  2. **Idempotency-key rework** — 3 sessions across Apr 10 → Apr 18,',
  '     **~2h 15m**. Moved from request-ID to hash-of-body, storage swapped',
  '     to Redis with 24h TTL, replay-safety proof added to the docs page.',
  '  3. **Payment-failure taxonomy** — 2 sessions on Apr 12, **~1h 20m**.',
  '     Named 6 canonical failure modes, wired the mapping table, dashboards',
  '     updated.',
  '  4. **~5 bug fixes** across the range, **~40m combined**: null refund',
  '     amount, webhook duplicate-delivery race, currency-code casing,',
  '     timeout-on-retry-loop, config-load ordering.',
  '  5. **~3 features shipped**: Adyen provider adapter, hash-based',
  '     idempotency, failure taxonomy dashboard.',
  '  6. **Also worked on:** dead-code cleanup in the old Stripe adapter',
  '     (deferred until flag flip), one-off refund for a stuck test-mode',
  '     payment, brief spike on tokenization vs. hosted-fields for the',
  '     mobile SDK (parked).',
  '',
  'Example (semiconductor-study range):',
  '  Range: 2026-05-06 → 2026-05-19 · 7 chains · ~5h 45m',
  '',
  '  1. **TSMC capacity + 2nm ramp** — 3 sessions across May 6 → May 14,',
  '     **~2h 40m**. Wafer-capacity numbers pulled from two earnings calls,',
  '     Q3 planning note landed at `Semiconductor/Foundry/TSMC/tsmc-capacity.md`',
  '     with three named risks. Arizona ramp timing flagged as the biggest',
  '     open question.',
  '  2. **Applied Materials margin analysis** — 2 sessions on May 12,',
  '     **~1h 40m**. Historical operating margins bucketed by tool category,',
  '     gross-vs-op divergence traced to services mix.',
  '  3. **Advanced packaging deep-dive** — 1 session on May 17, **~50m**.',
  '     CoWoS vs HBM3E named as the binding constraint on AI-accelerator',
  '     throughput in 2026.',
  '  4. **~2 study records + 3 concept notes** filed under `Semiconductor/`.',
  '  5. **2 durable frameworks** named: *structural-floor-vs-cyclical-premium*',
  '     (extended from an earlier NVDA note), *tool-category margin dispersion*.',
  '  6. **Also worked on:** brief revisit of ASML lithography roadmap',
  '     (folded into TSMC note), quick note on Micron\'s HBM3E supply',
  '     guidance during the AMAT session.',
  '',
  'RULES:',
  '  - NO preamble ("Here is the summary"). NO trailing meta-notes.',
  '    NO markdown headings or code fences. Just numbered bullets.',
  '  - Rank arcs by total time DESCENDING. Small-scale items merge into',
  '    the "Also worked on" tail bullet regardless of topic or outcome.',
  '    Outcome does NOT demote — a one-hour blocked session is a real arc.',
  '  - Group chains into themes ACROSS days. Do NOT list chains one-per-',
  '    bullet; the whole point of the summary is theme detection.',
  '  - When a theme spans multiple days, say so ("3 sessions across Jun 10',
  '     → Jun 14"). When it\'s one day, say the date once.',
  '  - Concrete nouns: name the feature, file, company, decision. Avoid',
  '    generic words like "improvements", "changes", "some work".',
  '  - Use the work-voice: "Landed X", "Fixed Y", "Named Z", "Deferred W".',
  '    Never "the user" / "the assistant" / "you".',
  '  - Bug/feature counts are approximate — round to nearest sensible',
  '    number. If the range has neither, drop those bullets.',
  '  - If the range is truly empty (no signal), write one bullet: "1. Quiet',
  '    range — no substantive activity." and stop.',
].join('\n')

// ── Vault reader ───────────────────────────────────────────────────────

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
function fmtDur(ms) {
  const t = Math.max(1, Math.round(ms/60000)), h = Math.floor(t/60), m = t%60
  return h===0?`${m}m`:m===0?`${h}h`:`${h}h ${m}m`
}
function fmtClock(iso) {
  const d = new Date(iso)
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`
}
async function readChains(proj) {
  const dates = SAMPLES[proj]; const all = []
  for (const d of dates) {
    const dir = path.join(VAULT_ROOT, 'ai-activity', 'chains', proj, d)
    let entries; try { entries = await fs.readdir(dir) } catch { continue }
    for (const name of entries) {
      if (!name.endsWith('.md')) continue
      const { fm, body } = parseFm(await fs.readFile(path.join(dir, name), 'utf8'))
      if (!fm.chainKey) continue
      all.push({
        chainKey: fm.chainKey,
        title: fm.title || 'Untitled',
        summary: body.replace(/^#\s+.*\n+/, '').trim(),
        durationMs: Number(fm.durationMs) || 0,
        date: fm.date || d,
        startedIso: fm.startedIso,
        endedIso: fm.endedIso,
        msgCount: Number(fm.msgCount) || 0,
      })
    }
  }
  return { project: proj.replace(/_/g, ' '), rangeStart: dates[0], rangeEnd: dates[dates.length - 1], chains: all }
}

// ── Build user prompt (mirrors buildRangeSummaryUserPromptBlock) ──────

function buildUserPrompt(range) {
  const totalMs = range.chains.reduce((n, c) => n + c.durationMs, 0)
  const uniqueDays = new Set(range.chains.map(c => c.date)).size
  const parts = []
  parts.push(`Project: ${range.project}`)
  parts.push(
    `Range: ${range.rangeStart} → ${range.rangeEnd} · ${uniqueDays} day${uniqueDays === 1 ? '' : 's'} with activity`,
  )
  parts.push(`Chains: ${range.chains.length}   Total active: ${fmtDur(totalMs)}`)
  parts.push('')
  parts.push('---')
  parts.push('')
  const ranked = [...range.chains].sort((a, b) => b.durationMs - a.durationMs)
  ranked.forEach((c, i) => {
    parts.push(`### Session ${i + 1} — ${c.title}`)
    parts.push(`_${c.date} · ${fmtClock(c.startedIso)}–${fmtClock(c.endedIso)} · ${c.msgCount} msgs · ${fmtDur(c.durationMs)}_`)
    if (c.summary?.trim()) {
      parts.push('')
      parts.push(c.summary.trim())
    }
    parts.push('')
  })
  parts.push('---')
  parts.push('OUTPUT:')
  return parts.join('\n')
}

// ── Shell out to claude -p (same args the electron block uses) ─────────

async function runClaude(system, userPrompt, timeoutMs = 120_000) {
  return await new Promise((resolve) => {
    const home = process.env.HOME ?? ''
    const extra = ['/usr/local/bin', '/opt/homebrew/bin', path.join(home, '.local', 'bin')]
    const merged = [...extra, ...(process.env.PATH ?? '').split(':').filter(Boolean)].join(':')
    const proc = spawn(CLAUDE_BIN, ['-p', '--model', MODEL, '--system-prompt', system, userPrompt], {
      env: { ...process.env, PATH: merged, FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = '', stderr = '', timedOut = false
    const timer = setTimeout(() => { timedOut = true; proc.kill('SIGTERM') }, timeoutMs)
    proc.stdout.on('data', d => { stdout += d.toString() })
    proc.stderr.on('data', d => { stderr += d.toString() })
    proc.on('close', code => {
      clearTimeout(timer)
      if (timedOut) return resolve({ ok: false, error: `timeout ${timeoutMs}ms` })
      const trimmed = stdout.trim()
      if (/^Not logged in|Please run \/login/i.test(trimmed)) return resolve({ ok: false, error: 'not-logged-in' })
      if (code !== 0 && !trimmed) return resolve({ ok: false, error: stderr.trim() || `exit ${code}` })
      resolve({ ok: true, content: trimmed })
    })
    proc.on('error', err => { clearTimeout(timer); resolve({ ok: false, error: err.message }) })
  })
}

// ── Main ───────────────────────────────────────────────────────────────

async function main() {
  const projArg = process.argv[2]
  const projects = projArg ? [projArg] : Object.keys(SAMPLES)
  console.log(`# Claude-CLI range-summary test\n`)
  console.log(`binary: ${CLAUDE_BIN}   model: ${MODEL}\n`)

  for (const proj of projects) {
    const range = await readChains(proj)
    if (range.chains.length === 0) {
      console.log(`\n## ${range.project}\n_no chain digests found_\n`)
      continue
    }
    const totalMs = range.chains.reduce((n, c) => n + c.durationMs, 0)
    console.log(`\n## ${range.project} · ${range.rangeStart} → ${range.rangeEnd}`)
    console.log(`(${range.chains.length} chains · ~${fmtDur(totalMs)} total)\n`)
    const userPrompt = buildUserPrompt(range)
    const t0 = Date.now()
    const r = await runClaude(SYSTEM_PROMPT, userPrompt)
    const dt = ((Date.now() - t0) / 1000).toFixed(1)
    if (!r.ok) {
      console.log(`FAILED in ${dt}s: ${r.error}`)
      continue
    }
    console.log(`(done in ${dt}s · ${r.content.length} chars)\n`)
    console.log(r.content)
    console.log('\n---')
  }
}

main().catch(err => { console.error(err); process.exit(1) })
