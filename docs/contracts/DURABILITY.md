# Durability Contract (Enforced, written 2026-08-22)

Typed text is the one thing in this app a user cannot regenerate. AI writes most
of what passes through Thinking Space; when a human has explicitly chosen to
*write*, those characters are the highest-value bytes in the product. Losing one
is worse than any crash, any stale cache, any missed sync.

Two rules, and everything below is machinery serving them:

> **1. The editor buffer is never the only copy of typed text — in any save mode.**
>
> **2. A write never truncates the previous version of a file.**

## Rule 2 first: writes must be atomic

`vault:write` truncated before writing (`frontend/electron/src/index.ts`, the
`fsPromises.writeFile` form). `writeFile` opens with `O_TRUNC`, so a crash inside
that window does not cost you the newest keystrokes — it costs **the entire
note**, including paragraphs that were safely on disk for an hour. Auto-save
fires every 1200ms, so the app sat inside that window continuously.

The inversion that makes this memorable: 500 lines up in the same file, the
Excalidraw plugin installer already wrote tmp-then-rename. **A disposable
downloaded asset had crash-safe writes and the user's notes did not.**

**Measured 2026-08-22**, a 60MB replacement with a separate process spinning on
`statSync` throughout:

| Path | Observations | Truncated | Smallest seen |
|---|---|---|---|
| `fsPromises.writeFile` (old) | 2,338,934 | 5,428 | **0 bytes** |
| `atomicWriteFileBlock` | 2,371,069 | 0 | — |

"Smallest seen: 0" is the whole finding — the file was observable as completely
empty. Any crash sampled in that window would have taken the note with it.

**FIXED 2026-08-22** — `lego_blocks/atomicWriteBlock.ts`, wired into
`vault:write`, `vault:writeBytesBase64`, and the community-plugins write.
Regression test is `frontend/tests/atomicWriteBlock.test.ts`; its mid-write case
uses a **worker thread** reader, because an async loop on the test's own thread
gets scheduled exactly once and passes vacuously. Verified against the old code
before landing: `bad: 2219, minSeen: 0`.

- Write to a dot-prefixed temp in the **same directory** (rename is only atomic
  within a filesystem), then rename over the target.
- **`fsync` the temp before renaming.** Without it the rename can land before
  the bytes do, and a power loss leaves a correctly-named partial file — exactly
  the failure atomicity was meant to remove. `fsync` the directory too, so the
  rename itself is durable; best-effort, since not every filesystem allows it.
- **Preserve the target's mode**, and **write through symlinks** rather than
  replacing them. `writeFile` did both; rename does neither unless asked. A
  vault with a symlinked folder would otherwise be silently detached on save.
- Sweep stale temps **per directory, on first write into it** — not as a
  startup walk. A full sweep is a 20k-file walk to find nothing in the normal
  case; the realistic case is that the app died writing today's note and the
  next thing you do is write today's note again.
- Every backend needs its own answer — Electron via `fs.rename`, Capacitor via
  its `rename`, OPFS separately. Electron is where writing happens and ships first.

## Rule 1: the durability ladder

**Auto-save controls publication. The journal controls durability.** These were
conflated: turning auto-save off removed the *only* protection typed text had,
which meant the setting a careful writer is most likely to enable was the one
that made loss certain. Nothing in the journal path may be gated on
`autoSaveEnabled`.

Two tiers, because the two failure modes have different survivors:

| Tier | Store | Cadence | Survives |
|---|---|---|---|
| Hot | `localStorage` | ~250ms, synchronous | Crash, force-quit |
| Durable | vault file under `.thinking-space/drafts/` | ~2s idle or every N chars | App reinstall, machine migration, app never booting again |

Tier 1 is synchronous on purpose: `pagehide` and `beforeunload` do not reliably
await async work, so it is the only store that can be flushed on the way out.

Tier 2 lives **in the vault** because the vault is the only store that outlives
the app. `localStorage` dies with an iOS reinstall (sandbox wipe) and with an
Electron userData reset — and userData is not sacred here, it has already been
renamed once (see the one-shot migration in `electron/src/index.ts`).

**Tier 2 is plain markdown at a predictable path**, with a small YAML header
naming the intended target and recording provenance. Not JSON, not a blob.

> Recovery must never depend on the software that crashed.

If the app is dead, the draft opens in TextEdit or Obsidian.

## The transition chokepoint

Every path that clears or replaces `content` — project pick, Explorer pick,
recent pick, note-kind change, New note, unmount — routes through one function.
It requires **durability, not publication**: flush both journal tiers, and only
then transition. In manual mode this must not write the note file.

**If the flush fails, the transition is cancelled — not the text.**

Every one of these paths previously cleared optimistically. Live bugs this
closes, all reachable in the shipped app as of 2026-08-22:

- Switching note kind to To Do ran `setContent('')` unconditionally in the
  destination-load effect. Prose typed before the switch was destroyed outright.
- `startNewNote` cleared the buffer without checking whether it was ever written.
- A failed auto-save never retried: the effect only re-fires on `content`
  change, so stopping after a failure left text unsaved with an error string.
- No `beforeunload`, `pagehide`, or unmount flush existed anywhere in the composer.

**FIXED 2026-08-22**, ahead of the chokepoint itself, since all four destroy
text in the shipped app:

- Note kind now **stashes both documents** instead of clearing. Todo mode reuses
  the one editor buffer for a different document (one task per line), so the
  swap is symmetric and flipping back returns exactly what you had. A toggle
  must not be destructive.
- `startNewNote` saves first and **aborts the clear if the save fails**, saying
  so. The transition loses, never the text.
- Failed saves retry with backoff (`saveRetryDelayBlock`, 2s doubling to a 30s
  ceiling). Not gated on `autoSaveEnabled` — it only ever retries an attempt
  that already happened, so in manual mode it finishes the save the user asked
  for rather than starting one they didn't. Never in todo mode: `todos.create`
  appends, so retrying a partial success would duplicate tasks.
- Teardown flushes on unmount, `beforeunload`, and `pagehide`. Unmount is the
  reliable half; the window events are best-effort, which is precisely why the
  journal exists rather than this being the whole answer.

The decision rules live in `noteComposerBlock` (`bufferHasUnsavedTextBlock`,
`saveRetryDelayBlock`, `shouldFlushOnTeardownBlock`) rather than inline, because
they are the part worth testing — see `tests/noteComposerDurabilityBlock.test.ts`.
The orchestrator around them is wiring.

## Crash consistency

Assume crashes. Record **intent before file operations**, so every crash point
has exactly one answer:

| Crash after… | Next launch |
|---|---|
| intent recorded | Nothing happened. Discard intent. |
| new file written | Origin intact. Finish, or report the duplicate. |
| origin cleaned | Done. Clear intent. |

Order is always **write → verify by read-back → clean up origin.** Never
delete-then-write: a failure in the first order leaves a duplicate a human fixes
in five seconds, a failure in the second leaves nothing.

**A crash during cleanup must never delete.** The journal outranks the litter
sweep, always. A stray empty file beats a deleted paragraph.

The app-update quit path needs its own handling: the auto-updater quits the app
and renderer `beforeunload` is not reliable across every quit path. Main
broadcasts a flush on `before-quit` and waits, bounded, for acknowledgement.

## Emptiness, and not littering the vault

A note is **empty** only when all of these hold:

- prose body is blank (`editorBody.trim() === ''`), **and**
- `parseNoteCanvasBlock(content).tiles.length === 0`, **and**
- no user-set title, emotions, or tags.

The canvas clause is not optional. `editorBody` deliberately strips the canvas
fence, so a body-only test classifies a finished drawing with no prose as empty
and reaps it. Generated frontmatter never counts as content.

The husk arises like this: type one character, auto-save writes the file with
generated frontmatter, delete the character. `canSave` goes false, auto-save
never fires again, and a frontmatter-only file stays on disk forever.

**A file holding nothing but generated frontmatter is litter and gets deleted.**
It is not a note; it is the residue of a note that was never written.

Provenance comes from **content, not memory**. `thoughts.create` writes a
recognisable generated frontmatter shape, so a file that is empty by the
definition above *and* whose frontmatter carries no user-set field is
unambiguously an app-made husk. Deriving it this way costs nothing, survives
crashes and reinstalls, and — unlike a session marker — reaches husks created
before this contract existed, which are already sitting in vaults today.

Reaping rules:

- Delete an empty, generated-frontmatter-only target on transition away, on
  teardown, and when one is encountered during a normal vault walk.
- **Never** delete a file carrying anything a human put there — body text,
  canvas tiles, a custom title, emotions, tags, or hand-edited frontmatter.
  An empty file with *hand-written* frontmatter may be a deliberate stub.
- **Never** delete while a journal entry claims unsaved text for that path.
- The journal still records session provenance, but as a **secondary** signal.
  Content-derived provenance is the primary one precisely because it is the only
  one that survives the events this contract assumes will happen.
- Journal drafts are themselves litter: empty ones GC immediately; non-empty
  unresolved ones are **never** aged out silently. That is what they are for.

## Testing: crash safety is not claimable by inspection

Fault injection or it isn't true. A test seam aborts between any two file
operations, and the invariant is asserted at **every** abort point:

> After an abort at any step, the union of (note files + vault journal) contains
> every character the user typed.

**DONE 2026-08-22** for the two tiers, in
`tests/noteDraftJournalFaultInjection.test.ts`: the vault and `localStorage` are
each failed independently and the invariant re-asserted. Both failing at once is
the single case the chokepoint refuses to transition on.

**Still open:** a fault-injection seam across the *React* transition paths.
There is no hook-test infrastructure in this repo — all 145 test files are
node-environment pure-block tests — so the transition matrix is covered at the
level of its extracted decision blocks rather than end to end. Closing it means
adding jsdom + `@testing-library/react`, which is a dependency decision, not a
technical blocker.

Also required, because they are the silent eaters:

- Round-trip property test: `setEditorBody(editorBody(c)) === c` across content
  with and without frontmatter and canvas fence. This is the one path that can
  drop text through a pure-function bug with nothing on screen to show it.

  **It found two, both cumulative** (`tests/noteEditorBodyRoundTrip.test.ts`,
  2026-08-22). The composer round-trips body → content on *every keystroke*, so
  any asymmetry in that pair compounds rather than happening once:

  1. `splitNoteFrontmatterBlock` strips one leading newline from the body —
     correct for display, wrong for reassembly. A note lost one blank line off
     the top **per save**. Fixed with `splitNoteContentExactBlock`, a lossless
     split where `frontmatter + body === content` (and which still recognises
     `---\r`, so a CRLF note does not start showing its YAML in the editor).
  2. `parseNoteCanvasBlock` removes the fence *and* one following newline, while
     `appendCanvasFence` unconditionally added one back. A note with a canvas
     **gained a blank line on every keystroke**, unbounded. Fixed by making the
     append add exactly the separator that is missing.

  Neither was reachable by reading the code — the functions are individually
  reasonable and only wrong as a pair. That is the argument for the property
  test rather than more unit tests.
- Transition matrix: {project pick, Explorer pick, recent pick, kind change, New
  note, unmount} × {clean, dirty, save-failing} × {origin created this session,
  origin pre-existing} × {auto-save on, off}.
- Litter: type → delete → transition leaves no empty file, in every branch.

## Energy note

The journal is change-driven, not a periodic timer, so it complies with
[ENERGY.md](ENERGY.md). Writes must coalesce — an iCloud-synced vault must not
be churned per keystroke.
