import { getVaultFS } from '@/services/lego_blocks/integrations/fsBlock'
import { taskBodyBlock, parseTaskMarkdownBlock, type Task } from '@/services/lego_blocks/units/aiActivityTaskBlock'

// Reads the old organizer's tasks, and creates new ones. They live beside the
// project, under its vault path — `<projectRoot>/thinking-organizer/epics/` —
// not in `ai-activity/`, because they are Anurag's hand-written records, the
// other half of the loop.
//
// This used to be read-only, on the reasoning that the seam should never edit
// the hand-written half. Creating is not editing: the index could show 325
// authored records and offer no way to author the 326th, so the one surface
// built for reading this corpus was the one place you could not add to it. The
// line still holds for *existing* records — nothing here rewrites a file
// Anurag or the CLI already wrote, and `createTaskFileBlock` refuses a path
// that exists rather than overwriting it.

/**
 * Which directory a project's authored records live in.
 *
 * `epics` is the default because F9 — the only project this read when it was
 * written — files them there. Thinking Space files 325 of them under `tasks/`
 * and keeps a stale `epics/` holding DEV-era work items, so a hardcoded `epics`
 * pointed the pane at the wrong corpus rather than at nothing, which is the
 * harder failure to notice.
 */
export const DEFAULT_TASK_DIR_BLOCK = 'epics'

export function taskDirBlock(projectRoot: string, dir: string = DEFAULT_TASK_DIR_BLOCK): string {
  return `${projectRoot.replace(/\/+$/, '')}/thinking-organizer/${dir.replace(/^\/+|\/+$/g, '')}`
}

/** The store names files `<singular>-<key>.md` after their directory: `epics/`
 *  holds `epic-…`, `tasks/` holds `task-…`. Only used as the fast path — the
 *  directory scan behind it is what actually decides. */
function filePrefixBlock(dir: string): string {
  return dir.replace(/s$/, '')
}

export async function listTasksBlock(
  projectRoot: string,
  dirName: string = DEFAULT_TASK_DIR_BLOCK,
): Promise<Task[]> {
  const fs = getVaultFS()
  const dir = taskDirBlock(projectRoot, dirName)
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
  /** The file exactly as it sits on disk. The composer reads a sibling's whole
   *  frontmatter to mint in its image, and only the raw text has the fields the
   *  parsed `Task` deliberately drops. */
  raw: string
}

/**
 * Write a new record, refusing to touch one that already exists.
 *
 * The exists check is the whole safety story: a ticket collision with a record
 * the CLI minted between the index load and the save would otherwise land as a
 * silent overwrite of somebody's work. Throwing lets the caller take the next
 * ticket and try again, which is what it does.
 */
export async function createTaskFileBlock(
  projectRoot: string,
  dirName: string,
  key: string,
  content: string,
): Promise<string> {
  const fs = getVaultFS()
  const dir = taskDirBlock(projectRoot, dirName)
  const path = `${dir}/${filePrefixBlock(dirName)}-${key}.md`
  if (await fs.exists(path)) throw new Error(`A record already exists at ${path}`)
  try {
    await fs.mkdir(dir)
  } catch {
    // Already there — the only case that matters, and the one the index proves.
  }
  await fs.write(path, content)
  return path
}

/**
 * Overwrite an existing record.
 *
 * The mirror of `createTaskFileBlock`'s refusal: this one insists the file is
 * already there. A write that lands on a missing path would mean the drawer is
 * editing a record the store can no longer find — a rename or a delete between
 * the read and the save — and creating it fresh would resurrect a file Anurag
 * just moved, under the old name, with only the fields the drawer happened to
 * be holding.
 *
 * The caller passes the path it read, not a derived one, so a hand-renamed file
 * is written back where it actually lives.
 */
export async function writeTaskFileBlock(path: string, content: string): Promise<void> {
  const fs = getVaultFS()
  if (!(await fs.exists(path))) throw new Error(`No record at ${path} — it may have been moved or renamed.`)
  await fs.write(path, content)
}

/**
 * Read a single task by key. The store names files `epic-<key>.md`, so the
 * common case is one read; the directory scan behind it is the fallback for a
 * hand-renamed file, where the key in the frontmatter is still the truth.
 */
export async function readTaskBlock(
  projectRoot: string,
  key: string,
  dirName: string = DEFAULT_TASK_DIR_BLOCK,
): Promise<TaskFile | null> {
  const fs = getVaultFS()
  const dir = taskDirBlock(projectRoot, dirName)

  const parse = (raw: string, path: string): TaskFile | null => {
    const task = parseTaskMarkdownBlock(raw)
    return task ? { task, body: taskBodyBlock(raw), path, raw } : null
  }

  const direct = `${dir}/${filePrefixBlock(dirName)}-${key}.md`
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
