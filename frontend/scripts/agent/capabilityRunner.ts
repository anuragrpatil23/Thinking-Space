import 'fake-indexeddb/auto'

import { spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as fsPromises from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { inspect } from 'node:util'

import { EXCLUDED_DIRS } from '../../src/services/lego_blocks/units/vaultConstantsBlock'
import type { ListedFiles, VaultEntry, VaultFS, VaultStat } from '../../src/services/lego_blocks/integrations/fsBlock'
import { STORAGE_KEYS } from '../../src/services/lego_blocks/units/storageKeyBlock'
import {
  invokeCapabilityOrch,
  listCapabilitiesOrch,
  type CapabilityInvokeRequest,
} from '../../src/services/orchestrators/capabilityRouterOrch'
import { fullSync, incrementalSync } from '../../src/services/orchestrators/vaultSyncOrch'
import {
  bulkUpsertLinks,
  bulkUpsertNodes,
  clearAll,
  clearAllLinks,
  getAllLinks,
  getAllNodes,
  type LinkRecord,
  type NodeRecord,
} from '../../src/services/lego_blocks/integrations/dbBlock'
import { homedir } from 'node:os'

interface InvokePayload {
  vaultRoot: string
  request: CapabilityInvokeRequest
  apiBaseUrl?: string
}

class InMemoryLocalStorage {
  private readonly store = new Map<string, string>()

  get length(): number {
    return this.store.size
  }

  clear(): void {
    this.store.clear()
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null
  }

  key(index: number): string | null {
    if (index < 0 || index >= this.store.size) return null
    return [...this.store.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.store.delete(key)
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value)
  }
}

function isUsableLocalStorage(value: unknown): value is Pick<Storage, 'getItem' | 'setItem' | 'removeItem' | 'clear'> {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.getItem === 'function'
    && typeof candidate.setItem === 'function'
    && typeof candidate.removeItem === 'function'
    && typeof candidate.clear === 'function'
}

export class NodeVaultFS implements VaultFS {
  private readonly vaultRoot: string

  constructor(vaultRoot: string) {
    this.vaultRoot = path.resolve(vaultRoot)
  }

  async read(relPath: string): Promise<string> {
    const full = this.assertInsideVault(relPath)
    return fsPromises.readFile(full, 'utf-8')
  }

  async write(relPath: string, data: string): Promise<void> {
    const full = this.assertInsideVault(relPath)
    await fsPromises.mkdir(path.dirname(full), { recursive: true })
    await fsPromises.writeFile(full, data, 'utf-8')
  }

  async create(relPath: string, data: string): Promise<void> {
    if (await this.exists(relPath)) {
      throw new Error(`File already exists: ${relPath}`)
    }
    await this.write(relPath, data)
  }

  async list(relPath: string): Promise<ListedFiles> {
    const full = this.assertInsideVault(relPath || '.')
    const entries = await fsPromises.readdir(full, { withFileTypes: true })
    const files: string[] = []
    const folders: string[] = []
    for (const entry of entries) {
      if (entry.name.startsWith('.') || EXCLUDED_DIRS.has(entry.name)) continue
      if (entry.isDirectory()) folders.push(entry.name)
      else files.push(entry.name)
    }
    return { files, folders }
  }

  async walkVault(extensions: string[] = ['.md']): Promise<VaultEntry[]> {
    const extSet = new Set(extensions.map(ext => ext.toLowerCase()))
    const results: VaultEntry[] = []

    const walk = async (dir: string): Promise<void> => {
      // Spelled out rather than inferred from `readdir`: its overloads resolve
      // to the Buffer-name variant, and `entry.name` then isn't a string.
      let entries: import('node:fs').Dirent[]
      try {
        entries = await fsPromises.readdir(dir, { withFileTypes: true })
      } catch {
        return
      }

      for (const entry of entries) {
        if (entry.name.startsWith('.') || EXCLUDED_DIRS.has(entry.name)) continue
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          await walk(full)
          continue
        }
        if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase()
          if (!extSet.has(ext)) continue

          try {
            const stat = await fsPromises.stat(full)
            results.push({
              path: this.toVaultRelativePath(full),
              size: stat.size,
              mtime: stat.mtimeMs / 1000,
              ctime: stat.birthtimeMs / 1000,
            })
          } catch {
            // Skip unreadable files.
          }
        }
      }
    }

    await walk(this.vaultRoot)
    return results
  }

  async stat(relPath: string): Promise<VaultStat> {
    const full = this.assertInsideVault(relPath)
    const stat = await fsPromises.stat(full)
    return {
      size: stat.size,
      mtime: stat.mtimeMs / 1000,
      ctime: stat.birthtimeMs / 1000,
      isDirectory: stat.isDirectory(),
    }
  }

  async exists(relPath: string): Promise<boolean> {
    const full = this.assertInsideVault(relPath)
    try {
      await fsPromises.access(full)
      return true
    } catch {
      return false
    }
  }

  async mkdir(relPath: string): Promise<void> {
    const full = this.assertInsideVault(relPath)
    await fsPromises.mkdir(full, { recursive: true })
  }

  async process(relPath: string, fn: (data: string) => string): Promise<void> {
    const content = await this.read(relPath)
    await this.write(relPath, fn(content))
  }

  async readBytes(relPath: string): Promise<Uint8Array> {
    return new Uint8Array(await fsPromises.readFile(this.assertInsideVault(relPath)))
  }

  async writeBytes(relPath: string, data: Uint8Array): Promise<void> {
    const full = this.assertInsideVault(relPath)
    await fsPromises.mkdir(path.dirname(full), { recursive: true })
    await fsPromises.writeFile(full, data)
  }

  async delete(relPath: string): Promise<void> {
    await fsPromises.rm(this.assertInsideVault(relPath), { recursive: true, force: true })
  }

  private assertInsideVault(relPath: string): string {
    const candidate = path.resolve(this.vaultRoot, relPath || '.')
    const relative = path.relative(this.vaultRoot, candidate)
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new Error(`Path traversal detected: ${relPath}`)
    }
    return candidate
  }

  private toVaultRelativePath(fullPath: string): string {
    return path.relative(this.vaultRoot, fullPath).split(path.sep).join('/')
  }
}

// ── CLI arg parsing for direct capability invocation ──

const NUMBER_FIELDS = new Set(['limit', 'lineNumber', 'buckets'])
const ARRAY_FIELDS = new Set(['tags', 'items', 'artifacts', 'relatedNodes', 'emotions', 'comments', 'derived_from', 'changed_paths', 'concept_subpath', 'insights', 'files_touched', 'linked_notes', 'add', 'remove', 'accept', 'reject', 'written', 'read', 'undertakings'])
const BOOLEAN_FIELDS = new Set(['dryRun', 'dry-run', 'date_header', 'text-stdin', 'overwrite', 'deleteClaudeSession', 'allowNew'])
const JSON_FIELDS = new Set(['frontmatter', 'set', 'append_unique'])
/** Arrays of *objects*, unlike ARRAY_FIELDS which coerces every element to a
 *  string. A batch of assignment proposals is structured — target, confidence,
 *  rationale — so it arrives as JSON, normally via `--proposals-file`. */
const JSON_ARRAY_FIELDS = new Set(['proposals'])
const GREEDY_TEXT_FIELDS = new Set([
  'text',
  'note',
  'summary',
  'description',
  'body',
  'content',
  'inputText',
  'headingsText',
  'input_text',
  'headings_text',
  'title',
  'conversation',
  'head',
])

const COMMAND_SHORTCUTS: Record<string, string> = {
  context: 'organizer.context',
  search: 'organizer.nodes.search',
  claim: 'task.claim',
  comment: 'comment.add',
}

function hasFlagArg(args: string[], flag: string): boolean {
  return args.some(arg => arg === `--${flag}` || arg.startsWith(`--${flag}=`))
}

export function resolveCommandShortcut(
  command: string,
  args: string[],
): { command: string; args: string[]; warnings: string[] } {
  const normalized = command.trim()
  if (!normalized) return { command: normalized, args, warnings: [] }

  const directAlias = COMMAND_SHORTCUTS[normalized]
  if (directAlias) {
    return {
      command: directAlias,
      args,
      warnings: [`Shortcut "${normalized}" expanded to "${directAlias}".`],
    }
  }

  const taskStatusShortcut: Record<string, string> = {
    done: 'done',
    wip: 'in_progress',
    blocked: 'blocked',
    ready: 'ready',
  }

  const shortcutStatus = taskStatusShortcut[normalized]
  if (!shortcutStatus) return { command: normalized, args, warnings: [] }

  const nextArgs = [...args]
  if (!hasFlagArg(nextArgs, 'taskStatus')) {
    nextArgs.unshift(shortcutStatus)
    nextArgs.unshift('--taskStatus')
  }
  return {
    command: 'task.update_status',
    args: nextArgs,
    warnings: [`Shortcut "${normalized}" expanded to "task.update_status --taskStatus ${shortcutStatus}".`],
  }
}

/** Capabilities where non-identity fields are wrapped in an `updates` sub-object. */
const WRAPPED_CAPABILITIES: Record<string, string> = {
  'organizer.node.update': 'updates',
}

/** Identity fields that stay at the top level even for wrapped capabilities. */
const IDENTITY_FIELDS = new Set(['uuid', 'key'])

const EXTRA_FIELD_ALIASES: Record<string, Record<string, string>> = {
  'organizer.node.create': {
    'extra-type': 'type',
    'extra-title': 'title',
    'extra-parentKey': 'parentKey',
    'extra-parentUuid': 'parentUuid',
    'extra-parentType': 'parentType',
    'extra-tags': 'tags',
    'extra-body': 'body',
    'extra-description': 'description',
    'extra-comments': 'comments',
    'extra-projectRoot': 'projectRoot',
  },
  'organizer.node.update': {
    'extra-type': 'type',
    'extra-title': 'title',
    'extra-tags': 'tags',
    'extra-status': 'status',
    'extra-priority': 'priority',
    'extra-description': 'description',
    'extra-comments': 'comments',
  },
}

interface ParsedCLIArgsResult {
  input: Record<string, unknown>
  warnings: string[]
}

interface OrganizerContext {
  sourceUrl: string | null
  projectRoot: string | null
  tab: string | null
  query: string
  limit: number
}

function shellQuote(value: string): string {
  return `"${value.replace(/([\\`"$])/g, '\\$1')}"`
}

function parseHttpUrl(input: string): URL {
  try {
    return new URL(input)
  } catch {
    if (/^localhost(?::\d+)?\//.test(input)) {
      return new URL(`http://${input}`)
    }
    throw new Error(`Invalid URL: ${input}`)
  }
}

function looksLikeHttpUrl(input: string): boolean {
  return /^https?:\/\//i.test(input) || /^localhost(?::\d+)?\//i.test(input)
}

function hashQueryParams(hashValue: string): URLSearchParams {
  const withoutHash = hashValue.startsWith('#') ? hashValue.slice(1) : hashValue
  const queryIndex = withoutHash.indexOf('?')
  if (queryIndex < 0) return new URLSearchParams()
  return new URLSearchParams(withoutHash.slice(queryIndex + 1))
}

export function parseOrganizerContextUrl(urlValue: string): { sourceUrl: string; projectRoot: string | null; tab: string | null } {
  const parsed = parseHttpUrl(urlValue)
  const queryParams = parsed.searchParams
  const hashParams = hashQueryParams(parsed.hash)

  const projectRoot = hashParams.get('projectRoot')
    ?? queryParams.get('projectRoot')
  const tab = hashParams.get('tab')
    ?? queryParams.get('tab')

  return {
    sourceUrl: parsed.toString(),
    projectRoot: projectRoot?.trim() || null,
    tab: tab?.trim() || null,
  }
}

export function buildOrganizerContextFromArgs(args: string[]): OrganizerContext {
  const { input } = parseCLIArgs('organizer.context', args)
  const urlValue = asString(input.url)
  const parsedFromUrl = urlValue ? parseOrganizerContextUrl(urlValue) : null

  const projectRoot = asString(input.projectRoot)
    ?? parsedFromUrl?.projectRoot
    ?? null
  const tab = asString(input.tab)
    ?? parsedFromUrl?.tab
    ?? 'backlog'
  const query = asString(input.query) ?? 'status active'
  const parsedLimit = typeof input.limit === 'number' && Number.isFinite(input.limit)
    ? Math.max(1, Math.trunc(input.limit))
    : 10

  return {
    sourceUrl: parsedFromUrl?.sourceUrl ?? null,
    projectRoot,
    tab,
    query,
    limit: parsedLimit,
  }
}

export function renderOrganizerContextHelp(): string {
  return [
    'Organizer agent context helper',
    '',
    'Usage:',
    '  thinkspc organizer.context --url "http://localhost:5173/thinking-space/thinking-organizer?tab=backlog&projectRoot=operations%2Fsfw"',
    '  thinkspc organizer.context --projectRoot operations/sfw --tab backlog',
    '  thinkspc organizer.context --projectRoot operations/sfw --query "taskStatus ready" --limit 20',
    '',
    'Purpose:',
    '  Converts human organizer links into agent-native capability command suggestions.',
  ].join('\n')
}

export function renderOrganizerContextOutput(context: OrganizerContext): string {
  const lines: string[] = []
  lines.push('Organizer agent context')
  if (context.sourceUrl) lines.push(`Source URL: ${context.sourceUrl}`)
  lines.push(`Project root: ${context.projectRoot || '(not provided)'}`)
  lines.push(`Tab: ${context.tab || '(not provided)'}`)
  lines.push(`Default query: ${context.query}`)
  lines.push(`Default limit: ${context.limit}`)
  lines.push('')
  lines.push('Recommended agent commands:')

  const projectRootArg = context.projectRoot
    ? ` --projectRoot ${shellQuote(context.projectRoot)}`
    : ''
  const queryArg = ` --query ${shellQuote(context.query)} --limit ${context.limit}`

  lines.push(`  thinkspc organizer.nodes.search${queryArg}${projectRootArg}`)
  lines.push(`  thinkspc organizer.nodes.search --query "taskStatus ready" --limit ${context.limit}${projectRootArg}`)
  lines.push('  thinkspc task.claim --uuid "<task-uuid>" --owner codex-cli')
  lines.push('  thinkspc comment.add --uuid "<task-uuid>" --text "Progress update" --addedBy codex-cli')
  lines.push('  thinkspc task.update_status --uuid "<task-uuid>" --taskStatus done')

  return lines.join('\n')
}

function parseScalarOrCollectionValue(key: string, value: string): unknown {
  return coerceStringInputValue(key, value, 'flag')
}

function coerceStringInputValue(key: string, value: string, source: 'flag' | 'file'): unknown {
  const trimmed = value.trim()

  if (NUMBER_FIELDS.has(key)) {
    const parsed = Number(trimmed)
    if (!Number.isFinite(parsed)) {
      throw new Error(`Invalid number for ${source === 'file' ? `${key}-file` : `--${key}`}: ${value}`)
    }
    return parsed
  }

  if (BOOLEAN_FIELDS.has(key)) {
    const normalized = trimmed.toLowerCase()
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true
    if (['false', '0', 'no', 'off'].includes(normalized)) return false
    if (source === 'flag') {
      throw new Error(`Invalid boolean for --${key}: ${value}. Use true or false.`)
    }
    throw new Error(`Invalid boolean in ${key}-file: ${value}. Use true or false.`)
  }

  if (JSON_FIELDS.has(key)) {
    try {
      const parsed = JSON.parse(value)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('expected a JSON object')
      }
      return parsed
    } catch (error) {
      const prefix = source === 'file' ? `${key}-file` : `--${key}`
      throw new Error(`Invalid JSON for ${prefix}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  if (JSON_ARRAY_FIELDS.has(key)) {
    try {
      const parsed = JSON.parse(value)
      if (!Array.isArray(parsed)) throw new Error('expected a JSON array')
      return parsed
    } catch (error) {
      const prefix = source === 'file' ? `${key}-file` : `--${key}`
      throw new Error(`Invalid JSON for ${prefix}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  if (ARRAY_FIELDS.has(key)) {
    const raw = value.replace(/\r\n/g, '\n').trim()
    if (!raw) return []
    if (raw.startsWith('[')) {
      try {
        const parsed = JSON.parse(raw)
        if (!Array.isArray(parsed)) throw new Error('expected a JSON array')
        return parsed.map(item => String(item).trim()).filter(Boolean)
      } catch (error) {
        const prefix = source === 'file' ? `${key}-file` : `--${key}`
        throw new Error(`Invalid array value for ${prefix}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    const parts = raw.includes('\n')
      ? raw.split('\n')
      : raw.split(',')
    return parts.map(part => part.trim()).filter(Boolean)
  }

  return value
}

function getAliasedKey(capability: string, key: string): { key: string; warning?: string } {
  const aliases = EXTRA_FIELD_ALIASES[capability]
  const canonicalByFieldAlias = resolveCapabilityFieldAlias(capability, key)
  const resolvedInputKey = canonicalByFieldAlias ?? key
  if (!aliases) return { key: resolvedInputKey }
  const canonical = aliases[resolvedInputKey]
  if (!canonical) return { key: resolvedInputKey }

  if (canonical === 'comments') {
    return {
      key: canonical,
      warning: `Flag --${key} is deprecated for ${capability}. Use --comments. For append-only notes, use comment.add with --text.`,
    }
  }

  return {
    key: canonical,
    warning: `Flag --${key} is deprecated for ${capability}. Use --${canonical} instead.`,
  }
}

function resolveCapabilityFieldAlias(capability: string, key: string): string | null {
  const fields = CAPABILITY_INPUT_FIELDS[capability]
  if (!fields || fields.length === 0) return null

  for (const field of fields) {
    const aliases = expandFieldAliases(field.flag)
    if (aliases.has(key)) return field.flag
  }
  return null
}

function expandFieldAliases(field: string): Set<string> {
  const aliases = new Set<string>([field])
  const snake = field
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/-/g, '_')
    .toLowerCase()
  const kebab = snake.replace(/_/g, '-')
  const camel = snake.replace(/_([a-z0-9])/g, (_, char: string) => char.toUpperCase())
  aliases.add(snake)
  aliases.add(kebab)
  aliases.add(camel)
  return aliases
}

function parseCLIArgs(capability: string, args: string[]): ParsedCLIArgsResult {
  const result: Record<string, unknown> = {}
  const warnings: string[] = []
  let i = 0
  while (i < args.length) {
    const arg = args[i]!
    if (!arg.startsWith('--')) {
      if (capability === 'comment.add' && typeof result.text !== 'string') {
        const parts: string[] = []
        let cursor = i
        while (cursor < args.length && !args[cursor]!.startsWith('--')) {
          parts.push(args[cursor]!)
          cursor += 1
        }
        const text = parts.join(' ').trim()
        if (!text) {
          throw new Error(`Unexpected positional argument: ${arg}`)
        }
        result.text = text
        warnings.push('Detected positional text for comment.add. Prefer --text "..." (or --text-stdin for multi-line text).')
        i = cursor
        continue
      }
      throw new Error(`Unexpected positional argument: ${arg}`)
    }

    const inlineEqualsIndex = arg.indexOf('=')
    const hasInlineValue = inlineEqualsIndex > 2
    const rawKey = hasInlineValue ? arg.slice(2, inlineEqualsIndex) : arg.slice(2)
    const key = normalizeFileBackedFlagKey(capability, rawKey)
    const inlineValue = hasInlineValue ? arg.slice(inlineEqualsIndex + 1) : null

    // Boolean flags: if next arg is missing or starts with --, treat as true
    if (!hasInlineValue && BOOLEAN_FIELDS.has(key) && (i + 1 >= args.length || args[i + 1]!.startsWith('--'))) {
      result[key] = true
      i++
      continue
    }
    if (!hasInlineValue && i + 1 >= args.length) {
      throw new Error(`Missing value for --${key}`)
    }
    const { key: resolvedKey, warning } = getAliasedKey(capability, key)
    if (warning) warnings.push(warning)

    let value = inlineValue ?? args[i + 1]!
    i += hasInlineValue ? 1 : 2

    if (!hasInlineValue && GREEDY_TEXT_FIELDS.has(resolvedKey)) {
      while (i < args.length && !args[i]!.startsWith('--')) {
        value = `${value} ${args[i]!}`
        i += 1
      }
    }

    if (resolvedKey.startsWith('extra-')) {
      const extraKey = resolvedKey.slice(6)
      const extraFields = (result.extraFields as Record<string, unknown>) ?? {}
      extraFields[extraKey] = value
      result.extraFields = extraFields
    } else {
      result[resolvedKey] = parseScalarOrCollectionValue(resolvedKey, value)
    }
  }
  return { input: result, warnings }
}

function normalizeFileBackedFlagKey(capability: string, key: string): string {
  const fileSuffix = key.endsWith('-file')
    ? '-file'
    : key.endsWith('_file')
      ? '_file'
      : null
  if (!fileSuffix) return key

  const baseKey = key.slice(0, -fileSuffix.length)
  const canonicalBase = resolveCapabilityFieldAlias(capability, baseKey) ?? baseKey
  return `${canonicalBase}-file`
}

function writeCLIWarnings(warnings: string[]): void {
  for (const warning of warnings) {
    process.stderr.write(`[thinkspc] ${warning}\n`)
  }
}

function readVaultRootFromConfig(): string | null {
  // Falls back to ~/.thinking-space/config.json (written by the Electron app
  // on every launch via provisionCliBlock). This lets the packaged thinkspc
  // shim work from any directory without a repo-root .env.
  try {
    const home = process.env.HOME || process.env.USERPROFILE
    if (!home) return null
    const configPath = path.join(home, '.thinking-space', 'config.json')
    const raw = fs.readFileSync(configPath, 'utf-8')
    const parsed = JSON.parse(raw) as { vaultRoot?: unknown }
    if (typeof parsed.vaultRoot === 'string' && parsed.vaultRoot.trim().length > 0) {
      return parsed.vaultRoot.trim()
    }
    return null
  } catch {
    return null
  }
}

export function buildCLIInvokePayload(
  capability: string,
  cliArgs: string[],
): { payload: InvokePayload; warnings: string[] } {
  const vaultRoot =
    process.env.THINKSPC_VAULT_ROOT
    || process.env.LTM_VAULT_ROOT
    || readVaultRootFromConfig()
  if (!vaultRoot) {
    throw new Error(
      'THINKSPC_VAULT_ROOT/LTM_VAULT_ROOT is not set and no vaultRoot in ~/.thinking-space/config.json. ' +
      'Launch the Thinking Space app once (it provisions the config) or set the env var, ' +
      'or use the repo ./thinkspc wrapper which loads .env.',
    )
  }

  const parsed = parseCLIArgs(capability, cliArgs)
  const { input: inputArgs, warnings } = parsed

  // Extract actor overrides
  const actorKind = (inputArgs['actor-kind'] as string) ?? 'agent'
  const actorId = (inputArgs['actor-id'] as string) ?? 'claude-code'
  delete inputArgs['actor-kind']
  delete inputArgs['actor-id']

  // Extract dryRun (accept both --dryRun and --dry-run)
  const dryRun = inputArgs.dryRun === true || inputArgs['dry-run'] === true
  delete inputArgs.dryRun
  delete inputArgs['dry-run']

  if (capability === 'comment.add' && typeof inputArgs.addedBy !== 'string') {
    inputArgs.addedBy = actorId
  }

  // Handle wrapped capabilities (e.g., organizer.node.update wraps non-uuid fields in `updates`)
  const wrapKey = WRAPPED_CAPABILITIES[capability]
  let input: Record<string, unknown>
  if (wrapKey) {
    const identity: Record<string, unknown> = {}
    const wrapped: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(inputArgs)) {
      if (IDENTITY_FIELDS.has(k)) {
        identity[k] = v
      } else {
        wrapped[k] = v
      }
    }
    input = { ...identity, [wrapKey]: wrapped }
  } else {
    input = inputArgs
  }

  return {
    payload: {
      vaultRoot,
      request: {
        capability: capability as CapabilityInvokeRequest['capability'],
        input,
        actor: { kind: actorKind as 'agent' | 'human' | 'system', id: actorId },
        dryRun,
      },
    },
    warnings,
  }
}

const CAPABILITY_EXAMPLES: Record<string, string[]> = {
  'read_note': [
    'thinkspc read_note --path "lifeblood_systems/Understanding Myself/thoughts/2025-12-19.md"',
  ],
  'write_note': [
    'thinkspc write_note --path "lifeblood_systems/Understanding Myself/AI Synthesis/Outputs/Answers/what-are-habits.md" --frontmatter \'{"title":"Answer - What Are Habits?"}\' --body-file ./answer.md',
  ],
  'patch_note_frontmatter': [
    'thinkspc patch_note_frontmatter --path "lifeblood_systems/Understanding Myself/thoughts/2025-12-19.md" --set \'{"related_concepts":["understanding-hunger"]}\' --append_unique \'{"tags":["brain"]}\'',
  ],
  'resolve_ai_synthesis_path': [
    'thinkspc resolve_ai_synthesis_path --domain_root "lifeblood_systems/Understanding Myself" --layer reference --synthesis_type concept --slug what-are-habits',
    'thinkspc resolve_ai_synthesis_path --domain_root "lifeblood_systems/Understanding Myself" --layer reference --synthesis_type source_summary --source_title "The Science of Making and Breaking Habits - Huberman" --slug limbic-friction',
  ],
  'create_ai_synthesis_note': [
    'thinkspc create_ai_synthesis_note --domain_root "lifeblood_systems/Understanding Myself" --layer reference --synthesis_type concept --title "Concept - What Are Habits?" --slug what-are-habits --derived_from "lifeblood_systems/Understanding Myself/AI Synthesis/Reference/Sources/science-of-making-and-breaking-habits.md"',
    'thinkspc create_ai_synthesis_note --domain_root "lifeblood_systems/Understanding Myself" --layer reference --synthesis_type concept --concept_root "Habits" --concept_subpath "Formation" --title "Concept - What Are Habits?" --slug what-are-habits --derived_from "lifeblood_systems/Understanding Myself/AI Synthesis/Reference/Sources/The Science of Making and Breaking Habits - Huberman/what-are-habits.md"',
  ],
  'get_impacted_ai_synthesis_notes': [
    'thinkspc get_impacted_ai_synthesis_notes --changed_paths "lifeblood_systems/Understanding Myself/thoughts/2025-12-19.md"',
  ],
  'update_ai_synthesis_compile_state': [
    'thinkspc update_ai_synthesis_compile_state --path "lifeblood_systems/Understanding Myself/AI Synthesis/Reference/Concepts/what-are-habits.md" --compile_status draft',
  ],
  'list_domain_ai_synthesis_health': [
    'thinkspc list_domain_ai_synthesis_health --domain_root "lifeblood_systems/Understanding Myself"',
  ],
  'organizer.nodes.list_roots': [
    'thinkspc organizer.nodes.list_roots',
    'thinkspc organizer.nodes.list_roots --typeFilter program',
  ],
  'organizer.nodes.list_children': [
    'thinkspc organizer.nodes.list_children --parentKey task-backlog',
  ],
  'organizer.nodes.list_all': [
    'thinkspc organizer.nodes.list_all',
  ],
  'organizer.nodes.search': [
    'thinkspc organizer.nodes.search --query "status active" --limit 10',
    'thinkspc organizer.nodes.search --query "taskStatus ready"',
  ],
  'organizer.node.get': [
    'thinkspc organizer.node.get --uuid "abc-123"',
  ],
  'organizer.node.get_by_key': [
    'thinkspc organizer.node.get_by_key --key "task-backlog"',
  ],
  'organizer.node.read_frontmatter': [
    'thinkspc organizer.node.read_frontmatter --filePath "coding-projects/thinking-space/some-note.md"',
  ],
  'organizer.node.create': [
    'thinkspc organizer.node.create --type task --title "My task" --parentKey task-backlog --projectRoot coding-projects/thinking-space --description "Short description" --extra-record_kind task',
  ],
  'organizer.node.rename': [
    'thinkspc organizer.node.rename --uuid "abc-123" --newTitle "Better title"',
  ],
  'organizer.node.update': [
    'thinkspc organizer.node.update --uuid "abc-123" --status active --priority high',
    'thinkspc organizer.node.update --uuid "abc-123" --description "Updated description"',
  ],
  'organizer.node.move': [
    'thinkspc organizer.node.move --uuid "abc-123" --newParentKey "epic-auth"',
  ],
  'organizer.node.delete': [
    'thinkspc organizer.node.delete --uuid "abc-123"',
    'thinkspc organizer.node.delete --uuid "abc-123" --dryRun',
  ],
  'task.claim': [
    'thinkspc task.claim --uuid "abc-123" --owner claude-code',
    'thinkspc task.claim --uuid "abc-123" --owner codex-cli --taskStatus in_progress',
  ],
  'task.update_status': [
    'thinkspc task.update_status --uuid "abc-123" --taskStatus done',
    'thinkspc task.update_status --uuid "abc-123" --taskStatus blocked --note "Waiting on API key"',
  ],
  'run.log': [
    'thinkspc run.log --title "Session log" --projectRoot coding-projects/thinking-space --agentName claude-code --result success',
  ],
  'handoff.create': [
    'thinkspc handoff.create --title "Auth handoff" --projectRoot coding-projects/thinking-space --summary "Completed login flow" --fromAgent claude-code --toAgent human --parentKey handoffs-agent-operations',
  ],
  'comment.add': [
    'thinkspc comment.add --uuid "abc-123" --text "Implemented parser hardening" --addedBy claude-code',
    'echo "Long comment" | thinkspc comment.add --uuid "abc-123" --addedBy claude-code --text-stdin',
  ],
  'thoughts.create': [
    'thinkspc thoughts.create --folder_path "journal" --filename "reflection" --content "Today I learned..." --title "Daily reflection" --date_header --emotions "curious,focused"',
  ],
  'daily.log_insight': [
    'thinkspc daily.log_insight --insights-file ./today-insights.txt --teachers_note-file ./teacher.md',
    'thinkspc daily.log_insight --insights \'["First insight","Second insight"]\' --files_touched "src/foo.ts,src/bar.ts"',
  ],
  'todos.create': [
    'thinkspc todos.create --folderPath "todos" --date "2025-01-15" --items "Buy groceries,Fix bug,Review PR"',
  ],
  'todos.toggle': [
    'thinkspc todos.toggle --filePath "todos/2025-01-15.md" --lineNumber 3',
  ],
  'tools.files.list_markdown': [
    'thinkspc tools.files.list_markdown',
    'thinkspc tools.files.list_markdown --limit 50',
  ],
  'tools.files.list_pdf': [
    'thinkspc tools.files.list_pdf',
  ],
  'tools.folders.list': [
    'thinkspc tools.folders.list',
    'thinkspc tools.folders.list --limit 20',
  ],
  'tools.excalidraw.preview': [
    'thinkspc tools.excalidraw.preview --inputPath "notes/diagram.md"',
  ],
  'tools.excalidraw.format': [
    'thinkspc tools.excalidraw.format --inputPath "notes/diagram.md"',
  ],
  'tools.excalidraw.highlights': [
    'thinkspc tools.excalidraw.highlights --inputPath "notes/book (formatted for excalidraw) (mindmap full text).excalidraw.md"',
  ],
  'tools.pdf.preview': [
    'thinkspc tools.pdf.preview --inputPath "docs/paper.pdf"',
  ],
  'tools.pdf.convert': [
    'thinkspc tools.pdf.convert --inputPath "docs/paper.pdf"',
  ],
  'tools.transcript.preview': [
    'thinkspc tools.transcript.preview --inputText "Speaker 1: Hello..."',
  ],
  'tools.transcript.clean_save': [
    'thinkspc tools.transcript.clean_save --input_text "Speaker 1: Hello..." --output_folder "transcripts" --output_name "meeting-notes"',
  ],
  'telegram.send_message': [
    'thinkspc telegram.send_message --text "Build is done"',
    'thinkspc telegram.send_message --text-file ./message.md --parseMode Markdown',
  ],
  'telegram.open_conversation': [
    'thinkspc telegram.open_conversation --scheduleKey daily-insight --sessionId "abc-123"',
    'thinkspc telegram.open_conversation --scheduleKey daily-insight --sessionId "abc-123" --ttlAt "2026-05-29T23:59:00Z"',
  ],
  'telegram.close_conversation': [
    'thinkspc telegram.close_conversation --convId "conv-20260529-..." --reason wrap_up',
    'thinkspc telegram.close_conversation --convId "conv-20260529-..." --reason ttl --deleteClaudeSession false',
  ],
  'ai_activity.undertakings.list': [
    'thinkspc ai_activity.undertakings.list --projectId F9',
    'thinkspc ai_activity.undertakings.list --projectId F9 --section "Semis"',
  ],
  'ai_activity.undertaking.get': [
    'thinkspc ai_activity.undertaking.get --projectId F9 --key f9-und-micron-memory-cycle',
  ],
  'ai_activity.undertaking.density': [
    'thinkspc ai_activity.undertaking.density --projectId F9 --key f9-und-micron-memory-cycle --buckets 12',
    'thinkspc ai_activity.undertaking.density --projectId F9 --key f9-und-micron-memory-cycle --buckets 12 --from 2026-05-01 --to 2026-07-31',
  ],
  'ai_activity.undertaking.update_head': [
    'thinkspc ai_activity.undertaking.update_head --projectId F9 --key f9-und-micron-memory-cycle --text "HBM is the whole thesis; the commodity DRAM cycle is noise around it."',
  ],
  'ai_activity.undertaking.tag': [
    'thinkspc ai_activity.undertaking.tag --projectId F9 --key f9-und-micron-memory-cycle --add "held,bucket 1"',
    'thinkspc ai_activity.undertaking.tag --projectId F9 --key f9-und-micron-memory-cycle --accept "machinery" --reject "source"',
    'thinkspc ai_activity.undertaking.tag --projectId F9 --key f9-und-micron-memory-cycle --add "fab-equipment" --allowNew',
  ],
  'ai_activity.assignment.record': [
    'thinkspc ai_activity.assignment.record --sessionId "3f3ea0fb-..." --undertakings f9-und-micron-memory-cycle',
    'thinkspc ai_activity.assignment.record --sessionId "3f3ea0fb-..." --undertakings "f9-und-tsmc,f9-und-semiconductor-physics"',
    'thinkspc ai_activity.assignment.record --sessionId "3f3ea0fb-..." --undertakings f9-und-new-thing --newTitle "Coherent optics teardown" --projectId F9',
    'thinkspc ai_activity.assignment.record --sessionId "3f3ea0fb-..." --undertakings f9-und-micron-memory-cycle --head HBM capacity is the whole thesis; the DRAM cycle is noise',
  ],
  'ai_activity.assignment.queue': [
    'thinkspc ai_activity.assignment.queue',
    'thinkspc ai_activity.assignment.queue --projectId F9',
  ],
  'ai_activity.assignment.propose': [
    'thinkspc ai_activity.assignment.propose --proposals-file ./proposals.json --proposedBy kai',
    'thinkspc ai_activity.assignment.propose --proposals \'[{"chainId":"abc","projectId":"F9","target":{"kind":"existing","key":"f9-und-micron"},"confidence":0.9,"rationale":"same 10-K"}]\'',
  ],
  'ai_activity.chains.list': [
    'thinkspc ai_activity.chains.list --projectId F9 --from 2026-07-01',
    'thinkspc ai_activity.chains.list --projectId F9 --undertaking f9-und-micron-memory-cycle',
  ],
  'ai_activity.chain.set_project': [
    'thinkspc ai_activity.chain.set_project --projectId Thinking-Space --chainKey "2026-07-14-abc123" --toProjectId F9',
  ],
  'ai_activity.chain.set_files': [
    'thinkspc ai_activity.chain.set_files --projectId F9 --chainKey "2026-07-14-abc123" --written "vault://F9/notes/micron.md"',
  ],
}

function formatExamples(capability: string): string {
  const examples = CAPABILITY_EXAMPLES[capability]
  if (!examples || examples.length === 0) return ''
  return [
    '',
    'Examples:',
    ...examples.map(example => `  ${example}`),
  ].join('\n')
}

export function renderRunnerHelp(): string {
  return [
    'Thinking Space capability runner',
    '',
    'Usage:',
    '  thinkspc [--text|--json] [--brief|--full] <command>',
    '  thinkspc list',
    '  thinkspc invoke < payload.json',
    '  thinkspc <capability> [--flag value ...]',
    '  thinkspc organizer.context --url "<organizer-url>"',
    '  thinkspc help',
    '  thinkspc <capability> --help',
    '',
    'Notes:',
    '  - Output defaults to text in terminals and json in non-interactive mode.',
    '  - Global output flags (--json, --text) must appear before the command.',
    '  - Output verbosity flags (--brief, --full) must appear before the command.',
    '  - --extra-* is for custom metadata only (extraFields).',
    '  - For first-class fields use first-class flags (e.g., --comments, --description).',
    '  - Use comment.add for append-only task notes.',
    '  - You can load long text values from files via --<flag>-file (e.g., --text-file ./note.md).',
    '  - ltm remains a compatibility alias for thinkspc.',
    '  - Passing a thinking-organizer URL directly is treated like organizer.context.',
    '  - Shortcuts: context, search, claim, comment, done, wip, ready, blocked.',
    '  - For long/multi-line text, use --text-stdin and pipe via stdin:',
    '      echo "my long text" | thinkspc comment.add --uuid <id> --addedBy agent --text-stdin',
    '      thinkspc comment.add --uuid <id> --addedBy agent --text-stdin <<\'EOF\'',
    '      Multi-line text with $pecial "chars" here.',
    '      EOF',
    '',
    'Discover capabilities:',
    '  thinkspc list',
  ].join('\n')
}

const CAPABILITY_INPUT_FIELDS: Record<string, Array<{ flag: string; required: boolean; note?: string }>> = {
  'read_note': [{ flag: 'path', required: true }],
  'write_note': [
    { flag: 'path', required: true },
    { flag: 'frontmatter', required: false, note: 'JSON object' },
    { flag: 'body', required: false, note: 'or use --body-file' },
    { flag: 'overwrite', required: false, note: 'boolean flag' },
  ],
  'patch_note_frontmatter': [
    { flag: 'path', required: true },
    { flag: 'set', required: false, note: 'JSON object' },
    { flag: 'append_unique', required: false, note: 'JSON object of array fields' },
  ],
  'resolve_ai_synthesis_path': [
    { flag: 'domain_root', required: true },
    { flag: 'layer', required: false, note: 'reference, experiential, operational, integrated' },
    { flag: 'synthesis_type', required: true },
    { flag: 'source_title', required: false, note: 'for source-shaped source summaries' },
    { flag: 'concept_root', required: false, note: 'for concept-root grouping' },
    { flag: 'concept_subpath', required: false, note: 'comma-separated conceptual subfolders' },
    { flag: 'slug', required: true },
  ],
  'create_ai_synthesis_note': [
    { flag: 'domain_root', required: true },
    { flag: 'layer', required: true, note: 'reference, experiential, operational, integrated' },
    { flag: 'synthesis_type', required: true },
    { flag: 'title', required: false },
    { flag: 'slug', required: false },
    { flag: 'source_title', required: false, note: 'for source-shaped source summaries' },
    { flag: 'concept_root', required: false, note: 'for concept-root grouping' },
    { flag: 'concept_subpath', required: false, note: 'comma-separated conceptual subfolders' },
    { flag: 'derived_from', required: true, note: 'comma-separated paths' },
    { flag: 'if_exists', required: false, note: 'error, return_existing, overwrite' },
  ],
  'get_impacted_ai_synthesis_notes': [
    { flag: 'changed_paths', required: true, note: 'comma-separated paths' },
  ],
  'update_ai_synthesis_compile_state': [
    { flag: 'path', required: true },
    { flag: 'last_compiled_at', required: false, note: 'ISO-8601; defaults to now' },
    { flag: 'compile_status', required: true },
  ],
  'list_domain_ai_synthesis_health': [
    { flag: 'domain_root', required: true },
  ],
  'organizer.nodes.list_roots': [{ flag: 'typeFilter', required: false, note: 'e.g. program, epic, task' }],
  'organizer.nodes.list_children': [{ flag: 'parentKey', required: true }],
  'organizer.nodes.list_all': [],
  'organizer.nodes.search': [
    { flag: 'query', required: true },
    { flag: 'limit', required: false, note: 'default 10' },
  ],
  'organizer.node.get': [{ flag: 'uuid', required: true }],
  'organizer.node.get_by_key': [{ flag: 'key', required: true }],
  'organizer.node.read_frontmatter': [{ flag: 'filePath', required: true }],
  'organizer.node.create': [
    { flag: 'type', required: true, note: 'e.g. task, epic, idea' },
    { flag: 'title', required: true },
    { flag: 'parentKey', required: false },
    { flag: 'projectRoot', required: false },
    { flag: 'description', required: false },
    { flag: 'tags', required: false, note: 'comma-separated' },
    { flag: 'extra-record_kind', required: false, note: 'e.g. task, run, handoff' },
  ],
  'organizer.node.rename': [
    { flag: 'uuid', required: true },
    { flag: 'newTitle', required: true },
  ],
  'organizer.node.update': [
    { flag: 'uuid', required: true },
    { flag: 'status', required: false },
    { flag: 'priority', required: false },
    { flag: 'description', required: false },
    { flag: 'tags', required: false, note: 'comma-separated' },
  ],
  'organizer.node.move': [
    { flag: 'uuid', required: true },
    { flag: 'newParentKey', required: true },
  ],
  'organizer.node.delete': [{ flag: 'uuid', required: true }],
  'task.claim': [
    { flag: 'uuid', required: true },
    { flag: 'owner', required: true },
    { flag: 'taskStatus', required: false, note: 'default in_progress' },
    { flag: 'note', required: false },
  ],
  'task.update_status': [
    { flag: 'uuid', required: true },
    { flag: 'taskStatus', required: true, note: 'e.g. in_progress, done, blocked' },
    { flag: 'note', required: false },
  ],
  'run.log': [
    { flag: 'title', required: true },
    { flag: 'projectRoot', required: true },
    { flag: 'agentName', required: false },
    { flag: 'result', required: false, note: 'e.g. success, failure' },
    { flag: 'parentKey', required: false },
  ],
  'handoff.create': [
    { flag: 'title', required: true },
    { flag: 'projectRoot', required: true },
    { flag: 'summary', required: true },
    { flag: 'fromAgent', required: false },
    { flag: 'toAgent', required: false },
    { flag: 'parentKey', required: false },
  ],
  'comment.add': [
    { flag: 'uuid', required: true },
    { flag: 'text', required: true, note: 'or use --text-stdin to pipe from stdin' },
    { flag: 'addedBy', required: false },
  ],
  'thoughts.create': [
    { flag: 'folder_path', required: true },
    { flag: 'filename', required: true },
    { flag: 'content', required: true },
    { flag: 'title', required: false },
    { flag: 'date_header', required: false, note: 'boolean flag' },
    { flag: 'emotions', required: false, note: 'comma-separated' },
  ],
  'daily.log_insight': [
    { flag: 'insights', required: true, note: 'newline-separated via --insights-file, or JSON array' },
    { flag: 'files_touched', required: false, note: 'comma-separated or JSON array' },
    { flag: 'linked_notes', required: false, note: 'comma-separated or JSON array' },
    { flag: 'teachers_note', required: false, note: 'prefer --teachers_note-file for long text' },
    { flag: 'conversation', required: false, note: 'verbatim transcript; prefer --conversation-file' },
    { flag: 'date', required: false, note: 'YYYY-MM-DD, defaults to today' },
    { flag: 'mode', required: false, note: 'append (default) or replace' },
  ],
  'todos.create': [
    { flag: 'folderPath', required: true },
    { flag: 'date', required: true, note: 'YYYY-MM-DD' },
    { flag: 'items', required: true, note: 'comma-separated' },
  ],
  'todos.toggle': [
    { flag: 'filePath', required: true },
    { flag: 'lineNumber', required: true, note: 'positive integer' },
  ],
  'tools.files.list_markdown': [{ flag: 'limit', required: false }],
  'tools.files.list_pdf': [{ flag: 'limit', required: false }],
  'tools.folders.list': [{ flag: 'limit', required: false }],
  'tools.excalidraw.preview': [{ flag: 'inputPath', required: true }],
  'tools.excalidraw.format': [{ flag: 'inputPath', required: true }],
  'tools.excalidraw.highlights': [{ flag: 'inputPath', required: true }],
  'tools.pdf.preview': [{ flag: 'inputPath', required: true }],
  'tools.pdf.convert': [{ flag: 'inputPath', required: true }],
  'tools.transcript.preview': [
    { flag: 'inputText', required: true },
    { flag: 'headingsText', required: false },
  ],
  'tools.transcript.clean_save': [
    { flag: 'input_text', required: true },
    { flag: 'output_folder', required: true },
    { flag: 'output_name', required: true },
    { flag: 'headings_text', required: false },
    { flag: 'base_folder', required: false },
  ],
  'telegram.send_message': [
    { flag: 'text', required: true, note: 'or use --text-file / --text-stdin for long messages' },
    { flag: 'parseMode', required: false, note: 'Markdown | MarkdownV2 | HTML' },
    { flag: 'chatId', required: false, note: 'defaults to chat_id from ~/.thinking-space/secrets.json' },
  ],
  'telegram.open_conversation': [
    { flag: 'scheduleKey', required: true, note: 'scheduler key this conv belongs to' },
    { flag: 'sessionId', required: true, note: 'Claude Code sessionId to resume on replies' },
    { flag: 'convId', required: false, note: 'auto-generated if omitted' },
    { flag: 'chatId', required: false, note: 'defaults to chat_id from secrets.json' },
    { flag: 'cwd', required: false, note: 'defaults to process.cwd() at open time' },
    { flag: 'ttlAt', required: false, note: 'ISO; defaults to 23:59 local today' },
  ],
  'telegram.close_conversation': [
    { flag: 'convId', required: true },
    { flag: 'reason', required: false, note: 'wrap_up | ttl | error | manual' },
    { flag: 'deleteClaudeSession', required: false, note: 'default true; deletes ~/.claude/projects/*/<sessionId>.jsonl' },
  ],
  'ai_activity.undertakings.list': [
    { flag: 'projectId', required: true },
    { flag: 'section', required: false, note: 'filter to one section' },
  ],
  'ai_activity.undertaking.get': [
    { flag: 'projectId', required: true },
    { flag: 'key', required: true },
  ],
  'ai_activity.undertaking.density': [
    { flag: 'projectId', required: true },
    { flag: 'key', required: true },
    { flag: 'buckets', required: false, note: 'number of equal-width buckets (default 10)' },
    { flag: 'from', required: false, note: 'shared window start YYYY-MM-DD, to align a column of strips' },
    { flag: 'to', required: false, note: 'shared window end YYYY-MM-DD' },
  ],
  'ai_activity.undertaking.update_head': [
    { flag: 'projectId', required: true },
    { flag: 'key', required: true },
    { flag: 'text', required: true, note: 'the one-line head; prefer --text-file for long text' },
  ],
  'ai_activity.undertaking.tag': [
    { flag: 'projectId', required: true },
    { flag: 'key', required: true },
    { flag: 'add', required: false, note: 'comma-separated; must exist in tags.yaml unless --allowNew' },
    { flag: 'remove', required: false, note: 'comma-separated' },
    { flag: 'accept', required: false, note: 'promote proposedTags to tags' },
    { flag: 'reject', required: false, note: 'drop proposedTags' },
    { flag: 'allowNew', required: false, note: 'boolean flag; extends tags.yaml with the new tags' },
  ],
  'ai_activity.assignment.record': [
    { flag: 'sessionId', required: true, note: 'Claude Code session id, not the commit-footer slug' },
    { flag: 'undertakings', required: true, note: 'comma-separated undertaking keys; a session can feed several' },
    { flag: 'newTitle', required: false, note: 'set when the session opened a new undertaking' },
    { flag: 'head', required: false, note: 'one line of what came out; greedy, so put it last, no quotes needed' },
    { flag: 'section', required: false },
    { flag: 'projectId', required: false },
  ],
  'ai_activity.assignment.queue': [
    { flag: 'projectId', required: false, note: 'omit to sweep every project that has chains' },
  ],
  'ai_activity.assignment.propose': [
    {
      flag: 'proposals',
      required: true,
      note: 'JSON array; prefer --proposals-file. Each: {chainId, projectId, target, confidence, rationale}. target is {kind:"existing",key} | {kind:"new",title} | {kind:"bucket"}',
    },
    { flag: 'proposedBy', required: false, note: 'who is proposing; defaults to "agent"' },
  ],
  'ai_activity.chains.list': [
    { flag: 'projectId', required: true },
    { flag: 'from', required: false, note: 'inclusive YYYY-MM-DD' },
    { flag: 'to', required: false, note: 'inclusive YYYY-MM-DD' },
    { flag: 'undertaking', required: false },
  ],
  'ai_activity.chain.set_project': [
    { flag: 'projectId', required: true, note: 'where the chain is now' },
    { flag: 'chainKey', required: true },
    { flag: 'toProjectId', required: true, note: 'where it belongs; moves the file' },
  ],
  'ai_activity.chain.set_files': [
    { flag: 'projectId', required: true },
    { flag: 'chainKey', required: true },
    { flag: 'written', required: false, note: 'comma-separated root-relative pointers' },
    { flag: 'read', required: false, note: 'comma-separated root-relative pointers' },
  ],
}

function formatInputFields(capability: string): string {
  const fields = CAPABILITY_INPUT_FIELDS[capability]
  if (!fields || fields.length === 0) return '\nFlags: (none)\n'
  const lines = ['', 'Flags:']
  for (const field of fields) {
    const req = field.required ? ' (required)' : ''
    const note = field.note ? ` — ${field.note}` : ''
    lines.push(`  --${field.flag}${req}${note}`)
  }
  return lines.join('\n')
}

export function renderCapabilityHelp(capability: string): string {
  const definition = listCapabilitiesOrch().find(entry => entry.name === capability)
  if (!definition) {
    return `Unknown capability: ${capability}\n\nRun thinkspc list to view available capabilities.`
  }

  return [
    `Capability: ${definition.name}`,
    `Description: ${definition.description}`,
    `Mode: ${definition.readOnly ? 'read-only' : 'write'}`,
    '',
    `Usage: thinkspc ${definition.name} --flag value ...`,
    formatInputFields(definition.name),
    ...((formatExamples(definition.name)).split('\n')),
  ].join('\n').trim()
}

function writeText(text: string): void {
  process.stdout.write(`${text}\n`)
}

type CliOutputFormat = 'json' | 'text'
type CliOutputVerbosity = 'brief' | 'full'

function normalizeOutputFormat(value: string | undefined): CliOutputFormat | null {
  const normalized = (value || '').trim().toLowerCase()
  if (normalized === 'json') return 'json'
  if (normalized === 'text') return 'text'
  return null
}

function normalizeOutputVerbosity(value: string | undefined): CliOutputVerbosity | null {
  const normalized = (value || '').trim().toLowerCase()
  if (normalized === 'brief') return 'brief'
  if (normalized === 'full') return 'full'
  if (normalized === '1' || normalized === 'true' || normalized === 'yes') return 'brief'
  if (normalized === '0' || normalized === 'false' || normalized === 'no') return 'full'
  return null
}

export function resolveOutputFormat(
  args: string[],
  options?: { envFormat?: string; isTTY?: boolean },
): { format: CliOutputFormat; verbosity: CliOutputVerbosity; args: string[] } {
  let explicit: CliOutputFormat | null = null
  let explicitVerbosity: CliOutputVerbosity | null = null
  const passthrough = [...args]
  while (passthrough.length > 0) {
    const head = passthrough[0]
    if (head === '--json') {
      explicit = 'json'
      passthrough.shift()
      continue
    }
    if (head === '--text') {
      explicit = 'text'
      passthrough.shift()
      continue
    }
    if (head === '--brief') {
      explicitVerbosity = 'brief'
      passthrough.shift()
      continue
    }
    if (head === '--full') {
      explicitVerbosity = 'full'
      passthrough.shift()
      continue
    }
    break
  }

  const envFormat = normalizeOutputFormat(options?.envFormat ?? process.env.LTM_OUTPUT_FORMAT)
  const envVerbosity = normalizeOutputVerbosity(process.env.LTM_OUTPUT_BRIEF)
  const isTTY = options?.isTTY ?? Boolean(process.stdout.isTTY)
  const format = explicit ?? envFormat ?? (isTTY ? 'text' : 'json')
  const verbosity = explicitVerbosity ?? envVerbosity ?? 'full'
  return { format, verbosity, args: passthrough }
}

export async function materializeFileBackedInputs(input: Record<string, unknown>): Promise<void> {
  const baseDir = process.env.THINKSPC_CALLER_CWD
    ? path.resolve(process.env.THINKSPC_CALLER_CWD)
    : process.cwd()
  const entries = Object.entries(input)
  for (const [key, rawValue] of entries) {
    if (!key.endsWith('-file')) continue

    const targetKey = key.slice(0, -5)
    const filePath = typeof rawValue === 'string' ? rawValue.trim() : ''
    if (!filePath) {
      throw new Error(`Missing file path for --${key}.`)
    }
    if (input[targetKey] !== undefined) {
      throw new Error(`Cannot combine --${targetKey} with --${key}.`)
    }

    const resolvedFilePath = path.resolve(baseDir, filePath)
    const fileText = await fsPromises.readFile(resolvedFilePath, 'utf-8')
    const normalizedText = fileText.trimEnd()
    if (!normalizedText) {
      throw new Error(`File for --${key} is empty: ${resolvedFilePath}`)
    }
    input[targetKey] = coerceStringInputValue(targetKey, normalizedText, 'file')
    delete input[key]
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function indentText(value: string, spaces = 2): string {
  const prefix = ' '.repeat(spaces)
  return value
    .split('\n')
    .map(line => `${prefix}${line}`)
    .join('\n')
}

function formatUnknown(value: unknown): string {
  return inspect(value, {
    depth: 5,
    colors: Boolean(process.stdout.isTTY),
    compact: false,
    breakLength: 100,
  })
}

function nodeLabel(node: Record<string, unknown>): string {
  const ticket = asString(node.ticket)
  const title = asString(node.title)
  const key = asString(node.key)
  if (ticket && title && !title.startsWith(ticket)) return `${ticket} - ${title}`
  return ticket || title || key || 'Untitled node'
}

function nodeSummary(node: Record<string, unknown>): string {
  const bits: string[] = []
  const type = asString(node.type)
  const status = asString(node.status)
  const taskStatus = asString(node.taskStatus)
  const owner = asString(node.owner)
  if (type) bits.push(type)
  const label = nodeLabel(node)
  bits.push(label)
  if (status) bits.push(`status:${status}`)
  if (taskStatus) bits.push(`task:${taskStatus}`)
  if (owner) bits.push(`owner:${owner}`)
  return bits.join(' | ')
}

function renderNodesSection(nodes: unknown[], heading: string): string[] {
  const lines: string[] = []
  lines.push(`${heading}: ${nodes.length}`)
  const maxRows = 12
  const rows = nodes.slice(0, maxRows)
  rows.forEach((entry, index) => {
    const record = asRecord(entry)
    if (!record) {
      lines.push(`  ${index + 1}. ${String(entry)}`)
      return
    }
    lines.push(`  ${index + 1}. ${nodeSummary(record)}`)
  })
  if (nodes.length > maxRows) {
    lines.push(`  ... ${nodes.length - maxRows} more`)
  }
  return lines
}

function renderListOutput(payload: unknown): string {
  const record = asRecord(payload)
  const capabilities = Array.isArray(record?.capabilities) ? record!.capabilities : []
  const lines: string[] = []

  lines.push(`Capabilities (${capabilities.length})`)
  for (const capability of capabilities) {
    const entry = asRecord(capability)
    if (!entry) continue
    const name = asString(entry.name) || '<unknown>'
    const mode = entry.readOnly === true ? 'read' : 'write'
    const description = asString(entry.description) || ''
    lines.push(`- ${name} [${mode}]${description ? `: ${description}` : ''}`)
  }
  lines.push('')
  lines.push('Tip: run thinkspc <capability> --help for usage examples.')
  return lines.join('\n')
}

function renderListOutputBrief(payload: unknown): string {
  const record = asRecord(payload)
  const capabilities = Array.isArray(record?.capabilities) ? record!.capabilities : []
  const names = capabilities
    .map((capability) => asRecord(capability))
    .filter((entry): entry is Record<string, unknown> => Boolean(entry))
    .map((entry) => asString(entry.name))
    .filter((name): name is string => Boolean(name))
  return `Capabilities (${names.length}): ${names.join(', ')}`
}

function renderInvokeOutput(payload: unknown): string {
  const record = asRecord(payload)
  if (!record) return formatUnknown(payload)

  const capability = asString(record.capability) || '<unknown>'
  const ok = record.ok === true
  const failed = record.ok === false
  if (!ok && !failed) return formatUnknown(payload)

  const lines: string[] = []
  lines.push(`${ok ? 'Success' : 'Failure'}: ${capability}`)

  const requestId = asString(record.requestId)
  const auditId = asString(record.auditId)
  if (requestId) lines.push(`Request: ${requestId}`)
  if (auditId) lines.push(`Audit: ${auditId}`)

  const actor = asRecord(record.actor)
  if (actor) {
    const actorKind = asString(actor.kind) || 'unknown'
    const actorId = asString(actor.id) || 'unknown'
    lines.push(`Actor: ${actorKind}/${actorId}`)
  }

  const warnings = Array.isArray(record.warnings) ? record.warnings : []
  if (warnings.length > 0) {
    lines.push('Warnings:')
    warnings.forEach((warning) => lines.push(`- ${String(warning)}`))
  }

  if (!ok) {
    const error = asRecord(record.error)
    if (error) {
      lines.push(`Error: ${asString(error.code) || 'UNKNOWN'} - ${asString(error.message) || 'Unknown error'}`)
    }
    return lines.join('\n')
  }

  const data = asRecord(record.data)
  if (!data) {
    lines.push('Data:')
    lines.push(indentText(formatUnknown(record.data)))
    return lines.join('\n')
  }

  if (Array.isArray(data.nodes)) {
    lines.push(...renderNodesSection(data.nodes, 'Nodes'))
    return lines.join('\n')
  }

  if (data.node) {
    const node = asRecord(data.node)
    if (node) {
      lines.push('Node:')
      lines.push(`  ${nodeSummary(node)}`)
      const filePath = asString(node.filePath)
      if (filePath) lines.push(`  file: ${filePath}`)
      return lines.join('\n')
    }
  }

  const dataPath = asString(data.path)
  if (dataPath) lines.push(`Path: ${dataPath}`)
  if (Array.isArray(data.likely_impacted)) {
    lines.push(`Likely impacted: ${data.likely_impacted.length}`)
    data.likely_impacted.slice(0, 12).forEach((entry) => lines.push(`  - ${String(entry)}`))
  }
  if (Array.isArray(data.missing_candidates)) {
    lines.push(`Missing candidates: ${data.missing_candidates.length}`)
    data.missing_candidates.slice(0, 12).forEach((entry) => lines.push(`  - ${String(entry)}`))
  }
  if (Array.isArray(data.missing_canonical_pages)) {
    lines.push(`Missing canonical pages: ${data.missing_canonical_pages.length}`)
    data.missing_canonical_pages.slice(0, 12).forEach((entry) => lines.push(`  - ${String(entry)}`))
  }
  if (Array.isArray(data.stale_pages)) {
    lines.push(`Stale pages: ${data.stale_pages.length}`)
    data.stale_pages.slice(0, 12).forEach((entry) => lines.push(`  - ${String(entry)}`))
  }

  lines.push('Data:')
  lines.push(indentText(formatUnknown(data)))
  return lines.join('\n')
}

function renderInvokeOutputBrief(payload: unknown): string {
  const record = asRecord(payload)
  if (!record) return formatUnknown(payload)

  const capability = asString(record.capability) || '<unknown>'
  const ok = record.ok === true
  const failed = record.ok === false
  if (!ok && !failed) return formatUnknown(payload)

  if (!ok) {
    const error = asRecord(record.error)
    if (error) {
      return `Failure: ${capability}\nError: ${asString(error.code) || 'UNKNOWN'} - ${asString(error.message) || 'Unknown error'}`
    }
    return `Failure: ${capability}`
  }

  const lines: string[] = [`Success: ${capability}`]
  const data = asRecord(record.data)
  if (!data) return lines.join('\n')

  if (Array.isArray(data.nodes)) {
    const nodes = data.nodes.slice(0, 5)
    lines.push(`Nodes: ${data.nodes.length}`)
    nodes.forEach((entry, index) => {
      const rec = asRecord(entry)
      lines.push(`  ${index + 1}. ${rec ? nodeSummary(rec) : String(entry)}`)
    })
    if (data.nodes.length > nodes.length) {
      lines.push(`  ... ${data.nodes.length - nodes.length} more`)
    }
    return lines.join('\n')
  }

  if (data.node) {
    const node = asRecord(data.node)
    if (node) {
      lines.push(`Node: ${nodeSummary(node)}`)
      return lines.join('\n')
    }
  }

  const dataPath = asString(data.path)
  if (dataPath) lines.push(`Path: ${dataPath}`)
  if (Array.isArray(data.likely_impacted)) lines.push(`Likely impacted: ${data.likely_impacted.length}`)
  if (Array.isArray(data.missing_canonical_pages)) lines.push(`Missing canonical pages: ${data.missing_canonical_pages.length}`)

  return lines.join('\n')
}

function writeOutput(
  payload: unknown,
  format: CliOutputFormat,
  context: 'list' | 'invoke',
  verbosity: CliOutputVerbosity,
): void {
  if (format === 'json') {
    writeJson(payload)
    return
  }
  if (context === 'list') {
    writeText(verbosity === 'brief' ? renderListOutputBrief(payload) : renderListOutput(payload))
    return
  }
  writeText(verbosity === 'brief' ? renderInvokeOutputBrief(payload) : renderInvokeOutput(payload))
}

// `thinkspc insight ...` — launch an incognito Claude session in a temp dir
// that triggers the log-daily-insight skill in quick-capture mode. The temp
// working dir + the corresponding ~/.claude/projects/<encoded> session folder
// are deleted on exit, so nothing accumulates.
async function runInsightCommand(rawArgs: string[]): Promise<number> {
  const tempDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'insight.'))
  const encodedProject = '-' + tempDir.replaceAll('/', '-')
  const claudeProjectDir = path.join(os.homedir(), '.claude', 'projects', encodedProject)

  const cleanup = async () => {
    try { await fsPromises.rm(tempDir, { recursive: true, force: true }) } catch {}
    try { await fsPromises.rm(claudeProjectDir, { recursive: true, force: true }) } catch {}
  }

  const inlineText = rawArgs.join(' ').trim()
  const claudeArgs = inlineText ? ['-p', `insight: ${inlineText}`] : []
  const claudeBin = process.env.CLAUDE_BIN ?? 'claude'

  let exitCode = 0
  try {
    exitCode = await new Promise<number>((resolve, reject) => {
      const child = spawn(claudeBin, claudeArgs, {
        cwd: tempDir,
        stdio: 'inherit',
        env: process.env,
      })
      child.on('error', err => {
        reject(new Error(`Failed to launch \`${claudeBin}\`: ${err instanceof Error ? err.message : String(err)}. Is Claude Code installed and on PATH? Override with the CLAUDE_BIN env var.`))
      })
      child.on('exit', code => resolve(code ?? 0))
    })
  } finally {
    await cleanup()
  }
  return exitCode
}

async function main(): Promise<void> {
  const { format: outputFormat, verbosity: outputVerbosity, args } = resolveOutputFormat(process.argv.slice(2))
  const command = args[0]

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    writeText(renderRunnerHelp())
    return
  }

  if (command === 'insight') {
    const code = await runInsightCommand(args.slice(1))
    process.exit(code)
  }

  if (command === 'list') {
    writeOutput(await runCapabilityRunnerCommand('list'), outputFormat, 'list', outputVerbosity)
    return
  }

  if (command === 'invoke') {
    const payload = await parseInvokePayload()
    writeOutput(await runCapabilityRunnerCommand('invoke', payload), outputFormat, 'invoke', outputVerbosity)
    return
  }

  if (command && looksLikeHttpUrl(command)) {
    const context = buildOrganizerContextFromArgs(['--url', command, ...args.slice(1)])
    if (outputFormat === 'json') {
      writeJson({
        ok: true,
        command: 'organizer.context',
        data: context,
      })
    } else {
      writeText(renderOrganizerContextOutput(context))
    }
    return
  }

  const shortcutResolution = resolveCommandShortcut(command, args.slice(1))
  writeCLIWarnings(shortcutResolution.warnings)
  const resolvedCommand = shortcutResolution.command
  const resolvedArgs = shortcutResolution.args

  if (resolvedCommand === 'organizer.context') {
    const cliArgs = resolvedArgs
    if (cliArgs.includes('--help') || cliArgs.includes('-h')) {
      writeText(renderOrganizerContextHelp())
      return
    }
    const context = buildOrganizerContextFromArgs(cliArgs)
    if (outputFormat === 'json') {
      writeJson({
        ok: true,
        command: 'organizer.context',
        data: context,
      })
    } else {
      writeText(renderOrganizerContextOutput(context))
    }
    return
  }

  // CLI-arg mode: treat argv[2] as a capability name
  if (listCapabilitiesOrch().some(capability => capability.name === resolvedCommand)) {
    const cliArgs = resolvedArgs
    if (cliArgs.includes('--help') || cliArgs.includes('-h')) {
      writeText(renderCapabilityHelp(resolvedCommand))
      return
    }
    const { payload, warnings } = buildCLIInvokePayload(resolvedCommand, cliArgs)

    // --text-stdin: read the --text value from stdin to avoid shell quoting issues
    const input = payload.request.input as Record<string, unknown>
    await materializeFileBackedInputs(input)
    if (input['text-stdin'] === true) {
      delete input['text-stdin']
      if (typeof input.text === 'string' && input.text.trim()) {
        throw new Error('Cannot combine --text-stdin with --text/--text-file.')
      }
      const stdinText = await readStdin()
      if (!stdinText.trim()) {
        throw new Error('--text-stdin was set but stdin was empty. Pipe text via stdin.')
      }
      input.text = stdinText.trim()
    }

    writeCLIWarnings(warnings)
    writeOutput(await runCapabilityRunnerCommand('invoke', payload), outputFormat, 'invoke', outputVerbosity)
    return
  }

  throw new Error(`Unknown command: ${command ?? '<missing>'}. Use "list", "invoke", organizer shortcuts (e.g. search, claim, done), or a capability name (e.g. organizer.nodes.list_roots).`)
}

export async function runCapabilityRunnerCommand(
  command: 'list' | 'invoke',
  payload?: InvokePayload,
): Promise<unknown> {
  ensureRunnerEnvironment()

  if (command === 'list') {
    return {
      ok: true,
      capabilities: listCapabilitiesOrch(),
    }
  }

  if (!payload) {
    throw new Error('Invoke command requires payload.')
  }

  if (payload.apiBaseUrl) {
    ;(globalThis as any).__LTM_API_BASE__ = payload.apiBaseUrl
  }

  const fs = new NodeVaultFS(payload.vaultRoot)
  const isWrite = capabilityRequiresVaultSync(payload.request.capability)
  // Hydrate the organizer DB for every capability — reads included. Search,
  // list, and get capabilities query IndexedDB, so skipping sync on reads
  // silently returns empty results. Two-phase sync keeps this fast:
  //   1. If a disk snapshot exists for this vault, hydrate the in-memory
  //      DB from it and run an incremental mtime-based sync — typical
  //      warm-run cost is < 1 s for an unchanged vault.
  //   2. Otherwise (cold start, vault changed, or snapshot missing) do a
  //      full sync. Scope it to the project root when the capability
  //      input supplies one so we don't pay for unrelated files.
  const projectRoot = extractProjectRootFromInput(payload.request.input)
  const loaded = await tryLoadCliCache(payload.vaultRoot)
  if (loaded) {
    await incrementalSync(loaded.lastSyncTimestamp, fs)
  } else {
    await fullSync(fs, projectRoot ? { rootPath: projectRoot } : undefined)
  }
  const result = await invokeCapabilityOrch(payload.request, { fs })
  // Persist the DB so the next CLI run starts warm: after writes, and after
  // an unscoped cold sync (a projectRoot-scoped sync would persist a partial
  // snapshot). Done after a successful invoke so errors don't corrupt the
  // cache. Snapshot save failures only get logged — they shouldn't break the
  // user-visible result.
  if (isWrite || (!loaded && !projectRoot)) {
    await saveCliCache(payload.vaultRoot).catch((err) => {
      console.warn(`[cli-cache] save failed: ${err instanceof Error ? err.message : String(err)}`)
    })
  }
  return result
}

function extractProjectRootFromInput(input: unknown): string | undefined {
  if (!input || typeof input !== 'object') return undefined
  const value = (input as Record<string, unknown>).projectRoot
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

// ── CLI DB snapshot (persistent across invocations) ──

interface CliCacheSnapshot {
  version: number
  vaultRoot: string
  savedAt: string
  lastSyncTimestamp: number
  nodes: NodeRecord[]
  links: Omit<LinkRecord, 'id'>[]
}

const CLI_CACHE_VERSION = 1

function getCliCachePath(): string {
  return path.join(homedir(), '.thinking-space', 'cli-cache.json')
}

async function tryLoadCliCache(vaultRoot: string): Promise<CliCacheSnapshot | null> {
  const cachePath = getCliCachePath()
  let raw: string
  try {
    raw = await fsPromises.readFile(cachePath, 'utf-8')
  } catch {
    return null
  }
  let snapshot: CliCacheSnapshot
  try {
    snapshot = JSON.parse(raw)
  } catch (err) {
    console.warn(`[cli-cache] invalid JSON at ${cachePath}: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
  if (snapshot.version !== CLI_CACHE_VERSION) return null
  if (path.resolve(snapshot.vaultRoot) !== path.resolve(vaultRoot)) return null
  if (!Array.isArray(snapshot.nodes) || !Array.isArray(snapshot.links)) return null

  // Hydrate the in-memory DB. clearAll first to be safe — there should be
  // nothing in the fresh fake-indexeddb yet, but defensive against future
  // changes that might prime it.
  await clearAll()
  await clearAllLinks()
  // Drop synthetic 'id' from cached nodes so Dexie reassigns them on insert.
  const nodes = snapshot.nodes.map((n) => {
    const { id: _id, ...rest } = n as NodeRecord & { id?: number }
    return rest as Omit<NodeRecord, 'id'>
  })
  await bulkUpsertNodes(nodes)
  await bulkUpsertLinks(snapshot.links)
  return snapshot
}

async function saveCliCache(vaultRoot: string): Promise<void> {
  const cachePath = getCliCachePath()
  await fsPromises.mkdir(path.dirname(cachePath), { recursive: true })
  const nodes = await getAllNodes()
  const links = (await getAllLinks()).map((l) => {
    const { id: _id, ...rest } = l
    return rest
  })
  const snapshot: CliCacheSnapshot = {
    version: CLI_CACHE_VERSION,
    vaultRoot: path.resolve(vaultRoot),
    savedAt: new Date().toISOString(),
    lastSyncTimestamp: Math.floor(Date.now() / 1000),
    nodes,
    links,
  }
  const tmp = `${cachePath}.${process.pid}.tmp`
  await fsPromises.writeFile(tmp, JSON.stringify(snapshot), { encoding: 'utf-8', mode: 0o600 })
  await fsPromises.rename(tmp, cachePath)
}

function capabilityRequiresVaultSync(capability: CapabilityInvokeRequest['capability']): boolean {
  return capability === 'organizer.node.create'
    || capability === 'organizer.node.rename'
    || capability === 'organizer.node.update'
    || capability === 'organizer.node.move'
    || capability === 'organizer.node.delete'
    || capability === 'task.claim'
    || capability === 'task.update_status'
    || capability === 'run.log'
    || capability === 'handoff.create'
    || capability === 'comment.add'
}

async function parseInvokePayload(): Promise<InvokePayload> {
  const stdin = await readStdin()
  if (!stdin.trim()) {
    throw new Error('Missing invoke payload in stdin.')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(stdin)
  } catch (error) {
    throw new Error(`Invalid JSON payload: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invoke payload must be a JSON object.')
  }

  const payload = parsed as Partial<InvokePayload>
  if (!payload.vaultRoot || typeof payload.vaultRoot !== 'string') {
    throw new Error('Invoke payload requires a string "vaultRoot".')
  }
  if (!payload.request || typeof payload.request !== 'object') {
    throw new Error('Invoke payload requires a "request" object.')
  }

  return {
    vaultRoot: payload.vaultRoot,
    request: payload.request as CapabilityInvokeRequest,
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks).toString('utf-8')
}

function writeJson(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`)
}

function ensureRunnerEnvironment(): void {
  installLocalStorageShim()
  applyRunnerFeatureFlagsFromEnv()
}

export function installLocalStorageShim(): void {
  if (isUsableLocalStorage((globalThis as Record<string, unknown>).localStorage)) return
  Object.defineProperty(globalThis, 'localStorage', {
    value: new InMemoryLocalStorage(),
    configurable: true,
    enumerable: false,
    writable: false,
  })
}

function applyRunnerFeatureFlagsFromEnv(): void {
  const hasAgent = process.env.LTM_AGENT_CAPABILITIES_ENABLED !== undefined
  const hasFastapi = process.env.LTM_FASTAPI_CAPABILITY_ADAPTER_ENABLED !== undefined
  if (!hasAgent && !hasFastapi) return

  let flags = {
    agent_capabilities_enabled: false,
    fastapi_capability_adapter_enabled: false,
  }

  try {
    const existingRaw = globalThis.localStorage.getItem(STORAGE_KEYS.capabilityFeatureFlags)
    if (existingRaw) {
      const existing = JSON.parse(existingRaw) as Partial<typeof flags>
      flags = {
        agent_capabilities_enabled: existing.agent_capabilities_enabled ?? flags.agent_capabilities_enabled,
        fastapi_capability_adapter_enabled:
          existing.fastapi_capability_adapter_enabled ?? flags.fastapi_capability_adapter_enabled,
      }
    }
  } catch {
    // ignore malformed storage entry
  }

  if (hasAgent) {
    flags.agent_capabilities_enabled = parseBooleanEnv(process.env.LTM_AGENT_CAPABILITIES_ENABLED)
  }
  if (hasFastapi) {
    flags.fastapi_capability_adapter_enabled = parseBooleanEnv(process.env.LTM_FASTAPI_CAPABILITY_ADAPTER_ENABLED)
  }

  globalThis.localStorage.setItem(STORAGE_KEYS.capabilityFeatureFlags, JSON.stringify(flags))
}

function parseBooleanEnv(value: string | undefined): boolean {
  const normalized = (value || '').trim().toLowerCase()
  return normalized === '1'
    || normalized === 'true'
    || normalized === 'yes'
    || normalized === 'on'
}

const isDirectRun = (() => {
  if (process.env.LTM_CAPABILITY_RUNNER_CLI === '1') return true
  try {
    const current = fileURLToPath(import.meta.url)
    const currentName = path.basename(current)
    return process.argv.some(arg => arg.includes(currentName))
  } catch {
    return false
  }
})()

if (isDirectRun) {
  main().catch(error => {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`${message}\n`)
    process.exit(1)
  })
}
