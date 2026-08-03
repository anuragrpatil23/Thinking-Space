import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ListedFiles, VaultEntry, VaultFS, VaultStat } from '@/services/lego_blocks/integrations/fsBlock'
import { createNote, parseNote, stringifyNote } from '@/services/lego_blocks/units/yamlNoteBlock'

class FakeVaultFS implements VaultFS {
  private readonly files = new Map<string, string>()
  private readonly mtimes = new Map<string, number>()
  private readonly dirs = new Set<string>([''])

  seedFile(path: string, content: string): void {
    const normalized = this.normalize(path)
    this.files.set(normalized, content)
    this.mtimes.set(normalized, Date.now() / 1000)
    this.ensureParentDirs(normalized)
  }

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

let fakeIdb: typeof import('fake-indexeddb') | null = null

beforeEach(async () => {
  fakeIdb = await import('fake-indexeddb')
  globalThis.indexedDB = fakeIdb.default
  globalThis.IDBKeyRange = fakeIdb.IDBKeyRange as any
})

afterEach(async () => {
  const { deleteDb } = await import('@/services/lego_blocks/integrations/dbBlock')
  await deleteDb()
})

function seedBaseHierarchy(fs: FakeVaultFS) {
  const program = createNote({ type: 'program', title: 'Personal Growth' })
  const epic = createNote({
    type: 'epic',
    title: 'Build Thinking Space',
    parent: program.frontmatter.key,
    parent_uuid: program.frontmatter.uuid,
    parent_type: 'program',
  })

  fs.seedFile('programs/program-personal-growth.md', stringifyNote(program))
  fs.seedFile('epics/epic-build-thinking-space.md', stringifyNote(epic))

  return { program, epic }
}

describe('thinkingOrganizerDropOrch', () => {
  it('converts dropped plain markdown into YAML and reparents to target node', async () => {
    const fs = new FakeVaultFS()
    const { epic } = seedBaseHierarchy(fs)
    fs.seedFile('inbox/weekly-reflection.md', '# Weekly Reflection\n\nKey updates this week.')

    const { fullSync } = await import('@/services/orchestrators/vaultSyncOrch')
    const { getNodeByKey, getNodeByPath } = await import('@/services/lego_blocks/integrations/dbBlock')
    const { dropPathToYamlNodeOrch } = await import('@/services/orchestrators/thinkingOrganizerDropOrch')

    await fullSync(fs)
    const target = await getNodeByKey(epic.frontmatter.key)
    expect(target).toBeDefined()

    const result = await dropPathToYamlNodeOrch({
      targetNode: target!,
      droppedPath: 'inbox/weekly-reflection.md',
      fs,
    })

    expect(result.mappedCount).toBe(1)
    expect(result.failureCount).toBe(0)

    const dropped = parseNote(await fs.read('inbox/weekly-reflection.md'))
    expect(dropped).not.toBeNull()
    expect(dropped!.frontmatter.type).toBe('thought')
    expect(dropped!.frontmatter.parent).toBe(epic.frontmatter.key)
    expect(dropped!.frontmatter.parent_uuid).toBe(epic.frontmatter.uuid)
    expect(dropped!.frontmatter.parent_type).toBe('epic')

    const droppedNode = await getNodeByPath('inbox/weekly-reflection.md')
    expect(droppedNode).toBeDefined()
    expect(droppedNode!.parent).toBe(epic.frontmatter.key)

  })

  it('maps only markdown files when dropping a folder', async () => {
    const fs = new FakeVaultFS()
    const { epic } = seedBaseHierarchy(fs)
    fs.seedFile('inbox/notes/a.md', '# A\n\nAlpha')
    fs.seedFile('inbox/notes/b.txt', 'not markdown')
    fs.seedFile('inbox/notes/sub/c.md', '# C\n\nCharlie')

    const { fullSync } = await import('@/services/orchestrators/vaultSyncOrch')
    const { getNodeByKey, getNodeByPath } = await import('@/services/lego_blocks/integrations/dbBlock')
    const { dropPathToYamlNodeOrch } = await import('@/services/orchestrators/thinkingOrganizerDropOrch')

    await fullSync(fs)
    const target = await getNodeByKey(epic.frontmatter.key)
    expect(target).toBeDefined()

    const result = await dropPathToYamlNodeOrch({
      targetNode: target!,
      droppedPath: 'inbox/notes',
      fs,
    })

    expect(result.mappedCount).toBe(2)
    expect(result.skippedCount).toBe(1)
    expect(result.failureCount).toBe(0)

    const aNode = await getNodeByPath('inbox/notes/a.md')
    const cNode = await getNodeByPath('inbox/notes/sub/c.md')
    expect(aNode?.parent).toBe(epic.frontmatter.key)
    expect(cNode?.parent).toBe(epic.frontmatter.key)
  })

  it('reparents existing YAML node files without regenerating identity', async () => {
    const fs = new FakeVaultFS()
    const { epic } = seedBaseHierarchy(fs)

    const idea = createNote({
      type: 'idea',
      title: 'Hierarchy UI',
      parent: epic.frontmatter.key,
      parent_uuid: epic.frontmatter.uuid,
      parent_type: 'epic',
    })
    const thought = createNote({
      type: 'thought',
      title: 'Drag and Drop Notes',
      parent: idea.frontmatter.key,
      parent_uuid: idea.frontmatter.uuid,
      parent_type: 'idea',
    })

    fs.seedFile('ideas/idea-hierarchy-ui.md', stringifyNote(idea))
    fs.seedFile('thoughts/thought-dnd-notes.md', stringifyNote(thought))

    const { fullSync } = await import('@/services/orchestrators/vaultSyncOrch')
    const { getNodeByKey } = await import('@/services/lego_blocks/integrations/dbBlock')
    const { dropPathToYamlNodeOrch } = await import('@/services/orchestrators/thinkingOrganizerDropOrch')

    await fullSync(fs)
    const target = await getNodeByKey(epic.frontmatter.key)
    const existingThought = await getNodeByKey(thought.frontmatter.key)
    expect(target).toBeDefined()
    expect(existingThought).toBeDefined()

    const result = await dropPathToYamlNodeOrch({
      targetNode: target!,
      droppedPath: 'thoughts/thought-dnd-notes.md',
      fs,
    })

    expect(result.mappedCount).toBe(1)
    expect(result.failureCount).toBe(0)

    const movedThought = parseNote(await fs.read('thoughts/thought-dnd-notes.md'))
    expect(movedThought).not.toBeNull()
    expect(movedThought!.frontmatter.uuid).toBe(thought.frontmatter.uuid)
    expect(movedThought!.frontmatter.parent).toBe(epic.frontmatter.key)

  })
})
