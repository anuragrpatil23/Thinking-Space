import { getVaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import { taskBodyBlock, parseTaskMarkdownBlock, type Task } from '@/services/lego_blocks/units/aiActivityTaskBlock'

// Reads the old organizer's tasks. They live beside the project, under its vault
// path — `<projectRoot>/thinking-organizer/epics/` — not in `ai-activity/`,
// because they are Anurag's hand-written records, the other half of the loop.
// Read-only here: the seam never edits the old store.

export function taskDirBlock(projectRoot: string): string {
  return `${projectRoot.replace(/\/+$/, '')}/thinking-organizer/epics`
}

export async function listTasksBlock(projectRoot: string): Promise<Task[]> {
  const fs = getVaultFS()
  const dir = taskDirBlock(projectRoot)
  let names: string[] = []
  try {
    names = (await fs.list(dir)).files.filter(name => name.endsWith('.md'))
  } catch {
    return []
  }
  const out: Task[] = []
  for (const name of names) {
    try {
      const task = parseTaskMarkdownBlock(await fs.read(`${dir}/${name}`))
      if (task) out.push(task)
    } catch {
      // A half-finished hand edit skips, never breaks the list.
    }
  }
  return out
}

/** One task, with the body the list drops — what the detail drawer reads. */
export interface TaskFile {
  task: Task
  /** Everything after the frontmatter, unparsed. */
  body: string
  /** Vault-relative path, so the drawer can name the file it is showing. */
  path: string
}

/**
 * Read a single task by key. The store names files `epic-<key>.md`, so the
 * common case is one read; the directory scan behind it is the fallback for a
 * hand-renamed file, where the key in the frontmatter is still the truth.
 */
export async function readTaskBlock(projectRoot: string, key: string): Promise<TaskFile | null> {
  const fs = getVaultFS()
  const dir = taskDirBlock(projectRoot)

  const parse = (raw: string, path: string): TaskFile | null => {
    const task = parseTaskMarkdownBlock(raw)
    return task ? { task, body: taskBodyBlock(raw), path } : null
  }

  const direct = `${dir}/epic-${key}.md`
  try {
    const hit = parse(await fs.read(direct), direct)
    if (hit && hit.task.key === key) return hit
  } catch {
    // Fall through to the scan.
  }

  let names: string[] = []
  try {
    names = (await fs.list(dir)).files.filter(name => name.endsWith('.md'))
  } catch {
    return null
  }
  for (const name of names) {
    try {
      const path = `${dir}/${name}`
      const hit = parse(await fs.read(path), path)
      if (hit && hit.task.key === key) return hit
    } catch {
      // Skip an unreadable file rather than failing the lookup.
    }
  }
  return null
}
