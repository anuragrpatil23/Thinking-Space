import { defineContractBlock, type ContractOutput } from '../promptContractBlock'
import { s } from '../schemaBlock'

// Month-tier narrator with day-list anchoring. Given themes that group a
// month's chains (clustered upstream by rangeLabelContract + deterministic
// bucketing), emit one bullet per theme with the actual days-of-month the
// theme touched inline — because "4 days (23, 25, 28, 30)" is a memory
// anchor a raw date span like "across Aug 23 → Aug 30" can't match.
//
// The model never touches the days list or duration — both are computed
// deterministically upstream and copied verbatim. Only the trailing
// narration is model-authored, and it must draw only from the source
// material passed alongside the theme (per-session summaries + the
// containing week bodies).

export interface MonthThemeInput {
  themeLabel: string
  /** Day-of-month numbers the theme touched, deduped and sorted ascending. */
  days: number[]
  /** Human total duration inside the theme — "5h 20m". */
  duration: string
  /** Number of chains (sessions) in the theme. */
  chainCount: number
  /** Per-chain source material — title + digest summary + date. Ordered by
   *  duration descending so the narrator sees the most substantial work
   *  first. */
  sessions: Array<{
    title: string
    date: string
    durationLabel: string
    summary: string
  }>
  /** Week-tier bodies that overlap with the theme's days. Used as extra
   *  context material for the narrator when a session summary alone is
   *  thin. Empty when no week summary was produced for that week. */
  relatedWeekBodies: string[]
}

export interface MonthThemeComposeContractInput {
  projectId: string
  projectLabel?: string
  monthStartDate: string
  monthEndDate: string
  /** Human month label — "August 2026". Used only for the header line. */
  monthLabel: string
  totalChains: number
  totalDuration: string
  uniqueDays: number
  themes: MonthThemeInput[]
  /** Chains that didn't earn their own theme bullet, rolled into a single
   *  "Also worked on" tail. Each entry is a compact (title, date, duration)
   *  triple — no narration expected. */
  misc: Array<{ title: string; date: string; duration: string }>
}

export interface MonthThemeComposeOutput {
  body: string
}

const MAX_BODY_CHARS = 7000

const SYSTEM_PROMPT = [
  'You narrate a month at the THEME level. Themes are pre-clustered — do',
  'not re-group, split, or merge them. For each theme you receive:',
  '',
  '  theme_label   → copy verbatim into `**...**` at the start',
  '  days_line     → copy verbatim (e.g. `4 days (23, 25, 28, 30)`)',
  '  duration      → copy verbatim inside `**~...**`',
  '  Sessions      → source material for the narration sentence',
  '  Week bodies   → additional source material (optional)',
  '',
  'COUNT INVARIANT — the single most important rule:',
  '  - You will receive exactly N THEMEs. Emit exactly N bullets, plus',
  '    ONE additional MISC bullet iff a MISC block is present.',
  '  - N is given verbatim as "Expected output: N bullets" in the user',
  '    message. Match it. If N=1, output 1 bullet (or 2 with MISC).',
  '  - NEVER invent an extra bullet to "match a template". The template',
  '    below is a per-item shape, not a sample count.',
  '',
  'TEMPLATE — apply this shape to EACH THEME you receive:',
  '',
  '  <index>. **{theme_label}** — {days_line}, **~{duration}**.',
  '     {ONE OR TWO SENTENCES drawing ONLY from the Sessions block and',
  '      Week bodies. Name concrete files, features, companies, decisions.',
  '      Work-voice — "Landed X", "Fixed Y", "Named Z".}',
  '',
  'Number sequentially starting at 1. Bullet 1 = THEME 1. Bullet 2 =',
  'THEME 2. Etc.',
  '',
  'MISC (append only if a MISC block is present):',
  '',
  '  <next-index>. **Also worked on:** {short comma-separated list of MISC items.}',
  '',
  'HARD RULES:',
  '  - Copy theme_label, days_line, duration VERBATIM. Never paraphrase',
  '    the days list or turn "4 days (23, 25, 28, 30)" into a span like',
  '    "across Aug 23 → Aug 30" — the discrete list IS the point.',
  '  - Preserve theme order.',
  '  - Narration for theme N draws ONLY from theme N\'s source material.',
  '  - Never "the user" / "the assistant" / "you". Work-voice only.',
  '  - NO preamble. NO trailing notes. NO markdown headings or code fences.',
  '    Just the numbered bullets.',
].join('\n')

function formatDaysLine(days: number[]): string {
  if (days.length === 0) return '0 days'
  if (days.length === 1) return `1 day (${days[0]})`
  return `${days.length} days (${days.join(', ')})`
}

function buildUserPromptBlock(input: MonthThemeComposeContractInput): string {
  const parts: string[] = []
  const expectedBullets = input.themes.length + (input.misc.length > 0 ? 1 : 0)
  parts.push(`Project: ${input.projectLabel?.trim() || input.projectId}`)
  parts.push(
    `Month: ${input.monthLabel} · ${input.uniqueDays} day${input.uniqueDays === 1 ? '' : 's'} with activity · ${input.totalChains} chains · ~${input.totalDuration} total`,
  )
  parts.push(
    `Expected output: ${expectedBullets} bullet${expectedBullets === 1 ? '' : 's'} — ` +
      `one per THEME (${input.themes.length})` +
      (input.misc.length > 0 ? ` + one MISC bullet.` : `. NO MISC block present, do NOT emit a MISC bullet.`),
  )
  parts.push('')

  input.themes.forEach((theme, i) => {
    parts.push('---')
    parts.push(`THEME ${i + 1}`)
    parts.push(`theme_label: ${theme.themeLabel}`)
    parts.push(`days_line: ${formatDaysLine(theme.days)}`)
    parts.push(`duration: ${theme.duration}`)
    parts.push('')
    parts.push('Sessions in this theme:')
    theme.sessions.forEach((s, j) => {
      parts.push(`  ${j + 1}. ${s.title} (${s.date}, ${s.durationLabel})`)
      if (s.summary?.trim()) {
        for (const line of s.summary.trim().split('\n')) parts.push(`     ${line}`)
      }
    })
    if (theme.relatedWeekBodies.length > 0) {
      parts.push('')
      parts.push('Related week bodies:')
      theme.relatedWeekBodies.forEach((body, k) => {
        parts.push(`  Week ${k + 1}:`)
        for (const line of body.split('\n')) parts.push(`    ${line}`)
      })
    }
    parts.push('')
  })

  if (input.misc.length > 0) {
    parts.push('---')
    parts.push('MISC (goes into the "Also worked on" bullet)')
    for (const m of input.misc) {
      parts.push(`  - ${m.title} (${m.date}, ${m.duration})`)
    }
    parts.push('')
  }

  parts.push('---')
  parts.push('OUTPUT:')
  return parts.join('\n')
}

function truncateAtWord(value: string, max: number): string {
  if (value.length <= max) return value
  const cut = value.slice(0, max)
  const lastSpace = cut.lastIndexOf(' ')
  const base = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut
  return `${base.trimEnd()}…`
}

function sanitizeBody(raw: string): string {
  const stripped = raw.replace(/^```(?:markdown|md)?\s*/i, '').replace(/```\s*$/i, '').trim()
  const lines = stripped.split('\n')
  let firstBullet = -1
  for (let i = 0; i < lines.length; i += 1) {
    if (/^\s*1\.\s/.test(lines[i])) { firstBullet = i; break }
  }
  const body = firstBullet >= 0 ? lines.slice(firstBullet).join('\n') : stripped
  return truncateAtWord(body.replace(/\n{3,}/g, '\n\n').trim(), MAX_BODY_CHARS)
}

export const MONTH_THEME_COMPOSE_PROMPT_VERSION = 2

export const monthThemeComposeContract = defineContractBlock({
  id: 'range-summary-month-theme-compose',
  promptVersion: MONTH_THEME_COMPOSE_PROMPT_VERSION,
  outputSchema: s.string({ description: 'Numbered-bullet month theme body' }),
  buildRequest: (input: MonthThemeComposeContractInput) => ({
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user' as const, content: buildUserPromptBlock(input) }],
    // A busy month can carry 5–7 themes with 1–2 sentence narrations each;
    // week bodies push prompt size up. Bump the floor so nothing clips.
    temperature: 0.2,
  }),
  finalize: (raw: string, _input: MonthThemeComposeContractInput): ContractOutput<MonthThemeComposeOutput> | null => {
    const body = sanitizeBody(raw)
    if (!body) return null
    return { value: { body }, meta: {} }
  },
  cacheKey: (input: MonthThemeComposeContractInput) => {
    const themeKey = input.themes
      .map(t => `${t.themeLabel}:${t.days.join(',')}:${t.duration}`)
      .join('|')
    return `${input.projectId}#month-theme#${input.monthStartDate}#${input.monthEndDate}#${themeKey}`
  },
})
