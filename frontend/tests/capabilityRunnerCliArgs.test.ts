import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as fsPromises from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  buildCLIInvokePayload,
  buildOrganizerContextFromArgs,
  installLocalStorageShim,
  materializeFileBackedInputs,
  parseOrganizerContextUrl,
  renderOrganizerContextHelp,
  renderCapabilityHelp,
  renderRunnerHelp,
  resolveCommandShortcut,
  resolveOutputFormat,
} from '../scripts/agent/capabilityRunner'

const ORIGINAL_VAULT_ROOT = process.env.LTM_VAULT_ROOT
const ORIGINAL_CALLER_CWD = process.env.THINKSPC_CALLER_CWD
const ORIGINAL_LOCAL_STORAGE_DESCRIPTOR = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')

beforeEach(() => {
  process.env.LTM_VAULT_ROOT = '/tmp/ltm-runner-cli-test'
  process.env.THINKSPC_CALLER_CWD = '/tmp/ltm-runner-cli-test'
})

afterEach(() => {
  if (ORIGINAL_VAULT_ROOT === undefined) {
    delete process.env.LTM_VAULT_ROOT
  } else {
    process.env.LTM_VAULT_ROOT = ORIGINAL_VAULT_ROOT
  }
  if (ORIGINAL_CALLER_CWD === undefined) {
    delete process.env.THINKSPC_CALLER_CWD
  } else {
    process.env.THINKSPC_CALLER_CWD = ORIGINAL_CALLER_CWD
  }
  if (ORIGINAL_LOCAL_STORAGE_DESCRIPTOR) {
    Object.defineProperty(globalThis, 'localStorage', ORIGINAL_LOCAL_STORAGE_DESCRIPTOR)
  } else {
    delete (globalThis as { localStorage?: unknown }).localStorage
  }
})

describe('capabilityRunner CLI argument parsing', () => {
  it('maps deprecated --extra-comments to organizer.node.update comments with warning', () => {
    const { payload, warnings } = buildCLIInvokePayload('organizer.node.update', [
      '--uuid', 'node-123',
      '--extra-comments', 'Added implementation details',
    ])

    expect(payload.request.input).toEqual({
      uuid: 'node-123',
      updates: {
        comments: ['Added implementation details'],
      },
    })
    expect(warnings.some(msg => msg.includes('--extra-comments'))).toBe(true)
    expect(warnings.some(msg => msg.includes('comment.add'))).toBe(true)
  })

  it('parses JSON object flags for note frontmatter patching', () => {
    const { payload } = buildCLIInvokePayload('patch_note_frontmatter', [
      '--path', 'notes/example.md',
      '--set', '{"related_concepts":["moats"]}',
      '--append_unique', '{"tags":["investing"]}',
    ])

    expect(payload.request.input).toEqual({
      path: 'notes/example.md',
      set: {
        related_concepts: ['moats'],
      },
      append_unique: {
        tags: ['investing'],
      },
    })
  })

  it('renders capability-specific help for create_ai_synthesis_note', () => {
    const help = renderCapabilityHelp('create_ai_synthesis_note')
    expect(help).toContain('Capability: create_ai_synthesis_note')
    expect(help).toContain('--domain_root')
    expect(help).toContain('--derived_from')
    expect(help).toContain('--concept_root')
    expect(help).toContain('thinkspc create_ai_synthesis_note')
  })

  it('parses source and concept grouping flags for AI synthesis path resolution', () => {
    const { payload } = buildCLIInvokePayload('resolve_ai_synthesis_path', [
      '--domain_root', 'lifeblood_systems/Understanding Myself',
      '--layer', 'reference',
      '--synthesis_type', 'concept',
      '--concept_root', 'Habits',
      '--concept_subpath', 'Formation,Breaking',
      '--slug', 'what-are-habits',
    ])

    expect(payload.request.input).toEqual({
      domain_root: 'lifeblood_systems/Understanding Myself',
      layer: 'reference',
      synthesis_type: 'concept',
      concept_root: 'Habits',
      concept_subpath: ['Formation', 'Breaking'],
      slug: 'what-are-habits',
    })
  })

  it('accepts kebab-case aliases for snake_case AI synthesis flags', () => {
    const { payload } = buildCLIInvokePayload('create_ai_synthesis_note', [
      '--domain-root', 'lifeblood_systems/Understanding Myself',
      '--layer', 'reference',
      '--synthesis-type', 'concept',
      '--concept-root', 'Habits',
      '--concept-subpath', 'Formation,Breaking',
      '--slug', 'what-are-habits',
      '--derived-from', 'notes/source-a.md,notes/source-b.md',
      '--if-exists', 'return_existing',
    ])

    expect(payload.request.input).toEqual({
      domain_root: 'lifeblood_systems/Understanding Myself',
      layer: 'reference',
      synthesis_type: 'concept',
      concept_root: 'Habits',
      concept_subpath: ['Formation', 'Breaking'],
      slug: 'what-are-habits',
      derived_from: ['notes/source-a.md', 'notes/source-b.md'],
      if_exists: 'return_existing',
    })
  })

  it('parses explicit boolean flag values instead of treating them as strings', () => {
    const { payload } = buildCLIInvokePayload('write_note', [
      '--path', 'notes/example.md',
      '--overwrite', 'false',
    ])

    expect(payload.request.input).toEqual({
      path: 'notes/example.md',
      overwrite: false,
    })
  })

  it('keeps explicit metadata extras in extraFields for organizer.node.update', () => {
    const { payload, warnings } = buildCLIInvokePayload('organizer.node.update', [
      '--uuid', 'node-123',
      '--extra-record_kind', 'task',
    ])

    expect(payload.request.input).toEqual({
      uuid: 'node-123',
      updates: {
        extraFields: {
          record_kind: 'task',
        },
      },
    })
    expect(warnings).toEqual([])
  })

  it('maps deprecated --extra-description to organizer.node.create description', () => {
    const { payload, warnings } = buildCLIInvokePayload('organizer.node.create', [
      '--type', 'task',
      '--title', 'Parser hardening',
      '--extra-description', 'Short implementation plan',
    ])

    expect(payload.request.input).toMatchObject({
      type: 'task',
      title: 'Parser hardening',
      description: 'Short implementation plan',
    })
    expect(warnings.some(msg => msg.includes('--extra-description'))).toBe(true)
  })

  it('renders top-level help with usage and guidance', () => {
    const help = renderRunnerHelp()
    expect(help).toContain('thinkspc [--text|--json] [--brief|--full] <command>')
    expect(help).toContain('thinkspc help')
    expect(help).toContain('thinkspc <capability> --help')
    expect(help).toContain('thinkspc organizer.context --url')
    expect(help).toContain('Output defaults to text in terminals and json in non-interactive mode.')
    expect(help).toContain('Use comment.add for append-only task notes.')
  })

  it('parses organizer URL context with decoded project root', () => {
    const parsed = parseOrganizerContextUrl(
      'http://localhost:5173/thinking-space/thinking-organizer?tab=backlog&projectRoot=operations%2Fsfw',
    )
    expect(parsed.projectRoot).toBe('operations/sfw')
    expect(parsed.tab).toBe('backlog')
  })

  it('parses organizer hash-route context', () => {
    const parsed = parseOrganizerContextUrl(
      'http://localhost:5173/thinking-space/#/thinking-organizer?tab=backlog&projectRoot=ops%2Falpha',
    )
    expect(parsed.projectRoot).toBe('ops/alpha')
    expect(parsed.tab).toBe('backlog')
  })

  it('builds organizer context from args with defaults', () => {
    const context = buildOrganizerContextFromArgs([
      '--projectRoot', 'operations/sfw',
    ])
    expect(context.projectRoot).toBe('operations/sfw')
    expect(context.tab).toBe('backlog')
    expect(context.query).toBe('status active')
    expect(context.limit).toBe(10)
  })

  it('renders organizer context help', () => {
    const help = renderOrganizerContextHelp()
    expect(help).toContain('thinkspc organizer.context --url')
    expect(help).toContain('Converts human organizer links into agent-native capability command suggestions.')
  })

  it('renders capability-specific help for organizer.node.update', () => {
    const help = renderCapabilityHelp('organizer.node.update')
    expect(help).toContain('Capability: organizer.node.update')
    expect(help).toContain('Update node metadata fields.')
    expect(help).toContain('thinkspc organizer.node.update --uuid "abc-123" --status active --priority high')
    expect(help).toContain('thinkspc organizer.node.update --uuid "abc-123" --description "Updated description"')
  })

  it('uses text output by default in TTY mode', () => {
    const resolved = resolveOutputFormat(['list'], { isTTY: true })
    expect(resolved.format).toBe('text')
    expect(resolved.verbosity).toBe('full')
    expect(resolved.args).toEqual(['list'])
  })

  it('uses json output by default in non-TTY mode', () => {
    const resolved = resolveOutputFormat(['list'], { isTTY: false })
    expect(resolved.format).toBe('json')
    expect(resolved.verbosity).toBe('full')
    expect(resolved.args).toEqual(['list'])
  })

  it('honors --json flag and removes it from args', () => {
    const resolved = resolveOutputFormat(['--json', 'organizer.nodes.search', '--query', 'active'], { isTTY: true })
    expect(resolved.format).toBe('json')
    expect(resolved.verbosity).toBe('full')
    expect(resolved.args).toEqual(['organizer.nodes.search', '--query', 'active'])
  })

  it('honors --brief and --full output verbosity flags', () => {
    const brief = resolveOutputFormat(['--brief', 'list'], { isTTY: true })
    expect(brief.verbosity).toBe('brief')
    expect(brief.args).toEqual(['list'])

    const full = resolveOutputFormat(['--full', 'list'], { isTTY: true })
    expect(full.verbosity).toBe('full')
    expect(full.args).toEqual(['list'])
  })

  it('does not consume capability --text argument when command is already selected', () => {
    const resolved = resolveOutputFormat(
      ['comment.add', '--uuid', 'abc-123', '--text', 'progress note'],
      { isTTY: true },
    )
    expect(resolved.format).toBe('text')
    expect(resolved.args).toEqual(['comment.add', '--uuid', 'abc-123', '--text', 'progress note'])
  })

  it('supports --flag=value syntax in CLI argument mode', () => {
    const { payload } = buildCLIInvokePayload('comment.add', [
      '--uuid=abc-123',
      '--text=progress update',
      '--addedBy=codex-gpt5',
    ])

    expect(payload.request.input).toEqual({
      uuid: 'abc-123',
      text: 'progress update',
      addedBy: 'codex-gpt5',
    })
  })

  it('accepts positional fallback text for comment.add', () => {
    const { payload, warnings } = buildCLIInvokePayload('comment.add', [
      '--uuid', 'abc-123',
      'progress', 'update', 'without', 'flag',
      '--addedBy', 'codex-gpt5',
    ])

    expect(payload.request.input).toEqual({
      uuid: 'abc-123',
      text: 'progress update without flag',
      addedBy: 'codex-gpt5',
    })
    expect(warnings.some(msg => msg.includes('Detected positional text for comment.add'))).toBe(true)
  })

  it('greedily parses natural language value for --text until next flag', () => {
    const { payload } = buildCLIInvokePayload('comment.add', [
      '--uuid', 'abc-123',
      '--text', 'Implementation', 'plan:', 'step', '1',
      '--addedBy', 'codex-gpt5',
    ])

    expect(payload.request.input).toEqual({
      uuid: 'abc-123',
      text: 'Implementation plan: step 1',
      addedBy: 'codex-gpt5',
    })
  })

  it('defaults comment.add addedBy to actor id', () => {
    const { payload } = buildCLIInvokePayload('comment.add', [
      '--uuid', 'abc-123',
      '--text', 'progress update',
      '--actor-id', 'codex-gpt5',
    ])

    expect(payload.request.input).toEqual({
      uuid: 'abc-123',
      text: 'progress update',
      addedBy: 'codex-gpt5',
    })
  })

  it('materializes --text-file into text payload input', async () => {
    const tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'thinkspc-cli-'))
    const filePath = path.join(tempDir, 'note.txt')
    await fsPromises.writeFile(filePath, 'line 1\nline 2\n', 'utf-8')
    process.env.THINKSPC_CALLER_CWD = tempDir

    const input: Record<string, unknown> = {
      uuid: 'abc-123',
      'text-file': './note.txt',
    }
    await materializeFileBackedInputs(input)

    expect(input).toEqual({
      uuid: 'abc-123',
      text: 'line 1\nline 2',
    })
  })

  it('materializes JSON and array file-backed inputs with type coercion', async () => {
    const tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'thinkspc-cli-'))
    const jsonPath = path.join(tempDir, 'frontmatter.json')
    const arrayPath = path.join(tempDir, 'derived.txt')
    await fsPromises.writeFile(jsonPath, '{"title":"Answer - What Are Habits?"}\n', 'utf-8')
    await fsPromises.writeFile(arrayPath, 'notes/a.md\nnotes/b.md\n', 'utf-8')
    process.env.THINKSPC_CALLER_CWD = tempDir

    const input: Record<string, unknown> = {
      'frontmatter-file': './frontmatter.json',
      'derived_from-file': './derived.txt',
    }
    await materializeFileBackedInputs(input)

    expect(input).toEqual({
      frontmatter: {
        title: 'Answer - What Are Habits?',
      },
      derived_from: ['notes/a.md', 'notes/b.md'],
    })
  })

  it('normalizes kebab-case file-backed aliases before materialization', async () => {
    const { payload } = buildCLIInvokePayload('create_ai_synthesis_note', [
      '--domain-root', 'lifeblood_systems/Understanding Myself',
      '--layer', 'reference',
      '--synthesis-type', 'concept',
      '--slug', 'what-are-habits',
      '--derived-from-file', './derived.txt',
    ])

    expect(payload.request.input).toEqual({
      domain_root: 'lifeblood_systems/Understanding Myself',
      layer: 'reference',
      synthesis_type: 'concept',
      slug: 'what-are-habits',
      'derived_from-file': './derived.txt',
    })
  })

  it('expands shortcut commands', () => {
    const done = resolveCommandShortcut('done', ['--uuid', 'abc-123'])
    expect(done.command).toBe('task.update_status')
    expect(done.args).toEqual(['--taskStatus', 'done', '--uuid', 'abc-123'])

    const comment = resolveCommandShortcut('comment', ['--uuid', 'abc-123', '--text', 'hello'])
    expect(comment.command).toBe('comment.add')
    expect(comment.args).toEqual(['--uuid', 'abc-123', '--text', 'hello'])
  })

  it('installs in-memory localStorage shim when runtime localStorage is unusable', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: { getItem: () => null },
      configurable: true,
      enumerable: true,
      writable: true,
    })

    installLocalStorageShim()
    expect(typeof globalThis.localStorage.getItem).toBe('function')
    expect(typeof globalThis.localStorage.setItem).toBe('function')
    expect(typeof globalThis.localStorage.removeItem).toBe('function')
    expect(typeof globalThis.localStorage.clear).toBe('function')
  })
})

describe('capabilityRunner CLI arguments for ai_activity capabilities', () => {
  it('coerces tag list flags to arrays and allowNew to a boolean', () => {
    const { payload } = buildCLIInvokePayload('ai_activity.undertaking.tag', [
      '--projectId', 'F9',
      '--key', 'f9-und-micron-memory-cycle',
      '--add', 'held,bucket 1',
      '--reject', 'source',
      '--allowNew',
    ])

    expect(payload.request.input).toEqual({
      projectId: 'F9',
      key: 'f9-und-micron-memory-cycle',
      add: ['held', 'bucket 1'],
      reject: ['source'],
      allowNew: true,
    })
  })

  it('keeps allowNew off when not passed, so unknown tags are refused by default', () => {
    const { payload } = buildCLIInvokePayload('ai_activity.undertaking.tag', [
      '--projectId', 'F9',
      '--key', 'f9-und-micron-memory-cycle',
      '--add', 'fab-equipment',
    ])

    expect(payload.request.input).not.toHaveProperty('allowNew')
  })

  it('greedily parses the head text for update_head without quoting', () => {
    const { payload } = buildCLIInvokePayload('ai_activity.undertaking.update_head', [
      '--projectId', 'F9',
      '--key', 'f9-und-micron-memory-cycle',
      '--text', 'HBM', 'is', 'the', 'whole', 'thesis',
    ])

    expect(payload.request.input).toEqual({
      projectId: 'F9',
      key: 'f9-und-micron-memory-cycle',
      text: 'HBM is the whole thesis',
    })
  })

  it('leaves undertaking keys flat rather than wrapping them in updates', () => {
    // `key` is an IDENTITY_FIELD, which only wraps for organizer.node.update.
    const { payload } = buildCLIInvokePayload('ai_activity.undertaking.get', [
      '--projectId', 'F9',
      '--key', 'f9-und-micron-memory-cycle',
    ])

    expect(payload.request.input).toEqual({
      projectId: 'F9',
      key: 'f9-und-micron-memory-cycle',
    })
  })

  it('parses chain file pointer lists for backfill', () => {
    const { payload } = buildCLIInvokePayload('ai_activity.chain.set_files', [
      '--projectId', 'F9',
      '--chainKey', '2026-07-14-abc123',
      '--written', 'vault://F9/notes/micron.md,cwd://frontend/src/main.ts',
    ])

    expect(payload.request.input).toEqual({
      projectId: 'F9',
      chainKey: '2026-07-14-abc123',
      written: ['vault://F9/notes/micron.md', 'cwd://frontend/src/main.ts'],
    })
  })

  it('renders capability-specific help listing the tag mechanism flags', () => {
    const help = renderCapabilityHelp('ai_activity.undertaking.tag')
    expect(help).toContain('--allowNew')
    expect(help).toContain('tags.yaml')
  })
})
