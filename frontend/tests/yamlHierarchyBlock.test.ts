import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ListedFiles, VaultEntry, VaultFS, VaultStat } from '@/services/lego_blocks/integrations/fsBlock'
import { generateKey, parseNote } from '@/services/lego_blocks/units/yamlNoteBlock'
import { parseOrganizerBodySections } from '@/services/lego_blocks/integrations/organizerBodyBlock'

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

describe('yamlHierarchyBlock project storage', () => {
  it('stores a program under the selected project thinking-organizer folder', async () => {
    const fs = new FakeVaultFS()
    const { createYamlNode } = await import('@/services/lego_blocks/integrations/yamlHierarchyBlock')

    const program = await createYamlNode({
      type: 'program',
      title: 'Delta Initiative',
      projectRoot: 'projects/delta',
      fs,
    })

    expect(program.filePath.startsWith('projects/delta/thinking-organizer/programs/program-')).toBe(true)
    const note = parseNote(await fs.read(program.filePath))
    expect(note).not.toBeNull()
    expect(note!.frontmatter.project_root).toBe('projects/delta')
    expect(note!.frontmatter.title).toMatch(/^DE-DI-P-\d{3} - Delta Initiative$/)
    expect(note!.frontmatter.key).toBe(generateKey(note!.frontmatter.title))
    expect(program.filePath).toBe(`projects/delta/thinking-organizer/programs/program-${note!.frontmatter.key}.md`)
  })

  it('inherits project_root for child nodes and stores them in the same project organizer folder', async () => {
    const fs = new FakeVaultFS()
    const { createYamlNode } = await import('@/services/lego_blocks/integrations/yamlHierarchyBlock')

    const program = await createYamlNode({
      type: 'program',
      title: 'Delta Initiative',
      projectRoot: 'projects/delta',
      fs,
    })

    const epic = await createYamlNode({
      type: 'epic',
      title: 'Polish Backlog UX',
      parentKey: program.key,
      parentUuid: program.uuid,
      parentType: 'program',
      fs,
    })

    expect(epic.filePath.startsWith('projects/delta/thinking-organizer/epics/epic-')).toBe(true)
    const epicNote = parseNote(await fs.read(epic.filePath))
    expect(epicNote).not.toBeNull()
    expect(epicNote!.frontmatter.project_root).toBe('projects/delta')
    expect(epicNote!.frontmatter.title).toMatch(/^DE-DI-E-\d{3} - Polish Backlog UX$/)
    expect(epicNote!.frontmatter.key).toBe(generateKey(epicNote!.frontmatter.title))
    expect(epic.filePath).toBe(`projects/delta/thinking-organizer/epics/epic-${epicNote!.frontmatter.key}.md`)
    expect(epicNote!.frontmatter.parent).toBe(program.key)
    expect(epicNote!.frontmatter.wiki_links).toEqual([
      `[[${program.filePath.slice(0, -3)}]]`,
    ])
  })

  it('writes description and comments into frontmatter and markdown body when creating a node', async () => {
    const fs = new FakeVaultFS()
    const { createYamlNode } = await import('@/services/lego_blocks/integrations/yamlHierarchyBlock')

    const thought = await createYamlNode({
      type: 'thought',
      title: 'Capture Postmortem',
      projectRoot: 'projects/delta',
      description: 'Record what worked and what failed in this sprint.',
      comments: ['Need numbers from analytics before finalizing.'],
      fs,
    })

    const note = parseNote(await fs.read(thought.filePath))
    expect(note).not.toBeNull()
    expect(note!.frontmatter.description).toBe('Record what worked and what failed in this sprint.')
    // Comments live in the markdown body only — never frontmatter.
    expect(note!.frontmatter.comments).toBeUndefined()
    expect(note!.body).toContain('## Description')
    expect(note!.body).toContain('## Comments')

    const sections = parseOrganizerBodySections(note!.body)
    expect(sections.description).toBe('Record what worked and what failed in this sprint.')
    expect(sections.comments.length).toBe(1)
    expect(sections.comments[0].text).toBe('Need numbers from analytics before finalizing.')
    expect(sections.comments[0].added_by).toBe('unknown')
    expect(sections.comments[0].added_at).toBeTruthy()
  })

  it('updates description and comments after create', async () => {
    const fs = new FakeVaultFS()
    const { createYamlNode, updateYamlNode } = await import('@/services/lego_blocks/integrations/yamlHierarchyBlock')

    const idea = await createYamlNode({
      type: 'idea',
      title: 'Streamline intake',
      projectRoot: 'projects/delta',
      fs,
    })

    const updated = await updateYamlNode(
      idea.uuid,
      {
        description: 'Refine intake prompts and simplify intake states.',
        comments: ['Capture current drop-off metrics', 'Validate with PM before rollout'],
      },
      fs,
    )

    expect(updated.description).toBe('Refine intake prompts and simplify intake states.')
    expect(updated.comments?.map(comment => comment.text)).toEqual([
      'Capture current drop-off metrics',
      'Validate with PM before rollout',
    ])
    expect(updated.comments?.every(comment => comment.added_by === 'unknown')).toBe(true)
    expect(updated.comments?.every(comment => Boolean(comment.added_at))).toBe(true)

    const note = parseNote(await fs.read(updated.filePath))
    expect(note).not.toBeNull()
    expect(note!.frontmatter.description).toBe('Refine intake prompts and simplify intake states.')
    // Comments live in the markdown body only — never frontmatter.
    expect(note!.frontmatter.comments).toBeUndefined()

    const sections = parseOrganizerBodySections(note!.body)
    expect(sections.description).toBe('Refine intake prompts and simplify intake states.')
    expect(sections.comments.map(comment => comment.text)).toEqual([
      'Capture current drop-off metrics',
      'Validate with PM before rollout',
    ])
    expect(sections.comments.every(comment => comment.added_by === 'unknown')).toBe(true)
    expect(sections.comments.every(comment => Boolean(comment.added_at))).toBe(true)
  })

  it('updates generated obsidian hierarchy links when a node is moved', async () => {
    const fs = new FakeVaultFS()
    const { createYamlNode, moveYamlNode } = await import('@/services/lego_blocks/integrations/yamlHierarchyBlock')

    const programA = await createYamlNode({
      type: 'program',
      title: 'Program A',
      projectRoot: 'projects/a',
      fs,
    })

    const programB = await createYamlNode({
      type: 'program',
      title: 'Program B',
      projectRoot: 'projects/b',
      fs,
    })

    const epic = await createYamlNode({
      type: 'epic',
      title: 'Epic 1',
      parentKey: programA.key,
      parentUuid: programA.uuid,
      parentType: 'program',
      fs,
    })

    const moved = await moveYamlNode(epic.uuid, programB.key, fs)
    const movedNote = parseNote(await fs.read(moved.filePath))
    expect(movedNote).not.toBeNull()
    expect(movedNote!.frontmatter.parent).toBe(programB.key)
    expect(movedNote!.frontmatter.wiki_links).toEqual([
      `[[${programB.filePath.slice(0, -3)}]]`,
    ])

    const detached = await moveYamlNode(epic.uuid, null, fs)
    const detachedNote = parseNote(await fs.read(detached.filePath))
    expect(detachedNote).not.toBeNull()
    expect(detachedNote!.frontmatter.parent).toBeUndefined()
    expect(detachedNote!.frontmatter.wiki_links).toBeUndefined()
  })
})
