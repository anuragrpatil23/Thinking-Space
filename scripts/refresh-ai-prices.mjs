#!/usr/bin/env node
// Refresh `frontend/src/data/aiModelPrices.json` against LiteLLM's public
// price feed — the de-facto community table for per-token rates across
// Anthropic, OpenAI and others.
//
// THIS IS A MANUAL/PERIODIC TOOL, NOT A RUNTIME DEPENDENCY. The app never
// fetches prices; it reads the committed JSON. Locked decision #5 is that core
// features need no backend, and a cost column that goes blank on a plane would
// break that. So: a human runs this, reads the diff, and commits it.
//
//   node scripts/refresh-ai-prices.mjs            # report drift, write nothing
//   node scripts/refresh-ai-prices.mjs --check    # report drift, exit 1 on drift
//   node scripts/refresh-ai-prices.mjs --write    # apply and stamp provenance
//   node scripts/refresh-ai-prices.mjs --build    # `prebuild`: apply, tolerate offline
//
// `--build` is `--write` made safe to sit in front of every build:
//   - offline is "cannot tell", not "drifted" — it warns and passes, so a build
//     on a plane still works off the committed table;
//   - rules carrying `feed_disagreement` are never touched, so a considered
//     position against upstream survives an auto-apply;
//   - ambiguous rules (one pattern spanning several real tiers) are reported
//     but not guessed at.
// It DOES rewrite a tracked file during the build. That is the trade for never
// shipping a stale rate: expect `aiModelPrices.json` to show up dirty after a
// build when upstream moved, and commit it like a refreshed lockfile.
// PRICES_CHECK=off skips the whole step.
//
// What it does NOT do is invent rules. Our table maps *regex patterns* to
// tiers; LiteLLM maps *exact model ids* to rates. Inventing a pattern from an
// id is how the original bug happened (a pattern that silently stopped
// matching), so this script only ever re-prices patterns that already exist,
// by probing them against ids LiteLLM knows. A model nothing matches is
// reported as unpriced-and-unknown for a human to add deliberately.

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const FEED =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json'

const here = dirname(fileURLToPath(import.meta.url))
const TABLE_PATH = join(here, '..', 'frontend', 'src', 'data', 'aiModelPrices.json')

const write = process.argv.includes('--write') || process.argv.includes('--build')
const build = process.argv.includes('--build')
const check = process.argv.includes('--check') || build

/** LiteLLM quotes per-token; we store per-million. */
const perMillion = (n) => (typeof n === 'number' ? Number((n * 1_000_000).toFixed(6)) : undefined)

/** Map one LiteLLM entry onto our bucket shape. Returns null when the entry
 *  carries no usable input/output pair. */
function toRate(v, id) {
  // Cache-write pricing is provider-specific and mostly absent from the feed,
  // so the fallback has to know who it is guessing for. Anthropic charges a
  // premium to write (1.25x input at 5m TTL, 2x at 1h); OpenAI does not charge
  // for writes at all — a write bills as ordinary input. Applying Anthropic's
  // multipliers to a GPT model invents a cost that does not exist.
  const anthropic = /claude|fable|mythos/i.test(id)
  const input = perMillion(v.input_cost_per_token)
  const output = perMillion(v.output_cost_per_token)
  if (input === undefined || output === undefined) return null
  // Anthropic splits cache creation by TTL; LiteLLM exposes the 5m figure as
  // `cache_creation_input_token_cost`. Fall back to the provider conventions we
  // already document when a field is absent.
  const cacheRead = perMillion(v.cache_read_input_token_cost) ?? Number((input * 0.1).toFixed(6))
  const cacheCreation5m =
    perMillion(v.cache_creation_input_token_cost) ??
    Number((anthropic ? input * 1.25 : input).toFixed(6))
  const cacheCreation1h =
    perMillion(v.cache_creation_input_token_cost_above_1hr) ??
    Number((anthropic ? input * 2 : input).toFixed(6))
  return { input, output, cacheRead, cacheCreation5m, cacheCreation1h }
}

const money = (n) => `$${Number(n).toFixed(2)}`

async function main() {
  const table = JSON.parse(readFileSync(TABLE_PATH, 'utf8'))

  let feed
  try {
    const res = await fetch(FEED, { redirect: 'follow' })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    feed = await res.json()
  } catch (err) {
    // Offline is "cannot tell", not "drifted". As a build gate that has to pass
    // on a plane, say so and get out of the way; as a manual run, it is a
    // failure the human asked for.
    if (check) {
      console.warn(`\n⚠ Skipping price drift check — feed unreachable (${err.message}).`)
      console.warn('  The committed table is used as-is.\n')
      process.exit(0)
    }
    console.error(`\n✗ Could not fetch the LiteLLM feed: ${err.message}`)
    console.error('  The committed table is unchanged. Re-run when online.\n')
    process.exit(1)
  }

  const all = Object.entries(feed).filter(([k]) => k !== 'sample_spec')

  // Only first-party ids. LiteLLM also carries resold/regional variants —
  // `us.anthropic.claude-opus-4-6` (Bedrock region, +10%), `databricks/…`,
  // `openrouter/…`, `azure_ai/…` — which are the same model at a reseller's
  // markup. Our transcripts never contain those, and mixing them in makes
  // every rule look like it spans several price tiers when it does not.
  // Excluded: anything with a `/`, and anything carrying a `vendor.` prefix.
  const entries = all.filter(([id]) => !id.includes('/') && !/^[a-z_-]+\./i.test(id))
  console.log(
    `Fetched ${all.length} model entries from LiteLLM; ` +
      `${entries.length} are first-party ids (resold/regional variants ignored).\n`,
  )

  // ── exact map ───────────────────────────────────────────────────────────
  // Regenerated wholesale each run. This is the tier that makes pattern drift
  // survivable: an id the feed knows is priced by name, and never depends on a
  // regex continuing to match it. Ids under `overrides` are skipped — a
  // considered disagreement must not be silently reverted by a refresh.
  const overrides = table.overrides ?? {}
  const nextExact = {}
  for (const [id, v] of entries) {
    if (!/claude|fable|mythos|^gpt-|^o\d/i.test(id)) continue
    if (Object.prototype.hasOwnProperty.call(overrides, id)) continue
    const rate = toRate(v, id)
    if (rate) nextExact[id] = rate
  }
  const prevExact = table.exact ?? {}
  const exactAdded = Object.keys(nextExact).filter((k) => !(k in prevExact))
  const exactChanged = Object.keys(nextExact).filter(
    (k) => k in prevExact && JSON.stringify(prevExact[k]) !== JSON.stringify(nextExact[k]),
  )
  const exactDropped = Object.keys(prevExact).filter((k) => !(k in nextExact))

  // Resolve each id the way the app does — FIRST matching rule wins — before
  // grouping. Testing each rule against every id independently ignores
  // precedence and invents conflicts: `^o4-mini` looks like it spans two price
  // tiers only if you forget that `^o4-mini-deep-research` sits above it and
  // takes those ids first. The check has to model the lookup, not the patterns.
  const compiled = table.patterns.map((rule) => ({ rule, re: new RegExp(rule.match, 'i') }))
  const claimedBy = new Map(table.patterns.map((rule) => [rule, []]))
  for (const entry of entries) {
    const winner = compiled.find(({ re }) => re.test(entry[0]))
    if (winner) claimedBy.get(winner.rule).push(entry)
  }


  const changes = []
  for (const rule of table.patterns) {
    // Every id this rule actually wins. If it wins nothing, that is itself the
    // finding — the rule has gone stale, or a rule above it now shadows it.
    const matched = claimedBy.get(rule)
    if (matched.length === 0) {
      changes.push({ rule, kind: 'unmatched' })
      continue
    }
    // Several ids can share a tier (dated snapshots, provider prefixes). Only
    // act when they agree; disagreement means our one pattern is spanning two
    // real price tiers and a human has to split it.
    // Patterns are the LAST tier: an id settled by `overrides` or `exact` never
    // reaches them, so it cannot tell us anything about whether this pattern's
    // numbers are right — and judging by ids the pattern will never see invents
    // conflicts (it made `sonnet` look like it spanned two tiers when
    // claude-sonnet-5 is settled by an override). Judge on the remainder only.
    const judged = matched.filter(([id]) => !(id in overrides) && !(id in nextExact))
    if (judged.length === 0) {
      // Fully shadowed by the earlier tiers. That is the normal, healthy state
      // for a fallback rule — it exists for ids the feed has never heard of,
      // like dated snapshots. Nothing to verify, nothing to report.
      continue
    }
    const priced = judged.map(([id, v]) => [id, toRate(v, id)]).filter(([, r]) => r)
    if (priced.length === 0) {
      changes.push({ rule, kind: 'unmatched' })
      continue
    }
    const distinct = new Map()
    for (const [id, r] of priced) {
      const key = `${r.input}/${r.output}/${r.cacheRead}/${r.cacheCreation5m}/${r.cacheCreation1h}`
      if (!distinct.has(key)) distinct.set(key, { rate: r, ids: [] })
      distinct.get(key).ids.push(id)
    }
    if (distinct.size > 1) {
      if (rule.feed_disagreement) {
        changes.push({ rule, kind: 'held' })
        continue
      }
      changes.push({ rule, kind: 'ambiguous', groups: [...distinct.values()] })
      continue
    }
    // A rule can record that we have looked at the feed's number and chosen to
    // differ (`feed_disagreement`). Those are never auto-applied and never
    // block a build — otherwise the only way to hold a considered position
    // against upstream is to disable the check entirely.
    if (rule.feed_disagreement) {
      changes.push({ rule, kind: 'held' })
      continue
    }
    const { rate, ids } = [...distinct.values()][0]
    const differs = ['input', 'output', 'cacheRead', 'cacheCreation5m', 'cacheCreation1h'].filter(
      (k) => Math.abs(rule[k] - rate[k]) > 1e-9,
    )
    if (differs.length > 0 || rule.assumed) {
      changes.push({ rule, kind: 'update', rate, ids, differs })
    }
  }

  // Models LiteLLM prices that no rule of ours claims — candidates to add.
  const uncovered = entries
    .map(([id]) => id)
    .filter((id) => /claude|gpt-5|^o[34]/i.test(id))
    .filter((id) => !(id in nextExact) && !(id in overrides))
    .filter((id) => !table.patterns.some((r) => new RegExp(r.match, 'i').test(id)))

  const exactDrift = exactAdded.length + exactChanged.length + exactDropped.length
  if (exactDrift > 0) {
    console.log(
      `exact map: ${exactAdded.length} added, ${exactChanged.length} changed, ` +
        `${exactDropped.length} dropped (${Object.keys(nextExact).length} ids total)`,
    )
    if (exactAdded.length) console.log(`    + ${exactAdded.slice(0, 6).join(', ')}`)
    if (exactChanged.length) console.log(`    ~ ${exactChanged.slice(0, 6).join(', ')}`)
    console.log()
  }

  if (changes.length === 0 && uncovered.length === 0 && exactDrift === 0) {
    console.log('✓ Table is current — no drift against the feed.\n')
    return
  }

  for (const c of changes) {
    if (c.kind === 'held') {
      console.log(`· ${c.rule.label} — holding our own number on purpose.`)
      console.log(`    ${c.rule.feed_disagreement}\n`)
    } else if (c.kind === 'unmatched') {
      console.log(`⚠ ${c.rule.label}\n    pattern /${c.rule.match}/ matches nothing in the feed.`)
      console.log('    Either the ids changed shape or the tier is retired — check by hand.\n')
    } else if (c.kind === 'ambiguous') {
      console.log(`⚠ ${c.rule.label}\n    pattern /${c.rule.match}/ spans ${c.groups.length} price tiers:`)
      for (const g of c.groups) {
        console.log(`      ${money(g.rate.input)}/${money(g.rate.output)}  ${g.ids.slice(0, 4).join(', ')}`)
      }
      console.log('    Split the rule before this can be refreshed automatically.\n')
    } else {
      console.log(`~ ${c.rule.label}`)
      for (const k of c.differs) console.log(`    ${k}: ${money(c.rule[k])} -> ${money(c.rate[k])}`)
      if (c.rule.assumed) console.log('    assumed -> published')
      console.log(`    per: ${c.ids.slice(0, 4).join(', ')}\n`)
    }
  }

  if (uncovered.length > 0) {
    console.log(`⚠ ${uncovered.length} priced model(s) match no rule and would render "unpriced":`)
    for (const id of uncovered.slice(0, 20)) console.log(`    ${id}`)
    if (uncovered.length > 20) console.log(`    …and ${uncovered.length - 20} more`)
    console.log('    Add rules deliberately — do not widen an existing pattern to swallow them.\n')
  }

  const applicable = changes.filter((c) => c.kind === 'update')

  // Build gate. Only a genuine number disagreement fails: an "ambiguous" or
  // "uncovered" finding means a human should widen the table, but it does not
  // make any figure we already render wrong, and failing every build on a new
  // upstream model id would just train people to disable the check.
  if (check && !build) {
    if (applicable.length === 0) {
      console.log('✓ No price drift. (Warnings above, if any, need a human but block nothing.)\n')
      process.exit(0)
    }
    console.error(`✗ ${applicable.length} rule(s) disagree with the feed — cost figures are stale.`)
    console.error('  Review and apply:  node scripts/refresh-ai-prices.mjs --write')
    console.error('  Skip in a pinch:   PRICES_CHECK=off npm run build\n')
    process.exit(1)
  }
  if (build && applicable.length === 0 && exactDrift === 0) {
    console.log('✓ Prices current — nothing to apply.\n')
    process.exit(0)
  }

  if (!write) {
    console.log(
      `Dry run. ${applicable.length} pattern(s) and ${exactDrift} exact id(s) would change. ` +
        'Re-run with --write.\n',
    )
    return
  }
  if (applicable.length === 0 && exactDrift === 0) {
    console.log('Nothing safely applicable — the findings above need a human.\n')
    return
  }

  const today = new Date().toISOString().slice(0, 10)
  for (const c of applicable) {
    Object.assign(c.rule, c.rate)
    c.rule.assumed = false
    c.rule.source = `LiteLLM model_prices_and_context_window.json (refreshed ${today})`
  }
  table.exact = nextExact
  table.refreshed_at = today
  writeFileSync(TABLE_PATH, `${JSON.stringify(table, null, 2)}\n`)
  console.log(
    `✓ Updated ${applicable.length} pattern(s) and ${Object.keys(nextExact).length} exact id(s) ` +
      `in ${TABLE_PATH}`,
  )
  console.log('  Review the diff before committing — these are other people\'s numbers.\n')
}

main()
