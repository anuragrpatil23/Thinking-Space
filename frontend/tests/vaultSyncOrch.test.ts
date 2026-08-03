import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VaultFS, ListedFiles, VaultStat, VaultEntry } from '@/services/lego_blocks/integrations/fsBlock'
import {
  createNote,
  stringifyNote,
} from '@/services/lego_blocks/units/yamlNoteBlock'

function createMemoryLocalStorage(): Storage {
  const store = new Map<string, string>()
  return {
    get length() {
      return store.size
    },
    clear() {
      store.clear()
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null
    },
    key(index: number) {
      const keys = [...store.keys()]
      return keys[index] ?? null
    },
    removeItem(key: string) {
      store.delete(key)
    },
    setItem(key: string, value: string) {
      store.set(key, String(value))
    },
  } as Storage
}

// ── Fake VaultFS ──

class FakeVaultFS implements VaultFS {
  private readonly files = new Map<string, string>()
  private readonly mtimes = new Map<string, number>()
  private readonly readFailures = new Set<string>()

  seedFile(path: string, content: string, mtime: number = Date.now() / 1000): void {
    this.files.set(path, content)
    this.mtimes.set(path, mtime)
  }

  removeFile(path: string): void {
    this.files.delete(path)
    this.mtimes.delete(path)
    this.readFailures.delete(path)
  }

  failRead(path: string): void {
    this.readFailures.add(path)
  }

  clearReadFailure(path: string): void {
    this.readFailures.delete(path)
  }

  async read(path: string): Promise<string> {
    if (this.readFailures.has(path)) {
      throw new Error(`Injected read failure: ${path}`)
    }
    const content = this.files.get(path)
    if (content == null) throw new Error(`Missing file: ${path}`)
    return content
  }

  async write(path: string, data: string): Promise<void> {
    this.files.set(path, data)
    this.mtimes.set(path, Date.now() / 1000)
  }

  async create(path: string, data: string): Promise<void> {
    await this.write(path, data)
  }

  async list(_path: string): Promise<ListedFiles> {
    return { files: [], folders: [] }
  }

  async walkVault(_extensions?: string[]): Promise<VaultEntry[]> {
    const entries: VaultEntry[] = []
    for (const [path, _content] of this.files) {
      if (!path.endsWith('.md')) continue
      entries.push({
        path,
        size: _content.length,
        mtime: this.mtimes.get(path) ?? Date.now() / 1000,
        ctime: this.mtimes.get(path) ?? Date.now() / 1000,
      })
    }
    return entries
  }

  async stat(path: string): Promise<VaultStat> {
    if (!this.files.has(path)) throw new Error(`Missing: ${path}`)
    return { size: this.files.get(path)!.length, mtime: this.mtimes.get(path) ?? 0 }
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path)
  }

  async mkdir(_path: string): Promise<void> {}

  async process(path: string, fn: (data: string) => string): Promise<void> {
    const content = await this.read(path)
    await this.write(path, fn(content))
  }

  // Binary reads/writes and delete: no test here exercises them. They exist so
  // the double actually satisfies VaultFS — a double that doesn't is invisible
  // to the typechecker, which is what let renames rot in tests unnoticed.
  async readBytes(p: string): Promise<Uint8Array> {
    return new TextEncoder().encode(await this.read(p))
  }

  async writeBytes(p: string, data: Uint8Array): Promise<void> {
    await this.write(p, new TextDecoder().decode(data))
  }

  async delete(_p: string): Promise<void> {
    throw new Error('delete is not implemented by this test double')
  }
}

// ── Mock IndexedDB via fake-indexeddb ──
// Dexie requires IndexedDB. In Node test environment we use fake-indexeddb.

let fakeIdb: typeof import('fake-indexeddb') | null = null

beforeEach(async () => {
  if (typeof globalThis.localStorage === 'undefined' || typeof globalThis.localStorage.clear !== 'function') {
    Object.defineProperty(globalThis, 'localStorage', {
      value: createMemoryLocalStorage(),
      configurable: true,
      writable: true,
    })
  } else {
    globalThis.localStorage.clear()
  }

  // Dynamically import fake-indexeddb if available, skip tests otherwise
  try {
    fakeIdb = await import('fake-indexeddb')
    // Set up global IndexedDB for Dexie
    globalThis.indexedDB = fakeIdb.default
    globalThis.IDBKeyRange = fakeIdb.IDBKeyRange as any
  } catch {
    fakeIdb = null
  }
})

afterEach(async () => {
  // Clean up database between tests
  try {
    const { deleteDb } = await import('@/services/lego_blocks/integrations/dbBlock')
    await deleteDb()
  } catch {
    // ignore cleanup errors
  }
  try {
    localStorage.removeItem('thinkingspace:lastSyncTimestamp')
  } catch {
    // ignore localStorage cleanup errors
  }
})

// Helper to create a seeded vault
function createSeededVault(): FakeVaultFS {
  const fs = new FakeVaultFS()

  // Seed some YAML frontmatter notes
  const program = createNote({ type: 'program', title: 'Personal Growth' })
  fs.seedFile('program-personal-growth.md', stringifyNote(program))

  const epic = createNote({
    type: 'epic',
    title: 'Build Thinking Space',
    parent: program.frontmatter.key,
    parent_uuid: program.frontmatter.uuid,
    parent_type: 'program',
  })
  fs.seedFile('epic-build-thinking-space.md', stringifyNote(epic))

  const thought = createNote({
    type: 'thought',
    title: 'AI Extensibility Ideas',
    parent: epic.frontmatter.key,
    body: 'Some thoughts about AI extensibility and plugin systems.',
  })
  fs.seedFile('thoughts/thought-ai-extensibility.md', stringifyNote(thought))

  // Seed a plain markdown file (no frontmatter) — should be skipped
  fs.seedFile('plain-note.md', '# Just a Note\n\nNo frontmatter here.')

  return fs
}

describe('vaultSyncOrch', () => {
  it('fullSync parses YAML files and skips plain markdown', async () => {
    if (!fakeIdb) return // skip if fake-indexeddb not available

    const { fullSync } = await import('@/services/orchestrators/vaultSyncOrch')
    const { getNodeCount, getAllNodes } = await import('@/services/lego_blocks/integrations/dbBlock')

    const fs = createSeededVault()
    const result = await fullSync(fs)

    expect(result.parsedNodes).toBe(3)
    expect(result.skippedFiles).toBe(1) // plain-note.md
    expect(result.errors).toHaveLength(0)

    const count = await getNodeCount()
    expect(count).toBe(3)

    const nodes = await getAllNodes()
    const types = nodes.map(n => n.type).sort()
    expect(types).toEqual(['epic', 'program', 'thought'])
  })

  it('syncSingleFile upserts one file into cache', async () => {
    if (!fakeIdb) return

    const { syncSingleFile } = await import('@/services/orchestrators/vaultSyncOrch')
    const { getNodeByKey, getNodeCount } = await import('@/services/lego_blocks/integrations/dbBlock')

    const fs = new FakeVaultFS()
    const note = createNote({ type: 'idea', title: 'New Idea' })
    fs.seedFile('idea-new-idea.md', stringifyNote(note))

    const success = await syncSingleFile('idea-new-idea.md', fs)
    expect(success).toBe(true)

    const count = await getNodeCount()
    expect(count).toBe(1)

    const cached = await getNodeByKey('new-idea')
    expect(cached).toBeDefined()
    expect(cached!.title).toBe('New Idea')
    expect(cached!.type).toBe('idea')
  })

  it('syncSingleFile maps project_preset_tags from YAML into cache records', async () => {
    if (!fakeIdb) return

    const { syncSingleFile } = await import('@/services/orchestrators/vaultSyncOrch')
    const { getNodeByKey } = await import('@/services/lego_blocks/integrations/dbBlock')

    const fs = new FakeVaultFS()
    const note = createNote({ type: 'thought', title: 'Project Tag Mapping' })
    note.frontmatter.tags = ['general']
    note.frontmatter.project_preset_tags = ['release', 'backend']
    fs.seedFile('thoughts/thought-project-tag-mapping.md', stringifyNote(note))

    const success = await syncSingleFile('thoughts/thought-project-tag-mapping.md', fs)
    expect(success).toBe(true)

    const cached = await getNodeByKey(note.frontmatter.key)
    expect(cached).toBeDefined()
    expect(cached!.tags).toEqual(['general'])
    expect(cached!.projectPresetTags).toEqual(['release', 'backend'])
  })

  it('syncSingleFile returns false for plain markdown', async () => {
    if (!fakeIdb) return

    const { syncSingleFile } = await import('@/services/orchestrators/vaultSyncOrch')

    const fs = new FakeVaultFS()
    fs.seedFile('plain.md', '# No frontmatter')

    const success = await syncSingleFile('plain.md', fs)
    expect(success).toBe(false)
  })

  it('syncSingleFile skips oversized files when maxFileSizeBytes is exceeded', async () => {
    if (!fakeIdb) return

    const { syncSingleFile } = await import('@/services/orchestrators/vaultSyncOrch')

    const fs = new FakeVaultFS()
    const note = createNote({ type: 'idea', title: 'Large File Idea' })
    note.body = 'x'.repeat(2048)
    fs.seedFile('idea-large.md', stringifyNote(note))

    const success = await syncSingleFile('idea-large.md', fs, { maxFileSizeBytes: 256 })
    expect(success).toBe(false)
  })

  it('incrementalSync detects deleted files', async () => {
    if (!fakeIdb) return

    const { fullSync, incrementalSync } = await import('@/services/orchestrators/vaultSyncOrch')
    const { getNodeCount } = await import('@/services/lego_blocks/integrations/dbBlock')

    const fs = createSeededVault()

    // Full sync first
    await fullSync(fs)
    expect(await getNodeCount()).toBe(3)

    // Remove a file and do incremental sync
    fs.removeFile('thoughts/thought-ai-extensibility.md')

    const pastTimestamp = Math.floor(Date.now() / 1000) - 3600 // 1 hour ago
    const result = await incrementalSync(pastTimestamp, fs)

    expect(result.deletedNodes).toBe(1)
    expect(await getNodeCount()).toBe(2)
  })

  it('incrementalSync handles mixed timestamp units without rescanning unchanged files', async () => {
    if (!fakeIdb) return

    const { incrementalSync } = await import('@/services/orchestrators/vaultSyncOrch')

    const fs = new FakeVaultFS()
    const sinceSeconds = 1_700_000_000

    const unchanged = createNote({ type: 'idea', title: 'Unchanged Idea' })
    const updated = createNote({ type: 'idea', title: 'Updated Idea' })
    fs.seedFile('ideas/unchanged.md', stringifyNote(unchanged), (sinceSeconds - 20) * 1000)
    fs.seedFile('ideas/updated.md', stringifyNote(updated), (sinceSeconds + 20) * 1000)

    // If unchanged file is incorrectly treated as updated due to unit mismatch, this test fails.
    fs.failRead('ideas/unchanged.md')

    const result = await incrementalSync(sinceSeconds, fs)
    expect(result.errors).toHaveLength(0)
    expect(result.parsedNodes).toBe(1)
    expect(result.totalFiles).toBe(2)
  })

  it('fullSync stores body excerpt', async () => {
    if (!fakeIdb) return

    const { fullSync } = await import('@/services/orchestrators/vaultSyncOrch')
    const { getAllNodes } = await import('@/services/lego_blocks/integrations/dbBlock')

    const fs = createSeededVault()
    await fullSync(fs)

    const nodes = await getAllNodes()
    const thought = nodes.find(n => n.type === 'thought')
    expect(thought).toBeDefined()
    expect(thought!.bodyExcerpt).toContain('AI extensibility')
  })

  it('fullSync skips oversized files when maxFileSizeBytes is exceeded', async () => {
    if (!fakeIdb) return

    const { fullSync } = await import('@/services/orchestrators/vaultSyncOrch')
    const { getNodeCount } = await import('@/services/lego_blocks/integrations/dbBlock')

    const fs = new FakeVaultFS()
    const note = createNote({ type: 'thought', title: 'Oversized Thought' })
    note.body = 'A'.repeat(4096)
    fs.seedFile('thoughts/oversized.md', stringifyNote(note))

    const result = await fullSync(fs, { maxFileSizeBytes: 512 })
    expect(result.parsedNodes).toBe(0)
    expect(result.skippedFiles).toBe(1)
    expect(result.errors).toHaveLength(0)
    expect(await getNodeCount()).toBe(0)
  })

  it('fullSync preserves parent relationships', async () => {
    if (!fakeIdb) return

    const { fullSync } = await import('@/services/orchestrators/vaultSyncOrch')
    const { getAllNodes } = await import('@/services/lego_blocks/integrations/dbBlock')

    const fs = createSeededVault()
    await fullSync(fs)

    const nodes = await getAllNodes()
    const epic = nodes.find(n => n.type === 'epic')
    expect(epic).toBeDefined()
    expect(epic!.parent).toBe('personal-growth')
  })

  it('fullSync auto-heals missing generated wiki_links when the setting is enabled', async () => {
    if (!fakeIdb) return

    const { setCapabilityFeatureFlag } = await import('@/services/lego_blocks/integrations/capabilityFeatureFlagsBlock')
    const { fullSync } = await import('@/services/orchestrators/vaultSyncOrch')

    setCapabilityFeatureFlag('yaml_fields_auto_heal_enabled', true)

    const fs = new FakeVaultFS()
    const program = createNote({ type: 'program', title: 'Program Root' })
    fs.seedFile('programs/program-root.md', stringifyNote(program))

    const child = createNote({
      type: 'epic',
      title: 'Child Epic',
      parent: program.frontmatter.key,
      parent_uuid: program.frontmatter.uuid,
      parent_type: 'program',
    })
    child.frontmatter.wiki_links = ['[[manual/reference]]']
    fs.seedFile('epics/child-epic.md', stringifyNote(child))

    const source = createNote({ type: 'thought', title: 'Source Thought' })
    fs.seedFile('thoughts/source-thought.md', stringifyNote(source))

    const derived = createNote({ type: 'thought', title: 'Derived Thought' })
    derived.frontmatter.derived_from = ['thoughts/source-thought.md']
    derived.frontmatter.wiki_links = ['[[manual/reference]]']
    fs.seedFile('thoughts/derived-thought.md', stringifyNote(derived))

    const sourced = createNote({ type: 'thought', title: 'Sourced Thought' })
    sourced.frontmatter.source_files = ['[[thoughts/source-thought]]']
    sourced.frontmatter.wiki_links = ['[[manual/reference]]']
    fs.seedFile('thoughts/sourced-thought.md', stringifyNote(sourced))

    await fullSync(fs)

    const childContent = await fs.read('epics/child-epic.md')
    expect(childContent).toContain('wiki_links:')
    expect(childContent).toContain('[[manual/reference]]')
    expect(childContent).toContain('[[programs/program-root]]')

    const derivedContent = await fs.read('thoughts/derived-thought.md')
    expect(derivedContent).toContain('wiki_links:')
    expect(derivedContent).toContain('[[manual/reference]]')
    expect(derivedContent).toContain('[[thoughts/source-thought]]')

    const sourcedContent = await fs.read('thoughts/sourced-thought.md')
    expect(sourcedContent).toContain('wiki_links:')
    expect(sourcedContent).toContain('[[manual/reference]]')
    expect(sourcedContent).toContain('[[thoughts/source-thought]]')
  })

  it('smartSync keeps last sync timestamp unchanged when incremental sync has errors', async () => {
    if (!fakeIdb) return

    const {
      fullSync,
      smartSync,
      setLastSyncTimestamp,
      getLastSyncTimestamp,
    } = await import('@/services/orchestrators/vaultSyncOrch')

    const fs = createSeededVault()
    await fullSync(fs)

    setLastSyncTimestamp(100)
    fs.seedFile('thoughts/thought-ai-extensibility.md', '# broken read target', 200)
    fs.failRead('thoughts/thought-ai-extensibility.md')

    const result = await smartSync(fs)
    expect(result.errors).toHaveLength(1)
    expect(getLastSyncTimestamp()).toBe(100)
  })

  it('smartSync resets timestamp to 0 when full sync fails', async () => {
    if (!fakeIdb) return

    const {
      smartSync,
      setLastSyncTimestamp,
      getLastSyncTimestamp,
    } = await import('@/services/orchestrators/vaultSyncOrch')

    const fs = createSeededVault()
    fs.failRead('program-personal-growth.md')
    setLastSyncTimestamp(999)

    const result = await smartSync(fs)
    expect(result.errors).toHaveLength(1)
    expect(getLastSyncTimestamp()).toBe(0)
  })

  it('smartSync advances timestamp when sync succeeds', async () => {
    if (!fakeIdb) return

    const {
      fullSync,
      smartSync,
      setLastSyncTimestamp,
      getLastSyncTimestamp,
    } = await import('@/services/orchestrators/vaultSyncOrch')

    const fs = createSeededVault()
    await fullSync(fs)
    setLastSyncTimestamp(100)
    const existingThought = await fs.read('thoughts/thought-ai-extensibility.md')
    fs.seedFile('thoughts/thought-ai-extensibility.md', existingThought, 200)

    const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1_234_000)
    try {
      const result = await smartSync(fs)
      expect(result.errors).toHaveLength(0)
      expect(getLastSyncTimestamp()).toBe(1234)
    } finally {
      nowSpy.mockRestore()
    }
  })

  it('getLastSyncTimestamp normalizes millisecond values to seconds', async () => {
    const { getLastSyncTimestamp } = await import('@/services/orchestrators/vaultSyncOrch')

    localStorage.setItem('thinkingspace:lastSyncTimestamp', '1700000123000')
    expect(getLastSyncTimestamp()).toBe(1700000123)
  })
})

describe('dbBlock search', () => {
  it('searches across title and body excerpt', async () => {
    if (!fakeIdb) return

    const { fullSync } = await import('@/services/orchestrators/vaultSyncOrch')
    const { searchNodes } = await import('@/services/lego_blocks/integrations/dbBlock')

    const fs = createSeededVault()
    await fullSync(fs)

    const results = await searchNodes('extensibility')
    expect(results.length).toBeGreaterThan(0)
    expect(results[0].title).toContain('Extensibility')
  })

  it('returns empty for no matches', async () => {
    if (!fakeIdb) return

    const { fullSync } = await import('@/services/orchestrators/vaultSyncOrch')
    const { searchNodes } = await import('@/services/lego_blocks/integrations/dbBlock')

    const fs = createSeededVault()
    await fullSync(fs)

    const results = await searchNodes('zzzznonexistent')
    expect(results).toHaveLength(0)
  })

  it('indexes orchestration fields and generic metadata keys', async () => {
    if (!fakeIdb) return

    const { fullSync } = await import('@/services/orchestrators/vaultSyncOrch')
    const {
      getNodesByRecordKind,
      getNodesByTaskStatus,
      getNodesByMetadataKey,
      searchNodes,
    } = await import('@/services/lego_blocks/integrations/dbBlock')

    const fs = new FakeVaultFS()
    const note = createNote({ type: 'thought', title: 'Task Record' })
    note.frontmatter.record_kind = 'task'
    note.frontmatter.task_id = 'LTM-200'
    note.frontmatter.task_status = 'in_progress'
    note.frontmatter.owner = 'codex'
    note.frontmatter.custom_scope = 'agent-native'
    note.frontmatter.custom_trace = {
      source: 'importer',
      depth: 2,
    }
    fs.seedFile('tasks/task-record.md', stringifyNote(note))

    await fullSync(fs)

    const byKind = await getNodesByRecordKind('task')
    expect(byKind).toHaveLength(1)
    expect(byKind[0].taskId).toBe('LTM-200')

    const byStatus = await getNodesByTaskStatus('in_progress')
    expect(byStatus).toHaveLength(1)
    expect(byStatus[0].owner).toBe('codex')

    const byMetadataKey = await getNodesByMetadataKey('custom_trace.source')
    expect(byMetadataKey).toHaveLength(1)
    expect(byMetadataKey[0].metadata?.custom_scope).toBe('agent-native')

    const bySearch = await searchNodes('agent-native')
    expect(bySearch).toHaveLength(1)
    expect(bySearch[0].key).toBe(note.frontmatter.key)
  })
})
