#!/usr/bin/env node
/**
 * One-shot migration of the two assignment logs from `chainId` to `sessionId`,
 * and of `ai-activity/pending-assignments/` into the proposal log.
 *
 * ## Why this exists
 *
 * The assignment feature was refactored so the unit of disposition is the
 * session rather than the chain (a chain groups by *time* and can hold two
 * unrelated topics; an undertaking is a topic). The code was rekeyed; the data
 * on disk was not. Both parsers require `sessionId`, every stored line carried
 * `chainId`, and so every line was silently dropped — 220 proposals and a full
 * month of verdicts, rendered as "Nothing suggested right now."
 *
 * Separately, the in-session ask parked its answers in a second directory,
 * `pending-assignments/`, in a second format nothing ever read. Those are folded
 * in here as proposals at confidence 1.0 with `proposedBy: in-session` — a
 * first-hand answer is still a claim awaiting a human verdict, so it enters the
 * queue rather than stamping anything.
 *
 * ## The one hard part: `#wN` is an ordinal
 *
 * A chain id ends in the session's `path`, which carries a window marker like
 * `…/<uuid>.jsonl#w1`. That `#wN` is a *position*. Session ids used to be
 * positional too (`<uuid>::w2`, first window bare), until 752f792 re-anchored
 * them to the first event's uuid (`<uuid>::<event-uuid>`) precisely because a
 * position is not an identity.
 *
 * So an ordinal can be resolved only where a positional id still exists on
 * disk, or where the ordinal is 1 and the bare id exists. It can *never* be
 * matched onto an anchor form: the existence of `<uuid>::<anchor>` proves that
 * window was not the first, so answering `#w1` with it would be a guess wearing
 * a migration's authority — and would file a real verdict against the wrong
 * half of a sitting. Those lines are left alone and reported.
 *
 * Lines that cannot be migrated are moved to a `.unmigrated.txt` sidecar rather
 * than left in place. Nothing is destroyed and nothing is silently dropped, but
 * the live log stops carrying rows no reader can parse — otherwise the new
 * "could not read N lines" banner would be permanently lit by history, and a
 * banner that is always on is a banner nobody reads.
 *
 * Dry-run is the default; `--apply` writes, and every file it rewrites gets a
 * `.bak` first. Idempotent: a line already carrying `sessionId` passes through
 * untouched, so a second run is a no-op.
 */

import fs from 'node:fs'
import path from 'node:path'

const APPLY = process.argv.includes('--apply')
const REPO = path.resolve(import.meta.dirname, '../..')

function vaultRootBlock() {
  const fromEnv = process.env.THINKSPC_VAULT_ROOT
  if (fromEnv) return fromEnv.replace(/^"|"$/g, '')
  const envFile = path.join(REPO, '.env')
  if (!fs.existsSync(envFile)) throw new Error('No THINKSPC_VAULT_ROOT and no .env at repo root')
  const match = /^THINKSPC_VAULT_ROOT\s*=\s*"?(.+?)"?\s*$/m.exec(fs.readFileSync(envFile, 'utf8'))
  if (!match) throw new Error('THINKSPC_VAULT_ROOT not found in .env')
  return match[1]
}

const VAULT = vaultRootBlock()
const ACTIVITY = path.join(VAULT, 'ai-activity')
const PROPOSALS = path.join(ACTIVITY, 'proposals')
const VERDICTS = path.join(ACTIVITY, 'assignment-log')
const PENDING = path.join(ACTIVITY, 'pending-assignments')
const SESSIONS = path.join(ACTIVITY, 'sessions')

/**
 * Every session id the vault actually holds a digest for, read from the
 * digest's own frontmatter rather than from its filename.
 *
 * The filename is `sanitizeSegment(sessionId)`, which collapses `::` to `_` and
 * is therefore not invertible — `<uuid>_w2` could be `<uuid>::w2` or
 * `<uuid>_w2`. Reading the field is the only way to learn the real address, and
 * the real address is what has to go in the log.
 */
function knownSessionsBlock() {
  const ids = new Set()
  const project = new Map()
  if (!fs.existsSync(SESSIONS)) return { ids, project }
  for (const proj of fs.readdirSync(SESSIONS)) {
    const dir = path.join(SESSIONS, proj)
    if (!fs.statSync(dir).isDirectory()) continue
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.md')) continue
      const head = fs.readFileSync(path.join(dir, file), 'utf8').slice(0, 2000)
      const m = /^sessionId:\s*"?([^"\n]+?)"?\s*$/m.exec(head)
      if (!m) continue
      const id = m[1].trim()
      ids.add(id)
      project.set(id, proj)
    }
  }
  return { ids, project }
}

const known = knownSessionsBlock()

/**
 * Split a chain id's trailing path into its base session id and window ordinal.
 *
 * The base is derived with the *same* rules as `sessionIdOf`, not by stripping
 * an extension — three id schemes live in these logs and only one of them is a
 * bare uuid:
 *
 *   native claude   `<uuid>.jsonl`                        → <uuid>
 *   native codex    `rollout-<ts>-<uuid>.jsonl`           → <uuid>
 *   vault markdown  `<date>_<8hex>.md`                    → <8hex>
 *
 * Taking the basename verbatim resolved the first and missed the other two,
 * which is 363 of one month's verdicts — the whole Codex and vault-import
 * history — reported as "no digest" when the digests were there all along.
 */
function splitChainIdBlock(chainId) {
  if (typeof chainId !== 'string' || !chainId) return null
  const afterProject = chainId.includes('::') ? chainId.slice(chainId.indexOf('::') + 2) : chainId
  const leaf = afterProject.split('/').pop() ?? ''
  const hash = /^(.*?)#w(\d+)$/.exec(leaf)
  const withoutWindow = hash ? hash[1] : leaf
  const ordinal = hash ? Number(hash[2]) : null

  const uuid = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i.exec(withoutWindow)
  if (uuid) return { base: uuid[1].toLowerCase(), ordinal }
  const short = /_(\b[0-9a-f]{8}\b)\.(md|txt)$/i.exec(withoutWindow)
  if (short) return { base: short[1].toLowerCase(), ordinal }

  const base = withoutWindow.replace(/\.jsonl$/i, '').trim()
  return base ? { base, ordinal } : null
}

function projectFromChainIdBlock(chainId) {
  if (typeof chainId !== 'string') return ''
  const i = chainId.indexOf('::')
  return i > 0 ? chainId.slice(0, i) : ''
}

/**
 * Resolve a chain id to a session id the vault knows, or refuse.
 *
 * Candidates are enumerated from the two id schemes that were ever positional,
 * and each is confirmed against a real digest. An anchor-form id is never a
 * candidate — see the header.
 */
function resolveBlock(chainId) {
  const split = splitChainIdBlock(chainId)
  if (!split) return { id: null, reason: 'no session file in chainId' }
  const { base, ordinal } = split

  const candidates = []
  if (ordinal === null || ordinal === 1) candidates.push(base)
  if (ordinal !== null) candidates.push(`${base}::w${ordinal}`)

  const found = candidates.filter(c => known.ids.has(c))
  if (found.length === 1) return { id: found[0], reason: 'ok' }
  if (found.length > 1) return { id: null, reason: `ambiguous: ${found.join(' | ')}` }

  const anchored = [...known.ids].filter(id => id.startsWith(`${base}::`))
  if (anchored.length) {
    return {
      id: null,
      reason:
        ordinal === null
          ? `only anchored ids exist for this session (${anchored.length} on disk) and the chain id names no window`
          : `window ordinal #w${ordinal} cannot be mapped onto an anchored id (${anchored.length} on disk) — ordinals are positions, not identities`,
    }
  }
  return { id: null, reason: 'no digest for this session' }
}

function migrateLogFileBlock(file, kind) {
  const raw = fs.readFileSync(file, 'utf8')
  const report = { file, kind, total: 0, already: 0, migrated: 0, moved: 0, reasons: new Map() }
  const keep = []
  const parked = []

  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    report.total += 1

    let obj
    try {
      obj = JSON.parse(trimmed)
    } catch {
      report.moved += 1
      report.reasons.set('unparseable json', (report.reasons.get('unparseable json') ?? 0) + 1)
      parked.push(trimmed)
      continue
    }

    if (typeof obj.sessionId === 'string' && obj.sessionId.trim()) {
      report.already += 1
      keep.push(JSON.stringify(obj))
      continue
    }

    const resolved = resolveBlock(obj.chainId)
    if (!resolved.id) {
      report.moved += 1
      const short = resolved.reason.split('(')[0].trim()
      report.reasons.set(short, (report.reasons.get(short) ?? 0) + 1)
      parked.push(trimmed)
      continue
    }

    const { chainId, ...rest } = obj
    const projectId =
      (typeof rest.projectId === 'string' && rest.projectId) ||
      known.project.get(resolved.id) ||
      projectFromChainIdBlock(chainId)
    report.migrated += 1
    keep.push(JSON.stringify({ sessionId: resolved.id, projectId, ...rest }))
  }

  return { report, kept: keep, parked }
}

function listBlock(dir, ext) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter(f => f.endsWith(ext)).sort().map(f => path.join(dir, f))
}

/** Undertaking keys that exist today, per project — so a parked answer naming a
 *  key can be told apart from one minting a new address. */
function undertakingKeysBlock() {
  const byProject = new Map()
  const organizer = path.join(ACTIVITY, 'thinking-organizer')
  if (!fs.existsSync(organizer)) return byProject
  for (const project of fs.readdirSync(organizer)) {
    const dir = path.join(organizer, project, 'undertakings')
    if (!fs.existsSync(dir)) continue
    const keys = new Set()
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.md')) continue
      const m = /^key:\s*"?([^"\n]+?)"?\s*$/m.exec(fs.readFileSync(path.join(dir, file), 'utf8'))
      if (m) keys.add(m[1].trim())
    }
    byProject.set(project, keys)
  }
  return byProject
}

/**
 * Fold parked in-session answers into the proposal log.
 *
 * `undertakings` is plural — a session commonly feeds more than one strand — so
 * one parked answer becomes one proposal per key. The head rides on the first,
 * which is the primary undertaking the ask collected it for.
 *
 * A key naming nothing becomes a `new` target only if the answer carried a
 * `newTitle`, and only once: `newTitle` describes at most one minted key, so a
 * second unrecognised key on the same answer has no title of its own and is a
 * typo as far as anything here can tell. Minting an address from a typo is the
 * one move ASSIGNMENT.md forbids outright, so those are reported, not written.
 */
function migratePendingBlock() {
  const undertakings = undertakingKeysBlock()
  const files = listBlock(PENDING, '.json')
  const byProject = new Map()
  const report = { files: files.length, produced: 0, skipped: [] }

  for (const file of files) {
    const name = path.basename(file)
    let parkedAnswer
    try {
      parkedAnswer = JSON.parse(fs.readFileSync(file, 'utf8'))
    } catch {
      report.skipped.push({ file: name, reason: 'unreadable json' })
      continue
    }

    const sessionId = String(parkedAnswer.sessionId ?? '').trim()
    const keys = Array.isArray(parkedAnswer.undertakings)
      ? parkedAnswer.undertakings.map(k => String(k).trim()).filter(Boolean)
      : []
    if (!sessionId || !keys.length) {
      report.skipped.push({ file: name, reason: 'no sessionId or no undertakings' })
      continue
    }

    const projectId =
      String(parkedAnswer.projectId ?? '').trim() || known.project.get(sessionId) || ''
    if (!projectId) {
      report.skipped.push({ file: name, sessionId, reason: 'no project could be determined' })
      continue
    }

    const existing = undertakings.get(projectId) ?? new Set()
    const head = String(parkedAnswer.head ?? '').trim()
    const newTitle = String(parkedAnswer.newTitle ?? '').trim()
    const section = String(parkedAnswer.section ?? '').trim()
    let mintUsed = false

    keys.forEach((key, index) => {
      let target
      if (existing.has(key)) {
        target = { kind: 'existing', key }
      } else if (newTitle && !mintUsed) {
        mintUsed = true
        target = {
          kind: 'new',
          title: newTitle,
          ...(section ? { section } : {}),
          ...(head ? { head } : {}),
        }
      } else {
        report.skipped.push({
          file: name,
          sessionId,
          key,
          reason: newTitle
            ? 'second unrecognised key, and newTitle describes only one mint'
            : 'key names no undertaking and no newTitle — possible typo, not migrating',
        })
        return
      }

      const proposal = {
        sessionId,
        projectId,
        target,
        ...(index === 0 && head ? { head } : {}),
        confidence: 1,
        rationale: 'Answered in-session by the agent that did the work.',
        proposedBy: 'in-session',
        proposedAt: String(parkedAnswer.recordedAt ?? new Date().toISOString()),
      }
      const bucket = byProject.get(projectId)
      if (bucket) bucket.push(proposal)
      else byProject.set(projectId, [proposal])
      report.produced += 1
    })
  }
  return { byProject, report }
}

/**
 * Write, keeping the *pre-migration* file as `.bak`.
 *
 * First write wins: a project's proposal log is written twice — once when its
 * `chainId` lines are rekeyed, once when its parked in-session answers are
 * folded in — and re-copying on the second pass would back up the already
 * migrated file, leaving no way back to the original. The backup is only worth
 * having if it predates every change this script makes.
 */
/**
 * Undertaking records: rewrite `chains:` from chain ids to session ids.
 *
 * The third place the chainId -> sessionId rekey never reached disk, and the
 * one with a visible symptom: `chainsFor` matches these pointers against
 * *session ids* — its own comment says so — while every stored pointer was a
 * full chain id (`F9::native/claude/<slug>/<uuid>.jsonl#w1`). Nothing matched,
 * so all 32 F9 undertakings that had a trail rendered "0 sessions · 0 days"
 * with their sessions sitting right there on disk.
 *
 * An undertaking is keyed to a **session**, never to a chain and never to a
 * window. A chain is a grouping by time and can hold two unrelated topics; a
 * window is a property of how a transcript was cut up. Neither is what the work
 * was. So the window marker is dropped and the session root is written — the
 * reader matches at the root, so one pointer finds every window of that sitting.
 *
 * `fedBy` is migrated too, but only entry by entry. It is a mixed field: 321 of
 * its Thinking-Space entries and 29 of F9's are task keys (`TP-DA-T-995`) that
 * name the seam to the old organizer and must be left exactly as they are —
 * while 5 of F9's are chain ids that are session pointers wearing the wrong
 * clothes. Rewriting the field wholesale would corrupt the seam; skipping it
 * wholesale (which the first cut of this script did) leaves five real pointers
 * dead. So the shape of each entry decides, and anything that is not clearly a
 * chain id is passed through untouched.
 */
function sessionRootsOnDiskBlock() {
  const roots = new Set()
  for (const id of known.ids) roots.add(id.includes('::') ? id.slice(0, id.indexOf('::')) : id)
  return roots
}

function undertakingSessionIdBlock(pointer, roots) {
  const split = splitChainIdBlock(pointer)
  if (!split) return null
  // `splitChainIdBlock` already applies the `sessionIdOf` rules (bare uuid,
  // codex `rollout-*`, vault `<date>_<8hex>.md`) and strips `#wN`.
  return roots.has(split.base) ? split.base : null
}

/** Does this entry look like a chain id rather than a task key? Task keys have
 *  no path separators and no `::`; chain ids always have both a project prefix
 *  and a transcript path. Anything ambiguous is left alone. */
function looksLikeChainIdBlock(entry) {
  return entry.includes('::') && (entry.includes('/') || entry.includes('.jsonl'))
}

function migrateUndertakingsBlock() {
  const roots = sessionRootsOnDiskBlock()
  const organizer = path.join(ACTIVITY, 'thinking-organizer')
  const report = { files: 0, rewritten: 0, pointers: 0, migrated: 0, unresolved: [] }
  if (!fs.existsSync(organizer)) return report

  for (const project of fs.readdirSync(organizer)) {
    const dir = path.join(organizer, project, 'undertakings')
    if (!fs.existsSync(dir)) continue
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith('.md')) continue
      const full = path.join(dir, file)
      let text = fs.readFileSync(full, 'utf8')
      let touched = false
      let counted = false

      // `chains` is wholly session pointers; `fed_by` is mixed, so only the
      // entries shaped like chain ids are rewritten there.
      for (const field of ['chains', 'fed_by']) {
        const re = new RegExp(`^${field}:[ \\t]*$((?:\\r?\\n[ \\t]+-[ \\t]+.*)+)`, 'm')
        const match = re.exec(text)
        if (!match) continue
        if (!counted) {
          report.files += 1
          counted = true
        }

        const entries = [...match[1].matchAll(/-[ \t]+(.*)/g)].map(m => m[1].trim().replace(/^["']|["']$/g, ''))
        const next = []
        let changed = false
        for (const entry of entries) {
          if (!entry) continue
          const isPointer = field === 'chains' || looksLikeChainIdBlock(entry)
          if (!isPointer) {
            next.push(entry) // Task key. Not ours to touch.
            continue
          }
          report.pointers += 1
          // Already a session id: leave it, so a re-run is a no-op.
          if (!entry.includes('/') && !entry.includes('.jsonl') && !entry.includes('#w')) {
            next.push(entry)
            continue
          }
          const sessionId = undertakingSessionIdBlock(entry, roots)
          if (!sessionId) {
            report.unresolved.push({ file: `${project}/${file}`, field, pointer: entry.slice(0, 80) })
            next.push(entry) // Left alone rather than dropped — a pointer we cannot
            continue         // resolve is not a pointer we may delete.
          }
          report.migrated += 1
          changed = true
          if (!next.includes(sessionId)) next.push(sessionId)
        }
        if (!changed) continue

        const rendered = `${field}:\n${next.map(id => `  - "${id}"`).join('\n')}`
        text = text.slice(0, match.index) + rendered + text.slice(match.index + match[0].length)
        touched = true
      }

      if (!touched) continue
      report.rewritten += 1
      writeBlock(full, text)
    }
  }
  return report
}

function writeBlock(file, content) {
  if (!APPLY) return
  const backup = `${file}.bak`
  if (fs.existsSync(file) && !fs.existsSync(backup)) fs.copyFileSync(file, backup)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, content, 'utf8')
}

/** Sidecar for lines no reader can parse. `.txt`, deliberately: the verdict
 *  reader lists `*.jsonl` in this very directory, so anything ending `.jsonl`
 *  would be read straight back in. */
function parkFileBlock(file) {
  return `${file.replace(/\.jsonl$/, '')}.unmigrated.txt`
}

// ── run ────────────────────────────────────────────────────────────────────

console.log(`vault:  ${VAULT}`)
console.log(`mode:   ${APPLY ? 'APPLY (writes .bak, then rewrites)' : 'DRY RUN (no writes)'}`)
console.log(`digests known: ${known.ids.size}\n`)

const reports = []
for (const file of [...listBlock(PROPOSALS, '.jsonl'), ...listBlock(VERDICTS, '.jsonl')]) {
  const kind = file.startsWith(PROPOSALS) ? 'proposals' : 'verdicts'
  const { report, kept, parked } = migrateLogFileBlock(file, kind)
  reports.push(report)
  if (report.migrated === 0 && report.moved === 0) continue
  writeBlock(file, kept.length ? `${kept.join('\n')}\n` : '')
  if (parked.length) {
    const sidecar = parkFileBlock(file)
    const prior = fs.existsSync(sidecar) ? fs.readFileSync(sidecar, 'utf8') : ''
    const prefix = prior && !prior.endsWith('\n') ? `${prior}\n` : prior
    if (APPLY) fs.writeFileSync(sidecar, `${prefix}${parked.join('\n')}\n`, 'utf8')
  }
}

/** Identity of a folded-in answer, for the re-run check: the same session
 *  claiming the same target from the same source is the same claim. Compared on
 *  parsed fields rather than on substrings of the serialized line — key order
 *  and spacing are not part of the identity, and matching on text is how a
 *  "already migrated" check quietly stops matching. */
function foldKeyBlock(proposal) {
  const t = proposal.target
  const target = t.kind === 'existing' ? `existing:${t.key}` : t.kind === 'new' ? `new:${t.title.trim().toLowerCase()}` : 'bucket'
  return `${proposal.sessionId}|${proposal.proposedBy}|${target}`
}

const undertakings = migrateUndertakingsBlock()

const pending = migratePendingBlock()
let folded = 0
for (const [project, proposals] of pending.byProject) {
  const file = path.join(PROPOSALS, `${project.replace(/[^A-Za-z0-9._-]+/g, '-')}.jsonl`)
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''
  const seen = new Set()
  for (const line of existing.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const obj = JSON.parse(trimmed)
      if (obj.sessionId && obj.target) seen.add(foldKeyBlock(obj))
    } catch {
      // Unreadable lines cannot claim identity; they are parked separately.
    }
  }
  const fresh = proposals.filter(p => !seen.has(foldKeyBlock(p)))
  if (!fresh.length) continue
  folded += fresh.length
  const prefix = existing && !existing.endsWith('\n') ? `${existing}\n` : existing
  writeBlock(file, `${prefix}${fresh.map(p => JSON.stringify(p)).join('\n')}\n`)
}

for (const r of reports) {
  console.log(
    `${r.kind.padEnd(9)} ${path.basename(r.file).padEnd(22)} total=${String(r.total).padStart(4)} migrated=${String(r.migrated).padStart(4)} already=${r.already} parked=${r.moved}`,
  )
  for (const [reason, n] of r.reasons) console.log(`    ${n} × ${reason}`)
}

console.log(
  `\nundertakings  records with chains=${undertakings.files}  rewritten=${undertakings.rewritten}  pointers=${undertakings.pointers}  migrated=${undertakings.migrated}  unresolved=${undertakings.unresolved.length}`,
)
for (const u of undertakings.unresolved.slice(0, 6)) console.log(`    unresolved: ${JSON.stringify(u)}`)

console.log(`\npending  files=${pending.report.files}  proposals produced=${pending.report.produced}  newly written=${folded}`)
for (const s of pending.report.skipped) console.log(`    skipped: ${JSON.stringify(s)}`)

const migrated = reports.reduce((n, r) => n + r.migrated, 0)
const parked = reports.reduce((n, r) => n + r.moved, 0)
console.log(`\n${APPLY ? 'APPLIED' : 'DRY RUN'} — ${migrated} lines migrated, ${parked} parked in .unmigrated.txt sidecars, ${folded} in-session answers folded in.`)
if (!APPLY) console.log('Re-run with --apply to write.')
