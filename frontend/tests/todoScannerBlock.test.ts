import { describe, expect, it } from 'vitest'
import type { ListedFiles, VaultFS, VaultStat, VaultEntry } from '@/services/lego_blocks/integrations/fsBlock'
import { parseNote } from '@/services/lego_blocks/units/yamlNoteBlock'
import { createTodo, getTodosMonth } from '@/services/lego_blocks/integrations/todoScannerBlock'

class FakeVaultFS implements VaultFS {
  constructor(
    private readonly directoryMap: Record<string, ListedFiles>,
    private readonly fileMap: Record<string, string>,
  ) {}

  async read(path: string): Promise<string> {
    if (!(path in this.fileMap)) throw new Error(`Missing file: ${path}`)
    return this.fileMap[path]
  }

  async write(): Promise<void> {
    throw new Error('Not implemented in test')
  }

  async create(): Promise<void> {
    throw new Error('Not implemented in test')
  }

  async list(path: string): Promise<ListedFiles> {
    return this.directoryMap[path] ?? { files: [], folders: [] }
  }

  async walkVault(): Promise<VaultEntry[]> {
    throw new Error('Not implemented in test')
  }

  async stat(): Promise<VaultStat> {
    throw new Error('Not implemented in test')
  }

  async exists(): Promise<boolean> {
    throw new Error('Not implemented in test')
  }

  async mkdir(): Promise<void> {
    throw new Error('Not implemented in test')
  }

  async process(): Promise<void> {
    throw new Error('Not implemented in test')
  }

  // Binary reads/writes and delete: no test here exercises them. They exist so
  // the double actually satisfies VaultFS — a double that doesn't is invisible
  // to the typechecker, which is what let renames rot in tests unnoticed.
  async readBytes(): Promise<Uint8Array> {
    throw new Error('readBytes is not implemented by this test double')
  }

  async writeBytes(): Promise<void> {
    throw new Error('writeBytes is not implemented by this test double')
  }

  async delete(_p: string): Promise<void> {
    throw new Error('delete is not implemented by this test double')
  }
}

class MutableVaultFS implements VaultFS {
  private readonly files = new Map<string, string>()
  private readonly dirs = new Set<string>([''])

  seedFile(path: string, content: string) {
    const normalized = this.normalize(path)
    this.files.set(normalized, content)
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
    this.ensureParentDirs(normalized)
  }

  async create(path: string, data: string): Promise<void> {
    const normalized = this.normalize(path)
    if (this.files.has(normalized)) throw new Error(`File exists: ${normalized}`)
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

  async walkVault(): Promise<VaultEntry[]> {
    return [...this.files.entries()].map(([path, content]) => ({
      path,
      size: content.length,
      mtime: 0,
      ctime: 0,
    }))
  }

  async stat(path: string): Promise<VaultStat> {
    const normalized = this.normalize(path)
    if (this.files.has(normalized)) return { size: this.files.get(normalized)!.length, mtime: 0, isDirectory: false }
    if (this.folderExists(normalized)) return { size: 0, mtime: 0, isDirectory: true }
    throw new Error(`Missing path: ${normalized}`)
  }

  async exists(path: string): Promise<boolean> {
    const normalized = this.normalize(path)
    return this.files.has(normalized) || this.folderExists(normalized)
  }

  async mkdir(path: string): Promise<void> {
    this.ensureDir(this.normalize(path))
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
    return { parent: path.slice(0, idx), name: path.slice(idx + 1) }
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
    if (!path) return
    const parts = path.split('/')
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
  async readBytes(): Promise<Uint8Array> {
    throw new Error('readBytes is not implemented by this test double')
  }

  async writeBytes(): Promise<void> {
    throw new Error('writeBytes is not implemented by this test double')
  }

  async delete(_p: string): Promise<void> {
    throw new Error('delete is not implemented by this test double')
  }
}

describe('todoScannerBlock (VaultFS abstraction)', () => {
  it('aggregates todos and skips excluded directories', async () => {
    const fs = new FakeVaultFS(
      {
        '': {
          files: [],
          folders: ['acceleration_core', '.obsidian'],
        },
        acceleration_core: {
          files: [],
          folders: ['Webull'],
        },
        'acceleration_core/Webull': {
          files: [],
          folders: ['todos'],
        },
        'acceleration_core/Webull/todos': {
          files: ['2026-02-14.md'],
          folders: [],
        },
        '.obsidian': {
          files: [],
          folders: ['todos'],
        },
        '.obsidian/todos': {
          files: ['2026-02-14.md'],
          folders: [],
        },
      },
      {
        'acceleration_core/Webull/todos/2026-02-14.md': '- [x] done one\n- [ ] pending one\n',
        '.obsidian/todos/2026-02-14.md': '- [ ] should be excluded\n',
      },
    )

    const result = await getTodosMonth(fs, 2026, 2)
    expect(result.total).toBe(2)
    expect(result.done).toBe(1)
    expect(result.pending).toBe(1)
    expect(result.sections.map(s => s.name)).toEqual(['Webull'])
  })

  it('creates new todo files with YAML frontmatter metadata', async () => {
    const fs = new MutableVaultFS()
    const result = await createTodo(fs, 'acceleration_core/Webull/todos', '2026-02-15', ['First task', 'Second task'])

    expect(result.output_path).toBe('acceleration_core/Webull/todos/2026-02-15.md')
    expect(result.items_added).toBe(2)
    expect(result.appended).toBe(false)

    const content = await fs.read('acceleration_core/Webull/todos/2026-02-15.md')
    const note = parseNote(content)
    expect(note).not.toBeNull()
    expect(note!.frontmatter.type).toBe('thought')
    expect(note!.frontmatter.tags).toContain('todo')
    expect(note!.frontmatter.todo_date).toBe('2026-02-15')
    expect(note!.body).toContain('- [ ] First task')
    expect(note!.body).toContain('- [ ] Second task')
  })

  it('upgrades legacy todo markdown files to YAML frontmatter on append', async () => {
    const fs = new MutableVaultFS()
    fs.seedFile('lifeblood_systems/sfdl/todos/2026-02-14.md', '- [ ] Existing task\n')

    const result = await createTodo(fs, 'lifeblood_systems/sfdl/todos', '2026-02-14', ['New task'])
    expect(result.appended).toBe(true)

    const content = await fs.read('lifeblood_systems/sfdl/todos/2026-02-14.md')
    const note = parseNote(content)
    expect(note).not.toBeNull()
    expect(note!.frontmatter.type).toBe('thought')
    expect(note!.frontmatter.tags).toContain('todo')
    expect(note!.body).toContain('- [ ] Existing task')
    expect(note!.body).toContain('- [ ] New task')
  })
})
