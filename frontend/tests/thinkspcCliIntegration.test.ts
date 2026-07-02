import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'

const TEMP_ROOTS: string[] = []

afterEach(async () => {
  await Promise.all(TEMP_ROOTS.splice(0).map(root => fs.rm(root, { recursive: true, force: true })))
})

describe('thinkspc CLI integration', () => {
  it('prefers explicit env vault root over repo .env and writes relative file-backed inputs from caller cwd', async () => {
    const { repoRoot, callerCwd, vaultRoot } = await createCliWorkspace()
    await fs.writeFile(
      path.join(callerCwd, 'frontmatter.json'),
      '{"title":"Answer - O\'Brien Habits","tags":["ai-synthesis"]}\n',
      'utf-8',
    )
    await fs.writeFile(
      path.join(callerCwd, 'body.md'),
      '# Answer\n\nBody with spaces and an apostrophe: O\'Brien.\n',
      'utf-8',
    )

    const response = await runThinkspc(repoRoot, callerCwd, vaultRoot, [
      '--json',
      'write_note',
      '--path', "Notes/O'Brien answer.md",
      '--frontmatter-file', './frontmatter.json',
      '--body-file', './body.md',
      '--overwrite', 'false',
    ])

    expect(response.data.path).toBe("Notes/O'Brien answer.md")

    const written = await fs.readFile(path.join(vaultRoot, 'Notes', "O'Brien answer.md"), 'utf-8')
    expect(written).toContain("title: Answer - O'Brien Habits")
    expect(written).toContain("Body with spaces and an apostrophe: O'Brien.")
  })

  it('supports comment.add via stdin with multi-line quoted content', async () => {
    const { repoRoot, callerCwd, vaultRoot } = await createCliWorkspace()

    const created = await runThinkspc(repoRoot, callerCwd, vaultRoot, [
      '--json',
      'organizer.node.create',
      '--type', 'task',
      '--title', "Parser hardening for O'Brien path handling",
      '--projectRoot', 'projects/cli-hardening',
      '--description', 'Exercise comment.add stdin path',
      '--extra-record_kind', 'task',
    ])

    const uuid = created.data.node.uuid as string
    expect(uuid).toBeTruthy()

    const commented = await runThinkspc(
      repoRoot,
      callerCwd,
      vaultRoot,
      [
        '--json',
        'comment.add',
        '--uuid', uuid,
        '--addedBy', 'codex-gpt5',
        '--text-stdin',
      ],
      'Line 1 with O\'Brien\nLine 2 with "quotes"\n',
    )

    expect(commented.data.node.comments?.at(-1)?.text).toBe('Line 1 with O\'Brien\nLine 2 with "quotes"')
    expect(commented.data.node.comments?.at(-1)?.addedBy ?? commented.data.node.comments?.at(-1)?.added_by).toBeTruthy()
  })

  it('refuses to overwrite an existing note when overwrite is explicitly false', async () => {
    const { repoRoot, callerCwd, vaultRoot } = await createCliWorkspace()
    await fs.writeFile(path.join(callerCwd, 'frontmatter.json'), '{"title":"First"}\n', 'utf-8')
    await fs.writeFile(path.join(callerCwd, 'body.md'), '# Body\n', 'utf-8')

    await runThinkspc(repoRoot, callerCwd, vaultRoot, [
      '--json',
      'write_note',
      '--path', 'notes/existing.md',
      '--frontmatter-file', './frontmatter.json',
      '--body-file', './body.md',
      '--overwrite', 'false',
    ])

    const secondWrite = await runThinkspc(repoRoot, callerCwd, vaultRoot, [
      '--json',
      'write_note',
      '--path', 'notes/existing.md',
      '--frontmatter-file', './frontmatter.json',
      '--body-file', './body.md',
      '--overwrite', 'false',
    ])

    expect(secondWrite.ok).toBe(false)
    expect(secondWrite.error.message).toContain('File already exists: notes/existing.md')
  })

  it('creates AI synthesis scaffolds with kebab-case flags and file-backed derived_from lists', async () => {
    const { repoRoot, callerCwd, vaultRoot } = await createCliWorkspace()
    await fs.writeFile(path.join(callerCwd, 'derived.txt'), 'notes/source one.md\nnotes/source-two.md\n', 'utf-8')

    const response = await runThinkspc(repoRoot, callerCwd, vaultRoot, [
      '--json',
      'create_ai_synthesis_note',
      '--domain-root', 'lifeblood_systems/Understanding Myself',
      '--layer', 'reference',
      '--synthesis-type', 'concept',
      '--concept-root', 'Habits',
      '--concept-subpath', 'Formation,Breaking',
      '--title', "Concept - O'Brien habits",
      '--slug', 'obrien-habits',
      '--derived-from-file', './derived.txt',
      '--if-exists', 'return_existing',
    ])

    expect(response.data.path).toBe(
      'lifeblood_systems/Understanding Myself/AI Synthesis/Reference/Concepts/Habits/Formation/Breaking/obrien-habits.md',
    )

    const content = await fs.readFile(
      path.join(
        vaultRoot,
        'lifeblood_systems',
        'Understanding Myself',
        'AI Synthesis',
        'Reference',
        'Concepts',
        'Habits',
        'Formation',
        'Breaking',
        'obrien-habits.md',
      ),
      'utf-8',
    )
    expect(content).toContain("title: Concept - O'Brien habits")
    expect(content).toContain('derived_from:')
    expect(content).toContain('notes/source one.md')
    expect(content).toContain('wiki_links:')
    expect(content).toContain('[[notes/source one]]')
  })

  it('resolves source-shaped AI synthesis paths with quoted source titles', async () => {
    const { repoRoot, callerCwd, vaultRoot } = await createCliWorkspace()

    const response = await runThinkspc(repoRoot, callerCwd, vaultRoot, [
      '--json',
      'resolve_ai_synthesis_path',
      '--domain-root', 'lifeblood_systems/Understanding Myself',
      '--layer', 'reference',
      '--synthesis-type', 'source_summary',
      '--source-title', "O'Brien on Habits",
      '--slug', 'limbic-friction',
    ])

    expect(response.data.path).toBe(
      "lifeblood_systems/Understanding Myself/AI Synthesis/Reference/Sources/O'Brien on Habits/limbic-friction.md",
    )
  })

  it('patches frontmatter from file-backed JSON objects and preserves body content', async () => {
    const { repoRoot, callerCwd, vaultRoot } = await createCliWorkspace()
    await fs.mkdir(path.join(vaultRoot, 'notes'), { recursive: true })
    await fs.writeFile(
      path.join(vaultRoot, 'notes', 'example.md'),
      '---\ntitle: Example\ntags:\n  - existing\n---\n# Body\n\nKeep this body.\n',
      'utf-8',
    )
    await fs.writeFile(
      path.join(callerCwd, 'set.json'),
      '{"related_concepts":["moats","capital-allocation"]}\n',
      'utf-8',
    )
    await fs.writeFile(
      path.join(callerCwd, 'append.json'),
      '{"tags":["existing","investing"]}\n',
      'utf-8',
    )

    await runThinkspc(repoRoot, callerCwd, vaultRoot, [
      '--json',
      'patch_note_frontmatter',
      '--path', 'notes/example.md',
      '--set-file', './set.json',
      '--append-unique-file', './append.json',
    ])

    const read = await runThinkspc(repoRoot, callerCwd, vaultRoot, [
      '--json',
      'read_note',
      '--path', 'notes/example.md',
    ])

    expect(read.data.frontmatter.related_concepts).toEqual(['moats', 'capital-allocation'])
    expect(read.data.frontmatter.tags).toEqual(['existing', 'investing'])
    expect(read.data.body).toBe('# Body\n\nKeep this body.\n')
  })

  it('saves cleaned transcripts through the CLI using the injected vault filesystem', async () => {
    const { repoRoot, callerCwd, vaultRoot } = await createCliWorkspace()

    const response = await runThinkspc(repoRoot, callerCwd, vaultRoot, [
      '--json',
      'tools.transcript.clean_save',
      '--input_text', '(0s): Welcome everyone\n(10s): Today we discuss planning.',
      '--headings_text', '00:00:00 Intro\n00:00:10 Planning',
      '--output_folder', 'transcripts/cli',
      '--output_name', 'meeting-notes',
    ])

    expect(response.ok).toBe(true)
    expect(response.data.result.success).toBe(true)
    expect(response.data.result.output_path).toBe('transcripts/cli/meeting-notes.md')

    const written = await fs.readFile(path.join(vaultRoot, 'transcripts', 'cli', 'meeting-notes.md'), 'utf-8')
    expect(written).toContain('## Intro')
    expect(written).toContain('Welcome everyone')
    expect(written).toContain('## Planning')
  })

  it('uses the vault selected in the app as the default for the packaged standalone cli', async () => {
    const { repoRoot, callerCwd, tempRoot, vaultRoot } = await createCliWorkspace()
    const tempHome = path.join(path.dirname(callerCwd), 'home')
    const wrongVaultRoot = path.join(path.dirname(callerCwd), 'wrong-vault')
    const resourcesDir = path.join(path.dirname(callerCwd), 'Resources')
    const cliDir = path.join(resourcesDir, 'cli')
    const standalonePath = path.join(repoRoot, 'frontend', 'electron', 'src', 'cli', 'thinkspc-standalone.sh')
    const appStateDir = path.join(tempHome, 'Library', 'Application Support', 'thinking-space', 'state')
    const configDir = path.join(tempHome, '.config', 'thinkspc')
    const runnerScript = path.join(cliDir, 'capabilityRunner.bundle.cjs')
    const nodeCacheDir = path.join(tempRoot, 'node-cache')
    const nodeArchivePath = path.join(tempRoot, 'node-runtime.tar.gz')
    const probePath = path.join(tempRoot, 'vault-root-probe.json')
    const nodeVersion = 'v22.14.0'
    const nodePlatform = process.platform === 'darwin' ? 'darwin' : 'linux'
    const nodeArch = process.arch === 'arm64' ? 'arm64' : 'x64'
    const extractedRootName = `node-${nodeVersion}-${nodePlatform}-${nodeArch}`
    const extractedRootDir = path.join(tempRoot, extractedRootName)
    const extractedNodePath = path.join(extractedRootDir, 'bin', 'node')

    await fs.mkdir(cliDir, { recursive: true })
    await fs.mkdir(appStateDir, { recursive: true })
    await fs.mkdir(configDir, { recursive: true })
    await fs.mkdir(wrongVaultRoot, { recursive: true })
    await fs.mkdir(path.dirname(extractedNodePath), { recursive: true })
    await fs.writeFile(
      path.join(appStateDir, 'vault-root.json'),
      JSON.stringify({ vaultRoot }, null, 2),
      'utf-8',
    )
    await fs.writeFile(
      path.join(configDir, '.env'),
      `THINKSPC_VAULT_ROOT="${wrongVaultRoot}"\n`,
      'utf-8',
    )
    await fs.writeFile(
      runnerScript,
      [
        "const fs = require('node:fs')",
        "const path = require('node:path')",
        "const payload = {",
        "  ok: true,",
        "  data: {",
        "    argv: process.argv.slice(2),",
        "    vaultRoot: process.env.THINKSPC_VAULT_ROOT || '',",
        "  },",
        "}",
        `fs.writeFileSync(${JSON.stringify(probePath)}, JSON.stringify(payload), 'utf-8')`,
        "process.stdout.write(JSON.stringify(payload))",
      ].join('\n'),
      'utf-8',
    )
    await fs.chmod(runnerScript, 0o755)
    await fs.writeFile(
      extractedNodePath,
      `#!/usr/bin/env bash\nexec ${JSON.stringify(process.execPath)} "$@"\n`,
      'utf-8',
    )
    await fs.chmod(extractedNodePath, 0o755)
    await execFileAsync(
      'tar',
      ['-czf', nodeArchivePath, '-C', tempRoot, extractedRootName],
      {
        cwd: tempRoot,
        env: process.env,
      },
    )

    const { stdout, stderr } = await execFileAsync(standalonePath, ['--json', 'list'], {
      cwd: callerCwd,
      env: {
        ...process.env,
        HOME: tempHome,
        THINKSPC_APP_RESOURCES: resourcesDir,
        THINKSPC_VAULT_ROOT: '',
        LTM_VAULT_ROOT: '',
        THINK_SPACE_VAULT_ROOT: '',
        THINKSPC_NODE_CACHE_DIR: nodeCacheDir,
        THINKSPC_NODE_DOWNLOAD_URL: `file://${nodeArchivePath}`,
        THINKSPC_NODE_VERSION: nodeVersion,
      },
    })

    const output = stdout.trim()
    expect(output).toBeTruthy()
    const response = JSON.parse(output)
    expect(response.ok).toBe(true)
    expect(response.data.vaultRoot).toBe(vaultRoot)
    expect(response.data.argv).toEqual(['--json', 'list'])
    expect(JSON.parse(await fs.readFile(probePath, 'utf-8')).data.vaultRoot).toBe(vaultRoot)
    expect(stderr).toContain(`downloading Node.js ${nodeVersion}`)
    await expect(
      fs.stat(path.join(nodeCacheDir, 'node', nodeVersion, `${nodePlatform}-${nodeArch}`, 'bin', 'node')),
    ).resolves.toBeTruthy()
  })
})

async function createCliWorkspace(): Promise<{
  repoRoot: string
  callerCwd: string
  tempRoot: string
  vaultRoot: string
}> {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'thinkspc-cli-integration-'))
  TEMP_ROOTS.push(tempRoot)
  const callerCwd = path.join(tempRoot, 'caller')
  const vaultRoot = path.join(tempRoot, 'vault')
  await fs.mkdir(callerCwd, { recursive: true })
  await fs.mkdir(vaultRoot, { recursive: true })
  return {
    repoRoot: path.resolve(process.cwd(), '..'),
    callerCwd,
    tempRoot,
    vaultRoot,
  }
}

async function runThinkspc(
  repoRoot: string,
  callerCwd: string,
  vaultRoot: string,
  args: string[],
  stdin?: string,
): Promise<any> {
  const thinkspcPath = path.join(repoRoot, 'thinkspc')
  const { stdout, stderr } = await execFileAsync(thinkspcPath, args, {
    cwd: callerCwd,
    env: {
      ...process.env,
      THINKSPC_VAULT_ROOT: vaultRoot,
      LTM_VAULT_ROOT: vaultRoot,
      LTM_OUTPUT_FORMAT: 'json',
      LTM_OUTPUT_BRIEF: '0',
    },
    input: stdin,
  })

  const output = stdout.trim()
  if (!output) {
    throw new Error(`Empty CLI output. stderr=${stderr}`)
  }
  return JSON.parse(output)
}

function execFileAsync(
  file: string,
  args: string[],
  options: {
    cwd: string
    env: NodeJS.ProcessEnv
    input?: string
  },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      file,
      args,
      {
        cwd: options.cwd,
        env: options.env,
        encoding: 'utf-8',
        maxBuffer: 1024 * 1024 * 4,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`Command failed: ${error.message}\nstdout=${stdout}\nstderr=${stderr}`))
          return
        }
        resolve({ stdout, stderr })
      },
    )

    if (options.input !== undefined) {
      child.stdin?.write(options.input)
      child.stdin?.end()
    }
  })
}
