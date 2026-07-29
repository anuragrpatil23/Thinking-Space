import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ListedFiles, VaultEntry, VaultFS, VaultStat } from '@/services/lego_blocks/integrations/fsBlock'

class FakeVaultFS implements VaultFS {
  private readonly files = new Map<string, string>()
  private readonly mtimes = new Map<string, number>()
  private readonly dirs = new Set<string>([''])

  async read(path: string): Promise<string> {
    const normalized = this.normalize(path)
    const content = this.files.get(normalized)
    if (content == null) throw new Error(`Missing file: ${normalized}`)
    return content
  }

  async write(path: string, data: string): Promise<void> {
    const normalized = this.normalize(path)
    this.files.set(normalized, data)
    this.mtimes.set(normalized, Date.now() / 1000)
    this.ensureParentDirs(normalized)
  }

  async create(path: string, data: string): Promise<void> {
    const normalized = this.normalize(path)
    if (this.files.has(normalized)) throw new Error(`File already exists: ${normalized}`)
    await this.write(normalized, data)
  }

  async list(path: string): Promise<ListedFiles> {
    const normalized = this.normalize(path)
    if (!this.folderExists(normalized)) throw new Error(`Missing folder: ${normalized}`)

    const files = new Set<string>()
    const folders = new Set<string>()

    for (const filePath of this.files.keys()) {
      const { parent, name } = this.splitParent(filePath)
      if (parent === normalized) files.add(name)
    }

    for (const dirPath of this.dirs) {
      if (dirPath === normalized) continue
      const { parent, name } = this.splitParent(dirPath)
      if (parent === normalized) folders.add(name)
    }

    return {
      files: [...files].sort(),
      folders: [...folders].sort(),
    }
  }

  async walkVault(extensions: string[] = ['.md']): Promise<VaultEntry[]> {
    const lowered = extensions.map(ext => ext.toLowerCase())
    const entries: VaultEntry[] = []

    for (const [path, content] of this.files.entries()) {
      const include = lowered.some(ext => path.toLowerCase().endsWith(ext))
      if (!include) continue

      const ts = this.mtimes.get(path) ?? Date.now() / 1000
      entries.push({
        path,
        size: content.length,
        mtime: ts,
        ctime: ts,
      })
    }

    return entries
  }

  async stat(path: string): Promise<VaultStat> {
    const normalized = this.normalize(path)
    if (this.files.has(normalized)) {
      return {
        size: this.files.get(normalized)!.length,
        mtime: this.mtimes.get(normalized) ?? 0,
        isDirectory: false,
      }
    }

    if (this.folderExists(normalized)) {
      return {
        size: 0,
        mtime: 0,
        isDirectory: true,
      }
    }

    throw new Error(`Missing path: ${normalized}`)
  }

  async exists(path: string): Promise<boolean> {
    const normalized = this.normalize(path)
    return this.files.has(normalized) || this.folderExists(normalized)
  }

  async mkdir(path: string): Promise<void> {
    const normalized = this.normalize(path)
    this.ensureDir(normalized)
  }

  async process(path: string, fn: (data: string) => string): Promise<void> {
    const current = await this.read(path)
    await this.write(path, fn(current))
  }

  private normalize(path: string): string {
    return path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/')
  }

  private splitParent(path: string): { parent: string; name: string } {
    const idx = path.lastIndexOf('/')
    if (idx < 0) return { parent: '', name: path }
    return {
      parent: path.slice(0, idx),
      name: path.slice(idx + 1),
    }
  }

  private ensureParentDirs(path: string): void {
    const parts = this.normalize(path).split('/')
    if (parts.length <= 1) return

    let cursor = ''
    for (let i = 0; i < parts.length - 1; i += 1) {
      cursor = cursor ? `${cursor}/${parts[i]}` : parts[i]
      this.dirs.add(cursor)
    }
  }

  private ensureDir(path: string): void {
    const normalized = this.normalize(path)
    if (!normalized) return

    const parts = normalized.split('/')
    let cursor = ''
    for (const part of parts) {
      cursor = cursor ? `${cursor}/${part}` : part
      this.dirs.add(cursor)
    }
  }

  private folderExists(path: string): boolean {
    if (!path) return true
    if (this.dirs.has(path)) return true
    for (const filePath of this.files.keys()) {
      if (filePath.startsWith(`${path}/`)) return true
    }
    return false
  }
}

const ACTOR = { kind: 'human', id: 'test-suite' } as const

let fakeIdb: typeof import('fake-indexeddb') | null = null
let capabilityOrch: typeof import('@/services/orchestrators/capabilityRouterOrch') | null = null

beforeEach(async () => {
  fakeIdb = await import('fake-indexeddb')
  globalThis.indexedDB = fakeIdb.default
  globalThis.IDBKeyRange = fakeIdb.IDBKeyRange as any
  capabilityOrch = await import('@/services/orchestrators/capabilityRouterOrch')
})

afterEach(async () => {
  const { deleteDb } = await import('@/services/lego_blocks/integrations/dbBlock')
  await deleteDb()
  const storage = (globalThis as typeof globalThis & { localStorage?: { removeItem?: (key: string) => void } }).localStorage
  storage?.removeItem?.('ltm-vault-root')
  const maybeWindow = (globalThis as typeof globalThis & { window?: { electronAPI?: unknown } }).window
  if (maybeWindow?.electronAPI !== undefined) {
    delete maybeWindow.electronAPI
  }
})

describe('capabilityRouterOrch', () => {

  it('scopes the fs singleton to the invoke, so getVaultFS() blocks see the caller\'s vault', async () => {
    const { peekVaultFSInstance, resetVaultFSInstance } = await import('@/services/lego_blocks/integrations/fsBlock')
    resetVaultFSInstance()

    const fs = new FakeVaultFS()
    await fs.write('notes/scoped.md', '# Scoped')
    let seen: unknown = null

    // read_note threads fs explicitly, so observe the singleton from inside the
    // invoke rather than relying on a capability that reaches for it.
    const response = await capabilityOrch!.invokeCapabilityOrch(
      { capability: 'read_note', input: { path: 'notes/scoped.md' }, actor: ACTOR } as never,
      {
        fs: new Proxy(fs, {
          get(target, prop, receiver) {
            seen = peekVaultFSInstance()
            return Reflect.get(target, prop, receiver)
          },
        }) as never,
      },
    )

    expect(response.ok).toBe(true)
    // The singleton pointed at the caller's fs during the call...
    expect(seen).not.toBeNull()
    // ...and was put back afterwards, so a later call against a different vault
    // (or a deleted temp one) is unaffected.
    expect(peekVaultFSInstance()).toBeNull()
  })

  it('restores the previous fs singleton even when the capability fails', async () => {
    const { peekVaultFSInstance, setVaultFSInstance, resetVaultFSInstance } =
      await import('@/services/lego_blocks/integrations/fsBlock')
    const previous = new FakeVaultFS()
    setVaultFSInstance(previous)

    const response = await capabilityOrch!.invokeCapabilityOrch(
      { capability: 'not_a_real_capability', input: {}, actor: ACTOR } as never,
      { fs: new FakeVaultFS() },
    )

    expect(response.ok).toBe(false)
    expect(peekVaultFSInstance()).toBe(previous)
    resetVaultFSInstance()
  })

  it('lists organizer capabilities', () => {
    const names = capabilityOrch!.listCapabilitiesOrch().map(capability => capability.name)
    expect(names).toContain('read_note')
    expect(names).toContain('create_ai_synthesis_note')
    expect(names).toContain('organizer.node.create')
    expect(names).toContain('organizer.node.update')
  })

  it('lists capabilities via Electron adapter IPC payload', async () => {
    installWindowAndStorageShims()

    const expected = {
      ok: true,
      capabilities: [
        {
          name: 'organizer.nodes.list_roots',
          description: 'List root nodes in the organizer hierarchy, optionally filtered by type.',
          readOnly: true,
        },
      ],
    }
    const listMock = vi.fn().mockResolvedValue(expected)
    const win = (globalThis as typeof globalThis & {
      window: {
        electronAPI?: {
          isElectron: true
          capabilitiesList: typeof listMock
        }
      }
    }).window
    win.electronAPI = {
      isElectron: true,
      capabilitiesList: listMock,
    }

    const response = await capabilityOrch!.listCapabilitiesViaElectronAdapterOrch()
    expect(listMock).toHaveBeenCalledWith()
    expect(response).toEqual(expected)
  })

  it('invokes capability via Electron adapter IPC payload', async () => {
    installWindowAndStorageShims()
    const { setStoredVaultRoot } = await import('@/services/lego_blocks/units/storageKeyBlock')
    setStoredVaultRoot('/tmp/electron-test-vault')

    const expected = {
      ok: true,
      capability: 'organizer.nodes.list_roots',
      requestId: 'cap-test',
      actor: ACTOR,
      dryRun: false,
      auditId: 'audit-test',
      warnings: [],
      data: { nodes: [] },
    }
    const invokeMock = vi.fn().mockResolvedValue(expected)
    const win = (globalThis as typeof globalThis & {
      window: {
        electronAPI?: {
          isElectron: true
          capabilitiesInvoke: typeof invokeMock
        }
      }
    }).window
    win.electronAPI = {
      isElectron: true,
      capabilitiesInvoke: invokeMock,
    }

    const request = {
      capability: 'organizer.nodes.list_roots' as const,
      input: { typeFilter: 'program' as const },
      actor: ACTOR,
    }

    const response = await capabilityOrch!.invokeCapabilityViaElectronAdapterOrch(request)
    expect(invokeMock).toHaveBeenCalledWith({
      vaultRoot: '/tmp/electron-test-vault',
      request,
    })
    expect(response).toEqual(expected)
  })

  it('creates and lists nodes through capability invocations', async () => {
    const fs = new FakeVaultFS()

    const { node: program } = await capabilityOrch!.invokeCapabilityOrThrow({
      capability: 'organizer.node.create',
      input: {
        type: 'program',
        title: 'Data Ingestion',
        projectRoot: 'projects/data-ingestion',
      },
      actor: ACTOR,
    }, { fs })

    await capabilityOrch!.invokeCapabilityOrThrow({
      capability: 'organizer.node.create',
      input: {
        type: 'epic',
        title: 'Backlog Polish',
        parentKey: program.key,
        parentUuid: program.uuid,
        parentType: 'program',
      },
      actor: ACTOR,
    }, { fs })

    const { nodes: roots } = await capabilityOrch!.invokeCapabilityOrThrow({
      capability: 'organizer.nodes.list_roots',
      input: { typeFilter: 'program' },
      actor: ACTOR,
    }, { fs })
    expect(roots.length).toBe(1)

    const { nodes: children } = await capabilityOrch!.invokeCapabilityOrThrow({
      capability: 'organizer.nodes.list_children',
      input: { parentKey: program.key },
      actor: ACTOR,
    }, { fs })
    expect(children.length).toBe(1)
    expect(children[0].type).toBe('epic')
  })

  it('reads, writes, and patches generic markdown notes safely', async () => {
    const fs = new FakeVaultFS()

    const written = await capabilityOrch!.invokeCapabilityOrThrow({
      capability: 'write_note',
      input: {
        path: 'lifeblood_systems/thinkingspace.ai/thoughts/2026-04-03.md',
        frontmatter: {
          title: 'AI Synthesis idea',
          tags: ['ai-synthesis'],
        },
        body: '# AI Synthesis\n\nInitial body.',
      },
      actor: ACTOR,
    }, { fs })

    expect(written.created).toBe(true)

    const patched = await capabilityOrch!.invokeCapabilityOrThrow({
      capability: 'patch_note_frontmatter',
      input: {
        path: 'lifeblood_systems/thinkingspace.ai/thoughts/2026-04-03.md',
        set: {
          related_concepts: ['reference-experiential-operational'],
        },
        append_unique: {
          tags: ['thinking-space', 'ai-synthesis'],
        },
      },
      actor: ACTOR,
    }, { fs })

    expect(patched.frontmatter.related_concepts).toEqual(['reference-experiential-operational'])
    expect(patched.frontmatter.tags).toEqual(['ai-synthesis', 'thinking-space'])

    const read = await capabilityOrch!.invokeCapabilityOrThrow({
      capability: 'read_note',
      input: {
        path: 'lifeblood_systems/thinkingspace.ai/thoughts/2026-04-03.md',
      },
      actor: ACTOR,
    }, { fs })

    expect(read.body).toBe('# AI Synthesis\n\nInitial body.')
    expect(read.frontmatter.title).toBe('AI Synthesis idea')
  })

  it('auto-derives wiki_links when AI synthesis notes are written or patched generically', async () => {
    const fs = new FakeVaultFS()

    const written = await capabilityOrch!.invokeCapabilityOrThrow({
      capability: 'write_note',
      input: {
        path: 'lifeblood_systems/Understanding Myself/AI Synthesis/Experiential/Period Summaries/2026-04.md',
        frontmatter: {
          title: 'April 2026',
          type: 'ai_synthesis',
          layer: 'experiential',
          synthesis_type: 'period_summary',
          derived_from: [
            'lifeblood_systems/Understanding Myself/sfdl/thoughts/2026-04-11.md',
          ],
        },
        body: '# April 2026',
      },
      actor: ACTOR,
    }, { fs })

    expect(written.frontmatter.wiki_links).toEqual([
      '[[lifeblood_systems/Understanding Myself/sfdl/thoughts/2026-04-11]]',
    ])

    const patched = await capabilityOrch!.invokeCapabilityOrThrow({
      capability: 'patch_note_frontmatter',
      input: {
        path: 'lifeblood_systems/Understanding Myself/AI Synthesis/Experiential/Period Summaries/2026-04.md',
        append_unique: {
          derived_from: [
            'lifeblood_systems/Understanding Myself/sfdl/thoughts/2026-04-12.md',
          ],
        },
      },
      actor: ACTOR,
    }, { fs })

    expect(patched.frontmatter.wiki_links).toEqual([
      '[[lifeblood_systems/Understanding Myself/sfdl/thoughts/2026-04-11]]',
      '[[lifeblood_systems/Understanding Myself/sfdl/thoughts/2026-04-12]]',
    ])
  })

  it('auto-derives wiki_links from source_files on generic note writes', async () => {
    const fs = new FakeVaultFS()

    const written = await capabilityOrch!.invokeCapabilityOrThrow({
      capability: 'write_note',
      input: {
        path: 'lifeblood_systems/Understanding Myself/AI Synthesis/Reference/Sources/sample.md',
        frontmatter: {
          title: 'Sample',
          source_files: [
            'acceleration_core/F9/Synthesis/FF08 Iterations/F9-iterations-overview.md',
            'acceleration_core/F9/Synthesis/Original-F9-freeform.md',
          ],
        },
        body: '# Sample',
      },
      actor: ACTOR,
    }, { fs })

    expect(written.frontmatter.wiki_links).toEqual([
      '[[acceleration_core/F9/Synthesis/FF08 Iterations/F9-iterations-overview]]',
      '[[acceleration_core/F9/Synthesis/Original-F9-freeform]]',
    ])
  })

  it('preserves already-formed wikilinks in source_files without double-wrapping', async () => {
    const fs = new FakeVaultFS()

    const written = await capabilityOrch!.invokeCapabilityOrThrow({
      capability: 'write_note',
      input: {
        path: 'lifeblood_systems/Understanding Myself/AI Synthesis/Reference/Sources/sample-2.md',
        frontmatter: {
          title: 'Sample 2',
          source_files: [
            '[[acceleration_core/F9/Synthesis/FF08 Iterations/F9-iterations-overview]]',
            'acceleration_core/F9/Synthesis/Original-F9-freeform.md',
            '[[acceleration_core/F9/Synthesis/FF08 Iterations/iterations/Mark 0/core strategy]]',
            '[[acceleration_core/F9/Synthesis/FF08 Iterations/learnings/reflections/April 2025/All Guiding Heuristics and learnings so far]]',
          ],
        },
        body: '# Sample 2',
      },
      actor: ACTOR,
    }, { fs })

    expect(written.frontmatter.wiki_links).toEqual([
      '[[acceleration_core/F9/Synthesis/FF08 Iterations/F9-iterations-overview]]',
      '[[acceleration_core/F9/Synthesis/Original-F9-freeform]]',
      '[[acceleration_core/F9/Synthesis/FF08 Iterations/iterations/Mark 0/core strategy]]',
      '[[acceleration_core/F9/Synthesis/FF08 Iterations/learnings/reflections/April 2025/All Guiding Heuristics and learnings so far]]',
    ])
  })

  it('coerces JSON-string array metadata into real YAML arrays before writing', async () => {
    const fs = new FakeVaultFS()

    const written = await capabilityOrch!.invokeCapabilityOrThrow({
      capability: 'write_note',
      input: {
        path: 'lifeblood_systems/Understanding Myself/AI Synthesis/Reference/Sources/sample-3.md',
        frontmatter: {
          title: 'Sample 3',
          source_files: '["[[acceleration_core/F9/Synthesis/Original-F9-freeform]]","acceleration_core/F9/Synthesis/FF08 Iterations/F9-iterations-overview.md"]',
          related_concepts: '["[[what-is-risk]]","[[mr-market]]"]',
        },
        body: '# Sample 3',
      },
      actor: ACTOR,
    }, { fs })

    expect(written.frontmatter.source_files).toEqual([
      '[[acceleration_core/F9/Synthesis/Original-F9-freeform]]',
      'acceleration_core/F9/Synthesis/FF08 Iterations/F9-iterations-overview.md',
    ])
    expect(written.frontmatter.related_concepts).toEqual([
      '[[what-is-risk]]',
      '[[mr-market]]',
    ])
    expect(written.frontmatter.wiki_links).toEqual([
      '[[acceleration_core/F9/Synthesis/Original-F9-freeform]]',
      '[[acceleration_core/F9/Synthesis/FF08 Iterations/F9-iterations-overview]]',
    ])

    const reread = await capabilityOrch!.invokeCapabilityOrThrow({
      capability: 'read_note',
      input: {
        path: 'lifeblood_systems/Understanding Myself/AI Synthesis/Reference/Sources/sample-3.md',
      },
      actor: ACTOR,
    }, { fs })

    expect(reread.frontmatter.source_files).toEqual(written.frontmatter.source_files)
    expect(reread.frontmatter.related_concepts).toEqual(written.frontmatter.related_concepts)
  })

  it('creates AI Synthesis note scaffolds at canonical paths', async () => {
    const fs = new FakeVaultFS()

    const resolved = await capabilityOrch!.invokeCapabilityOrThrow({
      capability: 'resolve_ai_synthesis_path',
      input: {
        domain_root: 'lifeblood_systems/Understanding Myself',
        layer: 'reference',
        synthesis_type: 'concept',
        slug: 'what-are-habits',
      },
      actor: ACTOR,
    }, { fs })

    expect(resolved.path).toBe('lifeblood_systems/Understanding Myself/AI Synthesis/Reference/Concepts/what-are-habits.md')

    const created = await capabilityOrch!.invokeCapabilityOrThrow({
      capability: 'create_ai_synthesis_note',
      input: {
        domain_root: 'lifeblood_systems/Understanding Myself',
        layer: 'reference',
        synthesis_type: 'concept',
        title: 'Concept - What Are Habits?',
        slug: 'what-are-habits',
        derived_from: [
          'lifeblood_systems/Understanding Myself/AI Synthesis/Reference/Sources/science-of-making-and-breaking-habits.md',
        ],
      },
      actor: ACTOR,
    }, { fs })

    expect(created.created).toBe(true)
    expect(created.path).toBe(resolved.path)
    expect(created.frontmatter.type).toBe('ai_synthesis')
    expect(created.frontmatter.compile_status).toBe('stub')
    expect(created.frontmatter.wiki_links).toEqual([
      '[[lifeblood_systems/Understanding Myself/AI Synthesis/Reference/Sources/science-of-making-and-breaking-habits]]',
    ])
    expect(created.body).toContain('# Concept - What Are Habits?')
  })

  it('resolves source-shaped and concept-shaped reference paths', async () => {
    const fs = new FakeVaultFS()

    const sourcePath = await capabilityOrch!.invokeCapabilityOrThrow({
      capability: 'resolve_ai_synthesis_path',
      input: {
        domain_root: 'lifeblood_systems/Understanding Myself',
        layer: 'reference',
        synthesis_type: 'source_summary',
        source_title: 'The Science of Making and Breaking Habits - Huberman',
        slug: 'limbic-friction',
      },
      actor: ACTOR,
    }, { fs })

    expect(sourcePath.path).toBe(
      'lifeblood_systems/Understanding Myself/AI Synthesis/Reference/Sources/The Science of Making and Breaking Habits - Huberman/limbic-friction.md',
    )

    const conceptPath = await capabilityOrch!.invokeCapabilityOrThrow({
      capability: 'resolve_ai_synthesis_path',
      input: {
        domain_root: 'lifeblood_systems/Understanding Myself',
        layer: 'reference',
        synthesis_type: 'concept',
        concept_root: 'Habits',
        concept_subpath: ['Formation'],
        slug: 'what-are-habits',
      },
      actor: ACTOR,
    }, { fs })

    expect(conceptPath.path).toBe(
      'lifeblood_systems/Understanding Myself/AI Synthesis/Reference/Concepts/Habits/Formation/what-are-habits.md',
    )
  })

  it('creates grouped AI Synthesis scaffolds for source and concept folders', async () => {
    const fs = new FakeVaultFS()

    const sourceSummary = await capabilityOrch!.invokeCapabilityOrThrow({
      capability: 'create_ai_synthesis_note',
      input: {
        domain_root: 'lifeblood_systems/Understanding Myself',
        layer: 'reference',
        synthesis_type: 'source_summary',
        source_title: 'The Science of Making and Breaking Habits - Huberman',
        title: 'Source Summary - Limbic Friction',
        slug: 'limbic-friction',
        derived_from: ['lifeblood_systems/Understanding Myself/raw/habits-huberman.md'],
      },
      actor: ACTOR,
    }, { fs })

    expect(sourceSummary.path).toBe(
      'lifeblood_systems/Understanding Myself/AI Synthesis/Reference/Sources/The Science of Making and Breaking Habits - Huberman/limbic-friction.md',
    )

    const concept = await capabilityOrch!.invokeCapabilityOrThrow({
      capability: 'create_ai_synthesis_note',
      input: {
        domain_root: 'lifeblood_systems/Understanding Myself',
        layer: 'reference',
        synthesis_type: 'concept',
        concept_root: 'Habits',
        concept_subpath: ['Formation'],
        title: 'Concept - What Are Habits?',
        slug: 'what-are-habits',
        derived_from: [sourceSummary.path],
      },
      actor: ACTOR,
    }, { fs })

    expect(concept.path).toBe(
      'lifeblood_systems/Understanding Myself/AI Synthesis/Reference/Concepts/Habits/Formation/what-are-habits.md',
    )
    expect(concept.frontmatter.wiki_links).toEqual([
      '[[lifeblood_systems/Understanding Myself/AI Synthesis/Reference/Sources/The Science of Making and Breaking Habits - Huberman/limbic-friction]]',
    ])
  })

  it('plans impacted AI Synthesis notes from changed raw notes', async () => {
    const fs = new FakeVaultFS()

    await capabilityOrch!.invokeCapabilityOrThrow({
      capability: 'write_note',
      input: {
        path: 'lifeblood_systems/Understanding Myself/thoughts/2025-12-19.md',
        frontmatter: {
          title: 'Habits reflection',
          kind: 'thought',
        },
        body: '# Habits reflection',
      },
      actor: ACTOR,
    }, { fs })

    await capabilityOrch!.invokeCapabilityOrThrow({
      capability: 'create_ai_synthesis_note',
      input: {
        domain_root: 'lifeblood_systems/Understanding Myself',
        layer: 'experiential',
        synthesis_type: 'pattern',
        title: 'Pattern - Habits',
        slug: 'habits',
        derived_from: ['lifeblood_systems/Understanding Myself/thoughts/2025-12-19.md'],
      },
      actor: ACTOR,
    }, { fs })

    const impacted = await capabilityOrch!.invokeCapabilityOrThrow({
      capability: 'get_impacted_ai_synthesis_notes',
      input: {
        changed_paths: ['lifeblood_systems/Understanding Myself/thoughts/2025-12-19.md'],
      },
      actor: ACTOR,
    }, { fs })

    expect(impacted.domain_root).toBe('lifeblood_systems/Understanding Myself')
    expect(impacted.likely_impacted).toContain('lifeblood_systems/Understanding Myself/AI Synthesis/Experiential/Patterns/habits.md')
    expect(impacted.missing_candidates).toContain('lifeblood_systems/Understanding Myself/AI Synthesis/Questions/open-questions.md')
  })

  it('updates compile state and reports health findings for a domain', async () => {
    const fs = new FakeVaultFS()

    await capabilityOrch!.invokeCapabilityOrThrow({
      capability: 'create_ai_synthesis_note',
      input: {
        domain_root: 'acceleration_core/F9',
        layer: 'reference',
        synthesis_type: 'concept',
        title: 'Concept - Moats',
        slug: 'moats',
        derived_from: ['acceleration_core/F9/learnings/moats.md'],
      },
      actor: ACTOR,
    }, { fs })

    await capabilityOrch!.invokeCapabilityOrThrow({
      capability: 'update_ai_synthesis_compile_state',
      input: {
        path: 'acceleration_core/F9/AI Synthesis/Reference/Concepts/moats.md',
        compile_status: 'stale',
      },
      actor: ACTOR,
    }, { fs })

    await capabilityOrch!.invokeCapabilityOrThrow({
      capability: 'write_note',
      input: {
        path: 'acceleration_core/F9/AI Synthesis/Outputs/Answers/what-is-a-moat.md',
        frontmatter: {
          title: 'Answer - What Is A Moat?',
        },
        body: '# Answer',
      },
      actor: ACTOR,
    }, { fs })

    const health = await capabilityOrch!.invokeCapabilityOrThrow({
      capability: 'list_domain_ai_synthesis_health',
      input: {
        domain_root: 'acceleration_core/F9',
      },
      actor: ACTOR,
    }, { fs })

    expect(health.stale_pages).toContain('acceleration_core/F9/AI Synthesis/Reference/Concepts/moats.md')
    expect(health.missing_canonical_pages).toContain('acceleration_core/F9/AI Synthesis/index.md')
    expect(health.orphan_outputs).toContain('acceleration_core/F9/AI Synthesis/Outputs/Answers/what-is-a-moat.md')
  })

  it('writes structured comment metadata on update', async () => {
    const fs = new FakeVaultFS()

    const { node: thought } = await capabilityOrch!.invokeCapabilityOrThrow({
      capability: 'organizer.node.create',
      input: {
        type: 'thought',
        title: 'Capture findings',
        projectRoot: 'projects/data-ingestion',
      },
      actor: ACTOR,
    }, { fs })

    await capabilityOrch!.invokeCapabilityOrThrow({
      capability: 'organizer.node.update',
      input: {
        uuid: thought.uuid,
        updates: {
          comments: ['Need validation numbers'],
        },
      },
      actor: ACTOR,
    }, { fs })

    // Comments are stored in the markdown body (never frontmatter) and
    // surfaced on the synced node record.
    const { frontmatter } = await capabilityOrch!.invokeCapabilityOrThrow({
      capability: 'organizer.node.read_frontmatter',
      input: { filePath: thought.filePath },
      actor: ACTOR,
    }, { fs })
    expect(frontmatter).not.toBeNull()
    expect(frontmatter!.comments).toBeUndefined()

    const { node: updatedThought } = await capabilityOrch!.invokeCapabilityOrThrow({
      capability: 'organizer.node.get',
      input: { uuid: thought.uuid },
      actor: ACTOR,
    }, { fs })
    expect(updatedThought?.comments?.[0].text).toBe('Need validation numbers')
    expect(updatedThought?.comments?.[0].added_by).toBe('unknown')
    expect(updatedThought?.comments?.[0].added_at).toBeTruthy()
  })

  it('derives epic status from descendant task statuses', async () => {
    const fs = new FakeVaultFS()

    const { node: program } = await capabilityOrch!.invokeCapabilityOrThrow({
      capability: 'organizer.node.create',
      input: {
        type: 'program',
        title: 'Ops Program',
        projectRoot: 'projects/ops',
      },
      actor: ACTOR,
    }, { fs })

    const { node: epic } = await capabilityOrch!.invokeCapabilityOrThrow({
      capability: 'organizer.node.create',
      input: {
        type: 'epic',
        title: 'Policy Engine',
        parentKey: program.key,
        parentUuid: program.uuid,
        parentType: 'program',
      },
      actor: ACTOR,
    }, { fs })

    const { node: task } = await capabilityOrch!.invokeCapabilityOrThrow({
      capability: 'organizer.node.create',
      input: {
        type: 'idea',
        title: 'Task A',
        parentKey: epic.key,
        parentUuid: epic.uuid,
        parentType: 'epic',
        extraFields: {
          record_kind: 'task',
          task_status: 'done',
        },
      },
      actor: ACTOR,
    }, { fs })

    const { node: epicAfterDone } = await capabilityOrch!.invokeCapabilityOrThrow({
      capability: 'organizer.node.get',
      input: { uuid: epic.uuid },
      actor: ACTOR,
    }, { fs })
    expect(epicAfterDone?.status).toBe('completed')

    await capabilityOrch!.invokeCapabilityOrThrow({
      capability: 'task.update_status',
      input: {
        uuid: task.uuid,
        taskStatus: 'in_progress',
      },
      actor: ACTOR,
    }, { fs })

    const { node: epicAfterActive } = await capabilityOrch!.invokeCapabilityOrThrow({
      capability: 'organizer.node.get',
      input: { uuid: epic.uuid },
      actor: ACTOR,
    }, { fs })
    expect(epicAfterActive?.status).toBe('active')
  })

  // Manual epic status edits are honored as overrides: the update skips the
  // derived-status policy for that epic (skipEpicKeys) and stamps
  // epic_completed_at when completing.
  it('honors manual epic status edits over derived status', async () => {
    const fs = new FakeVaultFS()

    const { node: program } = await capabilityOrch!.invokeCapabilityOrThrow({
      capability: 'organizer.node.create',
      input: {
        type: 'program',
        title: 'Ops Program',
        projectRoot: 'projects/ops',
      },
      actor: ACTOR,
    }, { fs })

    const { node: epic } = await capabilityOrch!.invokeCapabilityOrThrow({
      capability: 'organizer.node.create',
      input: {
        type: 'epic',
        title: 'Manual Override Guard',
        parentKey: program.key,
        parentUuid: program.uuid,
        parentType: 'program',
      },
      actor: ACTOR,
    }, { fs })

    await capabilityOrch!.invokeCapabilityOrThrow({
      capability: 'organizer.node.create',
      input: {
        type: 'idea',
        title: 'Task A',
        parentKey: epic.key,
        parentUuid: epic.uuid,
        parentType: 'epic',
        extraFields: {
          record_kind: 'task',
          task_status: 'in_progress',
        },
      },
      actor: ACTOR,
    }, { fs })

    await capabilityOrch!.invokeCapabilityOrThrow({
      capability: 'organizer.node.update',
      input: {
        uuid: epic.uuid,
        updates: {
          status: 'completed',
        },
      },
      actor: ACTOR,
    }, { fs })

    const { node: epicAfterUpdate } = await capabilityOrch!.invokeCapabilityOrThrow({
      capability: 'organizer.node.get',
      input: { uuid: epic.uuid },
      actor: ACTOR,
    }, { fs })
    expect(epicAfterUpdate?.status).toBe('completed')
    expect(epicAfterUpdate?.epicCompletedAt).toBeTruthy()
  })

  it('supports dry-run preview for move without persisting', async () => {
    const fs = new FakeVaultFS()

    const { node: programA } = await capabilityOrch!.invokeCapabilityOrThrow({
      capability: 'organizer.node.create',
      input: {
        type: 'program',
        title: 'Program A',
        projectRoot: 'projects/a',
      },
      actor: ACTOR,
    }, { fs })

    const { node: programB } = await capabilityOrch!.invokeCapabilityOrThrow({
      capability: 'organizer.node.create',
      input: {
        type: 'program',
        title: 'Program B',
        projectRoot: 'projects/b',
      },
      actor: ACTOR,
    }, { fs })

    const { node: epic } = await capabilityOrch!.invokeCapabilityOrThrow({
      capability: 'organizer.node.create',
      input: {
        type: 'epic',
        title: 'Epic 1',
        parentKey: programA.key,
        parentUuid: programA.uuid,
        parentType: 'program',
      },
      actor: ACTOR,
    }, { fs })

    const dryRun = await capabilityOrch!.invokeCapabilityOrch({
      capability: 'organizer.node.move',
      input: {
        uuid: epic.uuid,
        newParentKey: programB.key,
      },
      actor: ACTOR,
      dryRun: true,
    }, { fs })

    expect(dryRun.ok).toBe(true)
    if (!dryRun.ok) throw new Error('Expected dry-run response to succeed')
    expect(dryRun.data.preview?.fromParentKey).toBe(programA.key)
    expect(dryRun.data.preview?.toParentKey).toBe(programB.key)
    expect(dryRun.warnings[0]).toContain('Dry-run')

    const { nodes: stillUnderA } = await capabilityOrch!.invokeCapabilityOrThrow({
      capability: 'organizer.nodes.list_children',
      input: { parentKey: programA.key },
      actor: ACTOR,
    }, { fs })
    expect(stillUnderA.some(node => node.uuid === epic.uuid)).toBe(true)

    const { nodes: underB } = await capabilityOrch!.invokeCapabilityOrThrow({
      capability: 'organizer.nodes.list_children',
      input: { parentKey: programB.key },
      actor: ACTOR,
    }, { fs })
    expect(underB.some(node => node.uuid === epic.uuid)).toBe(false)
  })

  it('supports dry-run preview for delete without persisting', async () => {
    const fs = new FakeVaultFS()

    const { node } = await capabilityOrch!.invokeCapabilityOrThrow({
      capability: 'organizer.node.create',
      input: {
        type: 'thought',
        title: 'Delete candidate',
        projectRoot: 'projects/data-ingestion',
      },
      actor: ACTOR,
    }, { fs })

    const dryRun = await capabilityOrch!.invokeCapabilityOrch({
      capability: 'organizer.node.delete',
      input: {
        uuid: node.uuid,
      },
      actor: ACTOR,
      dryRun: true,
    }, { fs })

    expect(dryRun.ok).toBe(true)
    if (!dryRun.ok) throw new Error('Expected dry-run response to succeed')
    expect(dryRun.data.deleted).toBe(true)
    expect(dryRun.data.preview?.nodeUuid).toBe(node.uuid)

    const { node: stillThere } = await capabilityOrch!.invokeCapabilityOrThrow({
      capability: 'organizer.node.get',
      input: { uuid: node.uuid },
      actor: ACTOR,
    }, { fs })
    expect(stillThere).not.toBeNull()
  })

  it('writes capability audit entries', async () => {
    const fs = new FakeVaultFS()

    await capabilityOrch!.invokeCapabilityOrThrow({
      capability: 'organizer.node.create',
      input: {
        type: 'program',
        title: 'Audit Program',
        projectRoot: 'projects/audit',
      },
      actor: ACTOR,
    }, { fs })

    const log = await fs.read('.thinking-space/audit/capability-audit.log')
    const lines = log.split('\n').filter(Boolean)
    expect(lines.length).toBeGreaterThan(0)

    const latest = JSON.parse(lines[lines.length - 1]) as { capability: string; ok: boolean; auditId: string }
    expect(latest.capability).toBe('organizer.node.create')
    expect(latest.ok).toBe(true)
    expect(latest.auditId).toContain('audit-')
  })

  it('supports extra orchestration fields on create/update', async () => {
    const fs = new FakeVaultFS()

    const { node } = await capabilityOrch!.invokeCapabilityOrThrow({
      capability: 'organizer.node.create',
      input: {
        type: 'idea',
        title: 'Agent Task',
        projectRoot: 'projects/agent',
        extraFields: {
          record_kind: 'task',
          task_id: 'LTM-500',
          custom_scope: 'agent-native',
        },
      },
      actor: ACTOR,
    }, { fs })

    await capabilityOrch!.invokeCapabilityOrThrow({
      capability: 'organizer.node.update',
      input: {
        uuid: node.uuid,
        updates: {
          extraFields: {
            task_status: 'blocked',
            custom_scope: null,
          },
        },
      },
      actor: ACTOR,
    }, { fs })

    const { frontmatter } = await capabilityOrch!.invokeCapabilityOrThrow({
      capability: 'organizer.node.read_frontmatter',
      input: { filePath: node.filePath },
      actor: ACTOR,
    }, { fs })

    expect(frontmatter).not.toBeNull()
    expect(frontmatter!.record_kind).toBe('task')
    expect(frontmatter!.task_id).toBe('LTM-500')
    expect(frontmatter!.task_status).toBe('blocked')
    expect(frontmatter!.custom_scope).toBeUndefined()
  })

  it('supports task claim/status update and comment add capabilities', async () => {
    const fs = new FakeVaultFS()

    const { node: task } = await capabilityOrch!.invokeCapabilityOrThrow({
      capability: 'organizer.node.create',
      input: {
        type: 'idea',
        title: 'Migration Task',
        projectRoot: 'coding-projects/thinking-space',
        extraFields: {
          record_kind: 'task',
          task_id: 'LTM-900',
          task_status: 'ready',
          schema_version: '2',
        },
      },
      actor: ACTOR,
    }, { fs })

    const claimed = await capabilityOrch!.invokeCapabilityOrThrow({
      capability: 'task.claim',
      input: {
        uuid: task.uuid,
        owner: 'codex-gpt5',
        note: 'Claimed for migration execution',
      },
      actor: ACTOR,
    }, { fs })
    expect(claimed.node.owner).toBe('codex-gpt5')
    expect(claimed.node.taskStatus).toBe('in_progress')

    const statusUpdated = await capabilityOrch!.invokeCapabilityOrThrow({
      capability: 'task.update_status',
      input: {
        uuid: task.uuid,
        taskStatus: 'done',
      },
      actor: ACTOR,
    }, { fs })
    expect(statusUpdated.node.taskStatus).toBe('done')

    const commented = await capabilityOrch!.invokeCapabilityOrThrow({
      capability: 'comment.add',
      input: {
        uuid: task.uuid,
        text: 'Completed migration bootstrap.',
      },
      actor: ACTOR,
    }, { fs })
    expect(commented.node.comments?.some(comment => comment.text.includes('Completed migration bootstrap.'))).toBe(true)
  })

  it('supports run.log and handoff.create capabilities', async () => {
    const fs = new FakeVaultFS()

    const { node: run } = await capabilityOrch!.invokeCapabilityOrThrow({
      capability: 'run.log',
      input: {
        title: 'Migration Run 001',
        projectRoot: 'coding-projects/thinking-space',
        result: 'success',
        sourceRepo: 'Thinking-Space',
        branch: 'main',
        commit: '251c328',
        artifacts: ['thinking-organizer/ideas'],
      },
      actor: ACTOR,
    }, { fs })
    expect(run.recordKind).toBe('run')
    expect(run.type).toBe('run')
    expect(run.result).toBe('success')

    const { node: handoff } = await capabilityOrch!.invokeCapabilityOrThrow({
      capability: 'handoff.create',
      input: {
        title: 'Migration Handoff',
        projectRoot: 'coding-projects/thinking-space',
        fromAgent: 'codex',
        toAgent: 'claude',
        summary: 'Workspace imported and validated.',
        sourceRepo: 'Thinking-Space',
        branch: 'main',
        commit: '251c328',
      },
      actor: ACTOR,
    }, { fs })
    expect(handoff.recordKind).toBe('handoff')
    expect(handoff.type).toBe('handoff')
    expect(handoff.description).toBe('Workspace imported and validated.')
    expect(handoff.filePath).toContain('handoffs/')
  })

  it('rejects handoff.create when summary is missing', async () => {
    const fs = new FakeVaultFS()
    await expect(capabilityOrch!.invokeCapabilityOrThrow({
      capability: 'handoff.create',
      input: {
        title: 'Invalid Handoff',
        projectRoot: 'coding-projects/thinking-space',
        fromAgent: 'codex',
        toAgent: 'claude',
      },
      actor: ACTOR,
    }, { fs })).rejects.toThrow('Missing required field: summary')
  })

  it('reports and fixes status policy integrity violations', async () => {
    const fs = new FakeVaultFS()
    const integrity = await import('@/services/orchestrators/organizerIntegrityOrch')
    const hierarchy = await import('@/services/lego_blocks/integrations/yamlHierarchyBlock')

    const { node: program } = await capabilityOrch!.invokeCapabilityOrThrow({
      capability: 'organizer.node.create',
      input: {
        type: 'program',
        title: 'Ops Program',
        projectRoot: 'projects/ops',
      },
      actor: ACTOR,
    }, { fs })

    const { node: epic } = await capabilityOrch!.invokeCapabilityOrThrow({
      capability: 'organizer.node.create',
      input: {
        type: 'epic',
        title: 'Integrity Epic',
        parentKey: program.key,
        parentUuid: program.uuid,
        parentType: 'program',
      },
      actor: ACTOR,
    }, { fs })

    const { node: task } = await capabilityOrch!.invokeCapabilityOrThrow({
      capability: 'organizer.node.create',
      input: {
        type: 'idea',
        title: 'Integrity Task',
        parentKey: epic.key,
        parentUuid: epic.uuid,
        parentType: 'epic',
        extraFields: {
          record_kind: 'task',
          task_status: 'done',
        },
      },
      actor: ACTOR,
    }, { fs })

    await hierarchy.updateYamlNode(task.uuid, {
      status: 'active',
      extraFields: {
        record_kind: 'task',
        task_status: 'done',
      },
    }, fs)

    await hierarchy.updateYamlNode(epic.uuid, { status: 'active' }, fs)

    const reportBefore = await integrity.runOrganizerIntegrityCheck({
      fs,
      includeLegacyFieldScan: false,
    })
    expect(reportBefore.issues.some(issue => issue.kind === 'task_status_drift')).toBe(true)
    expect(reportBefore.issues.some(issue => issue.kind === 'epic_status_violation')).toBe(true)

    const applied = await integrity.applyOrganizerStatusPolicy({ fs })
    expect(applied.taskUpdates).toBeGreaterThan(0)
    expect(applied.epicUpdates).toBeGreaterThan(0)

    const reportAfter = await integrity.runOrganizerIntegrityCheck({
      fs,
      includeLegacyFieldScan: false,
    })
    expect(reportAfter.issues.some(issue => issue.kind === 'task_status_drift')).toBe(false)
    expect(reportAfter.issues.some(issue => issue.kind === 'epic_status_violation')).toBe(false)
  })
})

function installWindowAndStorageShims(): void {
  const globalRecord = globalThis as typeof globalThis & {
    window?: Record<string, unknown>
    localStorage?: {
      getItem(key: string): string | null
      setItem(key: string, value: string): void
      removeItem(key: string): void
      clear(): void
    }
  }

  if (!globalRecord.window) {
    globalRecord.window = {}
  }

  const store = new Map<string, string>()
  globalRecord.localStorage = {
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null
    },
    setItem(key: string, value: string) {
      store.set(key, value)
    },
    removeItem(key: string) {
      store.delete(key)
    },
    clear() {
      store.clear()
    },
  }
}
