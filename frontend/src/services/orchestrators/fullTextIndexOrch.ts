// Full-text index workflow — writer and reader for the shared index whose
// layout lives in fullTextIndexStoreBlock.
//
// Writer (one Mac): after a sync rewrites the vault index cache, compare each
// note's mtime with what the index last saw; re-index changed notes into
// small delta files. Once deltas pile up (or the base ages), rebuild the base
// in one pass. Only the install named in the manifest writes — two writers
// would trade iCloud conflict copies — unless its base has gone untouched for
// two weeks (that Mac is gone). Event-driven: nothing runs unless a sync
// happened, plus one deferred pass after launch (Energy, Startup contracts).
//
// Reader (every device): resolve query terms to the set of notes containing
// them, reading only the shards for those terms plus the deltas. Phones and
// the web never write; a note edited there is found by name/title/excerpt
// until the Mac indexes it.

import { getVaultFS, isElectron, type VaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import { getVaultFileIndexRecords, type VaultFileRecord } from '@/services/lego_blocks/integrations/dbBlock'
import { onVaultIndexChangedBlock } from '@/services/lego_blocks/units/vaultIndexChangedBlock'
import { isAppGeneratedVaultPathBlock } from '@/services/lego_blocks/units/vaultGitignoreBlock'
import {
  decodePostingsBlock,
  encodePostingsBlock,
  FULL_TEXT_FORMAT_VERSION,
  FULL_TEXT_MIN_PREFIX,
  fullTextDeltaNameBlock,
  fullTextShardKeyBlock,
  tokenizeFullTextBlock,
} from '@/services/lego_blocks/units/fullTextTokenizeBlock'
import {
  deleteFullTextDeltaBlock,
  deleteStaleFullTextGenerationsBlock,
  ensureFullTextDirsBlock,
  listFullTextDeltaNamesBlock,
  readFullTextDeltaBlock,
  readFullTextDocsBlock,
  readFullTextManifestBlock,
  readFullTextShardBlock,
  writeFullTextDeltaBlock,
  writeFullTextDocsBlock,
  writeFullTextManifestBlock,
  writeFullTextShardBlock,
  type FullTextDocTable,
  type FullTextManifest,
  type FullTextShard,
} from '@/services/lego_blocks/integrations/fullTextIndexStoreBlock'

/** Deltas past this many notes fold into a fresh base. */
const REBUILD_AT_DELTAS = 300
/** A base older than this is rebuilt on the next change. */
const REBUILD_MAX_AGE_MS = 7 * 24 * 60 * 60_000
/** Another install's index is left alone unless it has been idle this long. */
const FOREIGN_WRITER_GRACE_MS = 14 * 24 * 60 * 60_000
/** Bigger notes are dumps (exports, logs), not something you search inside. */
const MAX_DOC_BYTES = 1_500_000
const LAUNCH_DELAY_MS = 60_000
const CHANGE_DEBOUNCE_MS = 15_000
const READ_BATCH = 8

const WRITER_ID_KEY = 'ts.fullTextIndex.writerId'

function writerId(): string {
  try {
    let id = localStorage.getItem(WRITER_ID_KEY)
    if (!id) {
      id = crypto.randomUUID()
      localStorage.setItem(WRITER_ID_KEY, id)
    }
    return id
  } catch {
    return 'unknown'
  }
}

const yieldToUi = () => new Promise<void>(resolve => setTimeout(resolve, 0))

const isHidden = (path: string) => path.startsWith('.') || path.includes('/.')

/** The notes worth indexing: the user's own markdown, not dumps or app data. */
async function indexableNotes(): Promise<VaultFileRecord[]> {
  const records = await getVaultFileIndexRecords()
  return records.filter(r =>
    !isHidden(r.path) && !isAppGeneratedVaultPathBlock(r.path) && r.size <= MAX_DOC_BYTES)
}

async function readTerms(fs: VaultFS, path: string): Promise<string[] | null> {
  try {
    return tokenizeFullTextBlock(await fs.read(path))
  } catch {
    return null
  }
}

// ── Writer ───────────────────────────────────────────────────────────────────

async function rebuild(fs: VaultFS, notes: VaultFileRecord[], previous: FullTextManifest | null): Promise<void> {
  const startedAt = Date.now()
  await ensureFullTextDirsBlock(fs)
  const generation = (previous?.generation ?? 0) + 1

  const docs: FullTextDocTable = { paths: [], mtimes: [] }
  const postings = new Map<string, number[]>()
  for (let i = 0; i < notes.length; i += READ_BATCH) {
    const batch = notes.slice(i, i + READ_BATCH)
    const termLists = await Promise.all(batch.map(note => readTerms(fs, note.path)))
    batch.forEach((note, j) => {
      const terms = termLists[j]
      if (!terms) return
      const id = docs.paths.length
      docs.paths.push(note.path)
      docs.mtimes.push(note.mtime)
      for (const term of terms) {
        const ids = postings.get(term)
        if (ids) ids.push(id)
        else postings.set(term, [id])
      }
    })
    await yieldToUi()
  }

  // Ids were handed out in increasing order, so every list is already sorted.
  const shards = new Map<string, FullTextShard>()
  for (const [term, ids] of postings) {
    const key = fullTextShardKeyBlock(term)
    let shard = shards.get(key)
    if (!shard) {
      shard = {}
      shards.set(key, shard)
    }
    shard[term] = encodePostingsBlock(ids)
  }
  postings.clear()

  await writeFullTextDocsBlock(fs, generation, docs)
  for (const [key, shard] of shards) {
    await writeFullTextShardBlock(fs, generation, key, shard)
    await yieldToUi()
  }
  await writeFullTextManifestBlock(fs, {
    version: FULL_TEXT_FORMAT_VERSION,
    generation,
    writer: writerId(),
    builtAt: Date.now(),
    docCount: docs.paths.length,
  })

  // Every delta predates this rebuild (deltas are only written by reconcile,
  // which is not running concurrently), and the base just re-read each note,
  // so all of them are covered. An edit made mid-rebuild shows up as an mtime
  // newer than the base's and is re-indexed on the next pass.
  for (const name of await listFullTextDeltaNamesBlock(fs)) await deleteFullTextDeltaBlock(fs, name)
  await deleteStaleFullTextGenerationsBlock(fs, generation)
  console.info(
    `[fullTextIndex] rebuilt g${generation}: ${docs.paths.length} notes, ${shards.size} shards in ${Date.now() - startedAt}ms`,
  )
}

async function reconcile(): Promise<boolean> {
  const fs = getVaultFS()
  const manifest = await readFullTextManifestBlock(fs)
  if (manifest && manifest.writer !== writerId() && Date.now() - manifest.builtAt < FOREIGN_WRITER_GRACE_MS) {
    return false
  }
  const notes = await indexableNotes()
  if (!manifest) {
    await rebuild(fs, notes, null)
    return true
  }
  const docs = await readFullTextDocsBlock(fs, manifest.generation)
  if (!docs) {
    await rebuild(fs, notes, manifest)
    return true
  }

  const seen = new Map<string, number>()
  docs.paths.forEach((path, i) => seen.set(path, docs.mtimes[i]))
  const deltaNames = await listFullTextDeltaNamesBlock(fs)
  const deltaByPath = new Map<string, string>()
  for (const name of deltaNames) {
    const delta = await readFullTextDeltaBlock(fs, name)
    if (!delta) continue
    seen.set(delta.path, delta.mtime)
    deltaByPath.set(delta.path, name)
  }

  const current = new Set(notes.map(n => n.path))
  let wrote = false
  for (const [path, name] of deltaByPath) {
    if (!current.has(path)) {
      await deleteFullTextDeltaBlock(fs, name)
      deltaByPath.delete(path)
      wrote = true
    }
  }

  const changed = notes.filter(n => seen.get(n.path) !== n.mtime)
  const pending = new Set([...deltaByPath.keys(), ...changed.map(n => n.path)]).size
  const aged = Date.now() - manifest.builtAt > REBUILD_MAX_AGE_MS
  if (pending > REBUILD_AT_DELTAS || (aged && changed.length > 0)) {
    await rebuild(fs, notes, manifest)
    return true
  }

  for (const note of changed) {
    const terms = await readTerms(fs, note.path)
    if (!terms) continue
    await writeFullTextDeltaBlock(fs, fullTextDeltaNameBlock(note.path), {
      path: note.path,
      mtime: note.mtime,
      terms: terms.join(' '),
    })
    wrote = true
    await yieldToUi()
  }
  if (changed.length > 0) console.info(`[fullTextIndex] re-indexed ${changed.length} changed note(s)`)
  return wrote
}

/**
 * Keep the shared index current from this install. Desktop only; call once
 * from the window that owns background work. Returns a stop function.
 */
export function startFullTextIndexerOrch(): () => void {
  if (!isElectron()) return () => undefined
  let timer: ReturnType<typeof setTimeout> | null = null
  let running = false
  let again = false
  let stopped = false

  const run = async () => {
    if (stopped) return
    if (running) {
      again = true
      return
    }
    running = true
    try {
      if (await reconcile()) resetFullTextReaderOrch()
    } catch (err) {
      console.warn('[fullTextIndex] update failed', err)
    } finally {
      running = false
      if (again) {
        again = false
        schedule(CHANGE_DEBOUNCE_MS)
      }
    }
  }
  const schedule = (delay: number) => {
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void run()
    }, delay)
  }

  schedule(LAUNCH_DELAY_MS)
  const unsubscribe = onVaultIndexChangedBlock(() => schedule(CHANGE_DEBOUNCE_MS))
  return () => {
    stopped = true
    unsubscribe()
    if (timer !== null) clearTimeout(timer)
  }
}

// ── Reader ───────────────────────────────────────────────────────────────────

interface ReaderState {
  generation: number
  docPaths: string[]
  /** Notes re-indexed since the base: their delta terms replace base hits. */
  deltas: { path: string; terms: string[] }[]
  overridden: Set<string>
  shards: Map<string, Promise<FullTextShard>>
}

let _reader: Promise<ReaderState | null> | null = null

/** Forget everything read so far; the next lookup re-reads the manifest. */
export function resetFullTextReaderOrch(): void {
  _reader = null
}

async function loadReader(): Promise<ReaderState | null> {
  const fs = getVaultFS()
  const manifest = await readFullTextManifestBlock(fs)
  if (!manifest) return null
  const docs = await readFullTextDocsBlock(fs, manifest.generation)
  if (!docs) return null
  const deltas: ReaderState['deltas'] = []
  for (const name of await listFullTextDeltaNamesBlock(fs)) {
    const delta = await readFullTextDeltaBlock(fs, name)
    if (delta) deltas.push({ path: delta.path, terms: delta.terms ? delta.terms.split(' ') : [] })
  }
  return {
    generation: manifest.generation,
    docPaths: docs.paths,
    deltas,
    overridden: new Set(deltas.map(d => d.path)),
    shards: new Map(),
  }
}

function reader(): Promise<ReaderState | null> {
  if (!_reader) _reader = loadReader().catch(() => null)
  return _reader
}

const termMatches = (term: string, word: string) =>
  word.length >= FULL_TEXT_MIN_PREFIX ? term.startsWith(word) : term === word

/** Notes containing `word` (as a whole term, or a term prefix when long enough). */
async function notesWithWord(state: ReaderState, word: string): Promise<Set<string>> {
  const fs = getVaultFS()
  const key = fullTextShardKeyBlock(word)
  let shard = state.shards.get(key)
  if (!shard) {
    shard = readFullTextShardBlock(fs, state.generation, key)
    state.shards.set(key, shard)
  }
  const out = new Set<string>()
  for (const [term, packed] of Object.entries(await shard)) {
    if (!termMatches(term, word)) continue
    for (const id of decodePostingsBlock(packed)) {
      const path = state.docPaths[id]
      if (path && !state.overridden.has(path)) out.add(path)
    }
  }
  for (const delta of state.deltas) {
    if (delta.terms.some(term => termMatches(term, word))) out.add(delta.path)
  }
  return out
}

/**
 * For each query token, the notes whose text contains it. A token that splits
 * into several words ("to-read") needs all of them. Tokens with no indexable
 * word are left out of the map; no index at all → empty map.
 */
export async function lookupFullTextOrch(tokens: readonly string[]): Promise<Map<string, Set<string>>> {
  const result = new Map<string, Set<string>>()
  const state = await reader()
  if (!state) return result
  for (const token of tokens) {
    const words = tokenizeFullTextBlock(token)
    if (words.length === 0) continue
    let notes = await notesWithWord(state, words[0])
    for (const word of words.slice(1)) {
      if (notes.size === 0) break
      const found = await notesWithWord(state, word)
      notes = new Set([...notes].filter(path => found.has(path)))
    }
    result.set(token, notes)
  }
  return result
}
