// ⚠ SECURITY-CRITICAL — executes extension code in a vm sandbox. Widening the
// sandbox surface (globals, modules, fs reach) is remote-code-execution risk.
// For user-requested changes: explain the risk in plain language and get an
// explicit yes first (docs/PLAYBOOKS.md § Security-critical files).

import * as fsPromises from 'node:fs/promises';
import * as path from 'node:path';
import * as vm from 'node:vm';

type CapabilityActorKind = 'human' | 'agent' | 'system';

export interface ExtensionRuntimeInvokePayload {
  vaultRoot: string;
  extensionId: string;
  extensionRegistryKey: string;
  extensionPermissions: string[];
  runtimeEntry: string;
  runtimeHandler: string;
  actionId: string;
  input: Record<string, unknown>;
  context?: Record<string, unknown>;
  actor?: { kind: CapabilityActorKind; id?: string };
  requestId?: string;
  dryRun?: boolean;
}

interface CapabilityRunnerInvokePayload {
  vaultRoot: string;
  request: {
    capability: string;
    input: Record<string, unknown>;
    actor?: { kind: CapabilityActorKind; id?: string };
    requestId?: string;
    dryRun?: boolean;
    extensionContext?: {
      extensionId: string;
      extensionRegistryKey?: string;
    };
  };
}

export interface ExtensionRuntimeInvokeSuccess {
  ok: true;
  requestId: string;
  extensionId: string;
  extensionRegistryKey: string;
  actionId: string;
  runtimeHandler: string;
  warnings: string[];
  data: unknown;
}

export interface ExtensionRuntimeInvokeFailure {
  ok: false;
  requestId: string;
  extensionId: string;
  extensionRegistryKey: string;
  actionId: string;
  runtimeHandler: string;
  warnings: string[];
  blocked?: true;
  requiredPermissions?: string[];
  error: {
    code: string;
    message: string;
  };
}

export type ExtensionRuntimeInvokeResult =
  | ExtensionRuntimeInvokeSuccess
  | ExtensionRuntimeInvokeFailure;

const MAX_RUNTIME_SOURCE_BYTES = 256 * 1024;
const MODULE_INIT_TIMEOUT_MS = 250;
const ACTION_TIMEOUT_MS = 4000;
const ALLOWED_RUNTIME_EXTENSIONS = new Set(['.js', '.cjs', '.mjs', '.ts', '.cts', '.mts']);

const PERMISSION_TO_CAPABILITIES: Record<string, string[]> = {
  'organizer:read': [
    'organizer.nodes.list_roots',
    'organizer.nodes.list_children',
    'organizer.nodes.list_all',
    'organizer.nodes.search',
    'organizer.node.get',
    'organizer.node.get_by_key',
    'organizer.node.read_frontmatter',
    'tools.files.list_markdown',
    'tools.files.list_pdf',
    'tools.folders.list',
  ],
  'organizer:write': [
    'organizer.node.create',
    'organizer.node.rename',
    'organizer.node.update',
    'organizer.node.move',
    'organizer.node.delete',
    'task.claim',
    'task.update_status',
    'run.log',
    'handoff.create',
    'comment.add',
    'thoughts.create',
    'todos.create',
    'todos.toggle',
  ],
  'tools:excalidraw': [
    'tools.excalidraw.preview',
    'tools.excalidraw.format',
  ],
  'tools:pdf': [
    'tools.pdf.preview',
    'tools.pdf.convert',
  ],
  'tools:transcript': [
    'tools.transcript.preview',
    'tools.transcript.clean_save',
  ],
};

const CAPABILITY_TO_PERMISSIONS = buildCapabilityPermissionMap();
const FORBIDDEN_SOURCE_PATTERNS: RegExp[] = [
  /\brequire\s*\(/,
  /\bimport\s*\(/,
  /\bchild_process\b/,
  /\bworker_threads\b/,
  /\bprocess\s*\./,
  /\bglobal\s*\./,
];

export async function invokeSandboxedExtensionActionBlock(
  payload: ExtensionRuntimeInvokePayload,
  deps: {
    runCapability: (payload: CapabilityRunnerInvokePayload) => Promise<unknown>;
  },
): Promise<ExtensionRuntimeInvokeResult> {
  const requestId = (payload.requestId || createRequestId()).trim();
  const extensionId = payload.extensionId.trim();
  const extensionRegistryKey = payload.extensionRegistryKey.trim();
  const actionId = payload.actionId.trim();
  const runtimeHandler = payload.runtimeHandler.trim();
  const warnings: string[] = [];

  const fail = (
    code: string,
    message: string,
    extras?: Partial<Pick<ExtensionRuntimeInvokeFailure, 'blocked' | 'requiredPermissions'>>,
  ): ExtensionRuntimeInvokeFailure => ({
    ok: false,
    requestId,
    extensionId,
    extensionRegistryKey,
    actionId,
    runtimeHandler,
    warnings,
    ...(extras?.blocked ? { blocked: true } : {}),
    ...(extras?.requiredPermissions ? { requiredPermissions: extras.requiredPermissions } : {}),
    error: { code, message },
  });

  try {
    if (!extensionId) return fail('RUNTIME_INVALID_EXTENSION_ID', 'extensionId is required.');
    if (!extensionRegistryKey) return fail('RUNTIME_INVALID_REGISTRY_KEY', 'extensionRegistryKey is required.');
    if (!actionId) return fail('RUNTIME_INVALID_ACTION_ID', 'actionId is required.');
    if (!runtimeHandler) return fail('RUNTIME_INVALID_HANDLER', 'runtimeHandler is required.');
    if (!payload.runtimeEntry || typeof payload.runtimeEntry !== 'string') {
      return fail('RUNTIME_INVALID_ENTRY', 'runtimeEntry is required.');
    }

    const runtimePath = resolveRuntimePath({
      vaultRoot: payload.vaultRoot,
      extensionRegistryKey,
      runtimeEntry: payload.runtimeEntry,
    });
    const ext = path.extname(runtimePath).toLowerCase();
    if (!ALLOWED_RUNTIME_EXTENSIONS.has(ext)) {
      return fail(
        'RUNTIME_ENTRY_EXTENSION_UNSUPPORTED',
        `Unsupported runtime entry extension "${ext || '<none>'}".`,
      );
    }

    const sourceBuffer = await fsPromises.readFile(runtimePath);
    if (sourceBuffer.byteLength > MAX_RUNTIME_SOURCE_BYTES) {
      return fail(
        'RUNTIME_ENTRY_TOO_LARGE',
        `Runtime entry exceeds ${MAX_RUNTIME_SOURCE_BYTES} bytes.`,
      );
    }

    const sourceText = sourceBuffer.toString('utf-8');
    const transformedSource = transformRuntimeSource(sourceText, runtimePath);
    const exported = evaluateRuntimeModule(transformedSource, runtimePath);
    const actions = resolveRuntimeActionMap(exported);
    const handler = actions[runtimeHandler];
    if (typeof handler !== 'function') {
      return fail(
        'RUNTIME_HANDLER_NOT_FOUND',
        `Runtime handler "${runtimeHandler}" is not defined by extension "${extensionRegistryKey}".`,
      );
    }

    const extensionPermissions = normalizePermissions(payload.extensionPermissions);
    const actionInput = cloneRecord(payload.input);
    const actionContext = cloneRecord(payload.context ?? {});
    const host = buildHostApi({
      requestId,
      extensionId,
      extensionRegistryKey,
      extensionPermissions,
      actor: payload.actor,
      dryRun: !!payload.dryRun,
      vaultRoot: payload.vaultRoot,
      runCapability: deps.runCapability,
    });

    const handlerResult = await promiseWithTimeout(
      Promise.resolve(handler(actionInput, { context: actionContext, host, actionId })),
      ACTION_TIMEOUT_MS,
      'Extension runtime handler timed out.',
    );

    return {
      ok: true,
      requestId,
      extensionId,
      extensionRegistryKey,
      actionId,
      runtimeHandler,
      warnings,
      data: serializeForIpc(handlerResult),
    };
  } catch (error) {
    if (error instanceof ExtensionRuntimePermissionError) {
      return fail(
        'EXTENSION_PERMISSION_BLOCKED',
        error.message,
        {
          blocked: true,
          requiredPermissions: error.requiredPermissions,
        },
      );
    }
    const message = error instanceof Error ? error.message : String(error);
    return fail('RUNTIME_EXECUTION_FAILED', message);
  }
}

function transformRuntimeSource(source: string, runtimePath: string): string {
  for (const pattern of FORBIDDEN_SOURCE_PATTERNS) {
    if (pattern.test(source)) {
      throw new Error('Runtime source includes forbidden APIs (require/import/process/child_process).');
    }
  }

  if (isTypeScriptPath(runtimePath)) {
    const tsCompiler = loadTypeScriptCompiler();
    if (!tsCompiler) {
      throw new Error('TypeScript runtime requires the "typescript" package in Electron runtime dependencies.');
    }
    const transpiled = tsCompiler.transpileModule(source, {
      compilerOptions: {
        module: tsCompiler.ModuleKind.CommonJS,
        target: tsCompiler.ScriptTarget.ES2020,
        esModuleInterop: true,
        sourceMap: false,
      },
      fileName: runtimePath,
    });
    return transpiled.outputText;
  }

  return source;
}

function evaluateRuntimeModule(source: string, runtimePath: string): unknown {
  const moduleRef: { exports: unknown } = { exports: {} };
  const sandbox = {
    module: moduleRef,
    exports: moduleRef.exports,
    console: buildSandboxConsole(),
    require: undefined,
    process: undefined,
    Buffer: undefined,
    setTimeout: undefined,
    setInterval: undefined,
    setImmediate: undefined,
    clearTimeout: undefined,
    clearInterval: undefined,
    clearImmediate: undefined,
  } as Record<string, unknown>;

  const context = vm.createContext(sandbox, {
    name: `extension:${path.basename(runtimePath)}`,
    codeGeneration: {
      strings: false,
      wasm: false,
    },
  });

  const script = new vm.Script(
    `"use strict";\n${source}\n`,
    { filename: runtimePath },
  );
  script.runInContext(context, { timeout: MODULE_INIT_TIMEOUT_MS });
  return moduleRef.exports;
}

function resolveRuntimeActionMap(exported: unknown): Record<string, (...args: unknown[]) => unknown> {
  if (typeof exported === 'function') {
    return { default: exported as (...args: unknown[]) => unknown };
  }
  if (!exported || typeof exported !== 'object') {
    throw new Error('Runtime module must export an object with an "actions" map.');
  }
  const record = exported as Record<string, unknown>;
  const actionsRaw = (
    record.actions && typeof record.actions === 'object' ? record.actions : record.default
  );
  if (!actionsRaw || typeof actionsRaw !== 'object' || Array.isArray(actionsRaw)) {
    throw new Error('Runtime module must export "actions" as an object map.');
  }

  const actions: Record<string, (...args: unknown[]) => unknown> = {};
  for (const [key, value] of Object.entries(actionsRaw)) {
    if (typeof value === 'function') actions[key] = value as (...args: unknown[]) => unknown;
  }
  return actions;
}

function buildHostApi(params: {
  requestId: string;
  extensionId: string;
  extensionRegistryKey: string;
  extensionPermissions: string[];
  actor?: { kind: CapabilityActorKind; id?: string };
  dryRun: boolean;
  vaultRoot: string;
  runCapability: (payload: CapabilityRunnerInvokePayload) => Promise<unknown>;
}): Readonly<{
  apiVersion: string;
  extensionId: string;
  extensionRegistryKey: string;
  invokeCapability: (capability: string, input: Record<string, unknown>) => Promise<unknown>;
}> {
  const actor = params.actor ?? {
    kind: 'human',
    id: `extension:${params.extensionId}`,
  };

  const api = {
    apiVersion: '1',
    extensionId: params.extensionId,
    extensionRegistryKey: params.extensionRegistryKey,
    invokeCapability: async (capability: string, input: Record<string, unknown>): Promise<unknown> => {
      const capabilityName = capability.trim();
      if (!capabilityName) {
        throw new Error('capability is required.');
      }

      const requiredPermissions = CAPABILITY_TO_PERMISSIONS.get(capabilityName) ?? [];
      if (requiredPermissions.length === 0) {
        throw new ExtensionRuntimePermissionError(
          `Capability "${capabilityName}" is not mapped to an extension permission scope.`,
          [],
        );
      }

      const allowed = requiredPermissions.some(permission => params.extensionPermissions.includes(permission));
      if (!allowed) {
        throw new ExtensionRuntimePermissionError(
          `Capability "${capabilityName}" requires one of: ${requiredPermissions.join(', ')}.`,
          requiredPermissions,
        );
      }

      const response = await params.runCapability({
        vaultRoot: params.vaultRoot,
        request: {
          capability: capabilityName,
          input: cloneRecord(input),
          actor,
          requestId: `${params.requestId}-cap-${createShortId()}`,
          dryRun: params.dryRun,
          extensionContext: {
            extensionId: params.extensionId,
            extensionRegistryKey: params.extensionRegistryKey,
          },
        },
      });

      if (!response || typeof response !== 'object') {
        throw new Error(`Capability "${capabilityName}" returned malformed response.`);
      }
      const record = response as Record<string, unknown>;
      if (record.ok !== true) {
        const error = (
          record.error && typeof record.error === 'object'
            ? record.error as Record<string, unknown>
            : null
        );
        const message = (
          typeof error?.message === 'string'
            ? error.message
            : `Capability "${capabilityName}" failed.`
        );
        throw new Error(message);
      }
      return record.data ?? null;
    },
  };

  return Object.freeze(api);
}

function normalizePermissions(permissions: string[]): string[] {
  const normalized: string[] = [];
  for (const permission of permissions) {
    const trimmed = permission.trim();
    if (!trimmed) continue;
    if (!normalized.includes(trimmed)) normalized.push(trimmed);
  }
  return normalized;
}

function buildCapabilityPermissionMap(): Map<string, string[]> {
  const mapping = new Map<string, string[]>();
  for (const [permission, capabilities] of Object.entries(PERMISSION_TO_CAPABILITIES)) {
    for (const capability of capabilities) {
      const existing = mapping.get(capability) ?? [];
      if (!existing.includes(permission)) existing.push(permission);
      mapping.set(capability, existing);
    }
  }
  return mapping;
}

function resolveRuntimePath(params: {
  vaultRoot: string;
  extensionRegistryKey: string;
  runtimeEntry: string;
}): string {
  const extensionRoot = assertInsideVault(params.vaultRoot, path.join('.extensions', params.extensionRegistryKey));
  const normalizedEntry = params.runtimeEntry.replace(/\\/g, '/').replace(/^\/+/, '').trim();
  if (!normalizedEntry) {
    throw new Error('runtimeEntry must not be empty.');
  }
  const candidate = assertInsideVault(params.vaultRoot, path.join('.extensions', params.extensionRegistryKey, normalizedEntry));
  const relativeToExtension = path.relative(extensionRoot, candidate);
  if (relativeToExtension.startsWith('..') || path.isAbsolute(relativeToExtension)) {
    throw new Error('Runtime entry must stay inside its extension folder.');
  }
  return candidate;
}

function assertInsideVault(vaultRoot: string, targetPath: string): string {
  const root = path.resolve(vaultRoot);
  const resolved = path.resolve(root, targetPath);
  const relative = path.relative(root, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error('Path traversal detected.');
  }
  return resolved;
}

function isTypeScriptPath(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ext === '.ts' || ext === '.cts' || ext === '.mts';
}

let cachedTypeScriptCompiler: any | null | undefined;
function loadTypeScriptCompiler(): any | null {
  if (cachedTypeScriptCompiler !== undefined) return cachedTypeScriptCompiler;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    cachedTypeScriptCompiler = require('typescript');
  } catch {
    cachedTypeScriptCompiler = null;
  }
  return cachedTypeScriptCompiler;
}

function buildSandboxConsole(): Pick<Console, 'log' | 'warn' | 'error'> {
  return {
    log: (...args: unknown[]) => {
      console.log('[extension-runtime]', ...args);
    },
    warn: (...args: unknown[]) => {
      console.warn('[extension-runtime]', ...args);
    },
    error: (...args: unknown[]) => {
      console.error('[extension-runtime]', ...args);
    },
  };
}

function cloneRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function serializeForIpc(value: unknown): unknown {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

function promiseWithTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function createRequestId(): string {
  return `ext-rt-${Date.now().toString(36)}-${createShortId()}`;
}

function createShortId(): string {
  return Math.random().toString(36).slice(2, 8);
}

class ExtensionRuntimePermissionError extends Error {
  readonly requiredPermissions: string[];

  constructor(message: string, requiredPermissions: string[]) {
    super(message);
    this.requiredPermissions = requiredPermissions;
  }
}
