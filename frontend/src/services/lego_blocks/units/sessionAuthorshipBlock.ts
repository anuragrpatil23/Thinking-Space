// Who authored a turn in a native AI transcript.
//
// Both session stores record a *stream of events*, not a list of messages, and
// duration is `last.ts - first.ts` over that stream. Neither store marks who
// caused an event, so the parser used to treat every `isUser` event as "the
// human was here" — which is false for a large fraction of them:
//
//   - Codex injects `<heartbeat>` user turns on a timer to drive automations
//     (`<automation_id>cdmdeid-delta-pull-monitor</automation_id>`). Its own
//     developer preamble says so: "It is not actually sent by the user, but by
//     the system on some interval of time."
//   - Claude Code injects `<task-notification>` when a background task lands.
//   - Claude Code files every tool_result as a `type: "user"` event. In this
//     vault that is 25,140 of ~31,000 user events — 81%.
//
// The cost of not knowing this was not cosmetic. An automation polling Airflow
// every ~10 minutes keeps each inter-event gap under `IDLE_GAP_MS`, so it
// *prevents* the idle split that would have ended the sitting, and the window
// runs on until the automation stops. Measured across both stores that put
// ~35 hours of phantom time on the timeline, with one project (MountSinaiGit)
// inflated 25-29% on each tool independently.
//
// The rule that falls out, and the reason this is one shared block rather than
// two per-source heuristics:
//
//   **Authorship changes only when someone speaks. Everything else inherits.**
//
// A tool result, a caveat, an `<environment_context>`, an `isMeta` preamble and
// an assistant turn are all *continuations* — they carry no authorship of their
// own and ride on whatever turn is in flight. Only a non-empty, non-system user
// body may set the mode. Getting this wrong is not a small error: a literal
// `else { mode = 'human' }` would reset authorship on every tool result, i.e.
// ~25,000 times, and silently re-credit every automated turn to the user.

/** Who caused a turn.
 *
 *  `agent` exists because it is neither of the other two. A Claude Code
 *  sidechain turn is written by the parent agent, so it is not typed by the
 *  human — but it is a subagent doing work the human delegated, and it must
 *  count. Classifying sidechains as continuations dropped 73 subagent-only
 *  transcripts (46 in `frontend`, 23 in `airms-datapilot`, 4 in `App`) as "100%
 *  automation" during development. `agent` and `human` behave identically for
 *  windowing and duration; the split exists so delegated work stays
 *  *attributable* without being *discardable*.
 *
 *  `delegated` is a session doing work that no human asked for *in this
 *  session*: another session messaged it (`<cross-session-message>`, an idle
 *  notice), or a launcher started it with a brief (`[spawned-by: …]` kickoff).
 *  It is real work and anchors windows like `human` does, but it is the
 *  *agents'* time, not the person's — see `actorOfAuthorBlock`. Learned
 *  2026-11-26, when coordinator sessions started spawning workers: every
 *  worker's kickoff is recorded as `origin: human, promptSource: typed`
 *  (the launcher types it into a terminal), and every later peer message is
 *  `isMeta`, so the whole worker inherited `human` and its hours were
 *  credited to the person. */
export type TurnAuthor = 'human' | 'agent' | 'delegated' | 'automation' | 'continuation'

/** Turn kinds that count as real work — they anchor windows and own duration. */
export function isWorkAuthorBlock(author: TurnAuthor): boolean {
  return author === 'human' || author === 'agent' || author === 'delegated'
}

/** Whose time a work turn is. `me` is the person (typed turns and the work
 *  they directly asked for, subagents included); `agent` is work some other
 *  session or launcher asked for. Windows never mix the two. */
export type ActivityActor = 'me' | 'agent'

export function actorOfAuthorBlock(author: TurnAuthor): ActivityActor {
  return author === 'delegated' ? 'agent' : 'me'
}

/** Codex heartbeat: a timer-driven turn carrying the automation that fired. */
const HEARTBEAT_RE = /^<heartbeat>/
/** Claude Code: the harness waking the agent when a background task lands. */
const TASK_NOTIFICATION_RE = /^<task-notification>/
/** Claude Code: another session's message, delivered into this one. The
 *  harness writes it as an `isMeta` user turn, which is why it must be
 *  recognised before the `isMeta` → continuation rule below. */
const PEER_MESSAGE_RE = /^(Another Claude session sent a message:\s*)?<cross-session-message\b/
/** Claude Code: harness notices about peer sessions (one went idle, a message
 *  was held or refused). They exist only because another session did
 *  something, so they wake this session on that session's behalf. */
const PEER_NOTICE_RE = /^\[Cross-session (idle|delivery) notice\]/
/** The kickoff tag a launcher puts on the first line of a spawned session's
 *  prompt: `[spawned-by: <parent> via <script>]`. A documented convention,
 *  not anyone's private one — any launcher can adopt it. */
export const SPAWNED_BY_TAG_RE = /^\[spawned-by:[^\]\n]*\]/

/** True when a turn is a background-task completion notice. */
export function isTaskNotificationBlock(body: string): boolean {
  return TASK_NOTIFICATION_RE.test(body.trim())
}

/**
 * Whether a session's first prompt marks it as spawned by a launcher rather
 * than typed by a person. The `[spawned-by:` tag always counts. `patterns` are
 * the user's own older launch phrasings (Settings → AI activity), matched as
 * case-insensitive prefixes of the trimmed prompt — they exist because
 * sessions launched before the tag convention carry no other marker: the
 * kickoff's transcript fields are identical to a typed prompt.
 */
export function isSpawnedKickoffBlock(body: string, patterns: readonly string[] = []): boolean {
  const text = body.trim()
  if (SPAWNED_BY_TAG_RE.test(text)) return true
  const lower = text.toLowerCase()
  return patterns.some(p => {
    const q = p.trim().toLowerCase()
    return q.length > 0 && lower.startsWith(q)
  })
}

/** System-injected user turns. Machine-authored, but they say nothing about who
 *  is driving — so they inherit rather than reset. `<environment_context>` is
 *  the one that bites: Codex emits it at session start and at date rollover,
 *  shaped exactly like a user message. There is one sitting in the 10:04pm
 *  MountSinaiGit window immediately after a genuine human turn; treating it as
 *  human would flip the mode back at midnight and credit ten subsequent
 *  heartbeat responses to the user. */
const SYSTEM_PREFIXES = [
  '<environment_context>',
  '<local-command-caveat>',
  '<local-command-stdout>',
  '<command-name>',
  '<command-message>',
  '<user-instructions>',
  '<system-reminder>',
  'Caveat: The messages below were generated by the user while running local commands',
  'You are writing a git commit message',
  'Base directory for this skill:',
]

/** Flags the transcript carries about a user event, when its format has them.
 *  Claude Code writes all three; Codex writes none. */
export interface TurnFlags {
  /** Claude Code `isSidechain` — the turn belongs to a subagent transcript. */
  isSidechain?: boolean
  /** Claude Code `isMeta` — harness-injected (caveats, skill preambles, image
   *  refs). Never typed by the user. */
  isMeta?: boolean
  /** Claude Code `turnOrigin` (newer builds): `human`, `system`, `scheduled`,
   *  `task_notification`. Only `scheduled` is read — a timer-fired prompt is
   *  shaped exactly like a typed one otherwise. */
  turnOrigin?: string
  /** Claude Code `isCompactSummary` — the summary the harness writes after a
   *  compaction. Machine prose, so it inherits whoever was driving. */
  isCompactSummary?: boolean
  /** Set by the parser on the session's first prompt when that prompt marks the
   *  session as launcher-spawned (`isSpawnedKickoffBlock`). */
  spawnedKickoff?: boolean
}

/**
 * Classify one user event. `body` must already be flattened to plain text with
 * tool_result / image / reasoning blocks dropped — an empty body therefore
 * means "this event carried no speech", which is exactly the continuation case.
 */
export function classifyUserTurnBlock(body: string, flags: TurnFlags = {}): TurnAuthor {
  const text = body.trim()

  // Order matters. An automation trigger inside a sidechain is still automation,
  // and a heartbeat is still a heartbeat whatever flags ride along with it.
  if (HEARTBEAT_RE.test(text) || TASK_NOTIFICATION_RE.test(text)) return 'automation'

  // No speech → no authorship. This is the tool_result case (81% of Claude Code
  // user events) and it MUST come before any human default.
  if (!text) return 'continuation'

  // A timer firing a stored prompt. Its body is ordinary prose, so only the
  // origin flag can tell it from typing.
  if (flags.turnOrigin === 'scheduled') return 'automation'

  // Another session speaking. Before the isMeta rule: the harness marks these
  // isMeta, and as continuations they would let the person keep the credit
  // for work a peer asked for — the 45-minutes-after-you-left case.
  if (PEER_MESSAGE_RE.test(text) || PEER_NOTICE_RE.test(text)) return 'delegated'

  if (flags.isMeta || flags.isCompactSummary) return 'continuation'
  for (const p of SYSTEM_PREFIXES) {
    if (text.startsWith(p)) return 'continuation'
  }

  if (flags.spawnedKickoff) return 'delegated'

  // Delegated work. Checked after the system prefixes so a subagent's own
  // caveats don't register as agent speech.
  if (flags.isSidechain) return 'agent'

  // `[Request interrupted by user]` deliberately lands here: the harness wrote
  // the text, but a human pressing escape is a human being present, and it is
  // the only record that they were.
  return 'human'
}

/** The automation that fired a heartbeat, when the turn names one. Kept so a
 *  surviving session can report *which* automation was running rather than
 *  making the wake invisible — the Derivation contract's "absence is not
 *  evidence" applies to a row we chose not to draw just as much as to a value
 *  we failed to measure. */
export function extractAutomationIdBlock(body: string): string | undefined {
  const m = /<automation_id>\s*([^<\s][^<]*?)\s*<\/automation_id>/.exec(body)
  return m ? m[1] : undefined
}

/**
 * Resolve authorship across a time-ordered event stream.
 *
 * The state machine is the whole idea: walk events in order, let a speaking
 * user turn set the mode, and have everything else inherit it. An assistant
 * event cannot be classified on its own — the same model does the same work
 * whether a human or a cron asked — so its only available signal is what
 * preceded it. Inheritance is not a shortcut here; it is the only sound method.
 *
 * Mutates `events` in place and returns them for chaining.
 */
export function resolveAuthorshipBlock<
  T extends { isUser: boolean; body: string; flags?: TurnFlags; author?: TurnAuthor },
>(events: T[]): T[] {
  // A transcript that opens mid-automation is vanishingly rare, but 'human' is
  // the safer default: it over-counts rather than silently deleting work.
  let mode: TurnAuthor = 'human'
  for (const e of events) {
    if (e.isUser) {
      let author = classifyUserTurnBlock(e.body, e.flags)
      if (mode === 'delegated') {
        // Inside agent-driven work, two signals stay the agent's:
        //  - a background task the agent itself started finishing. For a
        //    person's session the contract keeps this as automation (it must
        //    not hold a sitting open), but a worker has no person to wait for —
        //    landing its own job and acting on it IS its work.
        //  - a subagent's turn: delegated work delegated further.
        // Neither can occur in a session without a `delegated` turn, so the
        // person's own accounting is untouched by this branch.
        if (author === 'automation' && isTaskNotificationBlock(e.body)) author = 'delegated'
        else if (author === 'agent') author = 'delegated'
      }
      if (author !== 'continuation') mode = author
      e.author = author === 'continuation' ? mode : author
    } else {
      e.author = mode
    }
  }
  return events
}
