import { app } from 'electron';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';

const CLI_INSTALL_STATE_RELATIVE_PATH_BLOCK = path.join('state', 'cli-install-state.json');

export type CliInstallModeBlock = 'copied' | 'copied_with_admin' | 'cmd_wrapper';
export type CliEnsureStatusBlock = 'installed' | 'already_current' | 'skipped' | 'failed';

export interface CliInstallStateBlock {
  installedVersion?: string;
  installedPath?: string;
  installedAt?: string;
  installMode?: CliInstallModeBlock;
  lastFailureResourcesPath?: string;
  lastFailureCode?: string;
  lastFailureMessage?: string;
  lastFailureAt?: string;
}

export interface CliInstallTargetOptionsBlock {
  platform?: NodeJS.Platform;
  homePath?: string;
  localAppData?: string;
  userProfile?: string;
}

export interface InstallCliToolOptionsBlock {
  sourcePath: string;
  targetPath: string;
  resourcesPath: string;
  platform?: NodeJS.Platform;
  tempDir?: string;
  runMacAdminInstall?: (sourcePath: string, targetPath: string) => Promise<void>;
}

export interface EnsureCliToolInstalledOptionsBlock {
  appVersion?: string;
  isPackaged?: boolean;
  sourcePath?: string;
  targetPath?: string;
  resourcesPath?: string;
  userDataPath?: string;
  platform?: NodeJS.Platform;
}

export interface EnsureCliToolInstalledResultBlock {
  status: CliEnsureStatusBlock;
  targetPath: string;
  installMode?: CliInstallModeBlock;
  reason?: string;
  errorMessage?: string;
}

export function getCliSourcePathBlock(resourcesPath: string = process.resourcesPath): string {
  const cliWrapper = path.join(resourcesPath, 'cli', 'thinkspc-standalone.sh');
  if (!fs.existsSync(cliWrapper)) {
    throw new Error(
      `CLI wrapper not found at ${cliWrapper}. The app may not have been built with CLI resources bundled.`,
    );
  }
  return cliWrapper;
}

export function getCliTargetPathBlock(options: CliInstallTargetOptionsBlock = {}): string {
  const platform = options.platform ?? process.platform;
  if (platform === 'win32') {
    const appData = options.localAppData
      || process.env.LOCALAPPDATA
      || path.join(options.userProfile || process.env.USERPROFILE || '', 'AppData', 'Local');
    return path.join(appData, 'thinkspc', 'thinkspc.cmd');
  }
  if (platform === 'linux') {
    const homePath = options.homePath || process.env.HOME || os.homedir();
    return path.join(homePath, '.local', 'bin', 'thinkspc');
  }
  return '/usr/local/bin/thinkspc';
}

export function getCliInstallStatePathBlock(userDataPath: string = app.getPath('userData')): string {
  return path.join(userDataPath, CLI_INSTALL_STATE_RELATIVE_PATH_BLOCK);
}

export function readCliInstallStateBlock(userDataPath: string = app.getPath('userData')): CliInstallStateBlock {
  const filePath = getCliInstallStatePathBlock(userDataPath);
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    if (!raw.trim()) return {};
    const parsed = JSON.parse(raw) as CliInstallStateBlock;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function writeCliInstallStateBlock(
  patch: Partial<CliInstallStateBlock>,
  userDataPath: string = app.getPath('userData'),
): CliInstallStateBlock {
  const current = readCliInstallStateBlock(userDataPath);
  const next: CliInstallStateBlock = { ...current, ...patch };
  const filePath = getCliInstallStatePathBlock(userDataPath);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(next, null, 2), { encoding: 'utf-8', mode: 0o600 });
  fs.renameSync(tempPath, filePath);
  return next;
}

export function isMountedDmgResourcesPathBlock(resourcesPath: string, platform: NodeJS.Platform = process.platform): boolean {
  return platform === 'darwin' && /^\/Volumes\//.test(resourcesPath);
}

export function buildInstalledCliWrapperBlock(sourceContent: string, resourcesPath: string): string {
  const normalizedSource = sourceContent.replace(/\r\n/g, '\n');
  const lines = normalizedSource.split('\n');
  const envLine = `THINKSPC_APP_RESOURCES=${toShellSingleQuotedBlock(resourcesPath)}`;
  const exportLine = 'export THINKSPC_APP_RESOURCES';

  if (lines[0]?.startsWith('#!')) {
    return [lines[0], envLine, exportLine, ...lines.slice(1)].join('\n');
  }
  return [envLine, exportLine, normalizedSource].join('\n');
}

export async function installCliToolBlock(options: InstallCliToolOptionsBlock): Promise<{ targetPath: string; installMode: CliInstallModeBlock }> {
  const platform = options.platform ?? process.platform;
  const sourcePath = options.sourcePath;
  const targetPath = options.targetPath;

  if (platform === 'win32') {
    const cmdContent = `@echo off\r\nbash "${sourcePath}" %*\r\n`;
    await fsPromises.mkdir(path.dirname(targetPath), { recursive: true });
    await fsPromises.writeFile(targetPath, cmdContent, { encoding: 'utf-8', mode: 0o755 });
    return { targetPath, installMode: 'cmd_wrapper' };
  }

  const sourceContent = await fsPromises.readFile(sourcePath, 'utf-8');
  const installedContent = buildInstalledCliWrapperBlock(sourceContent, options.resourcesPath);

  try {
    await writeExecutableFileBlock(targetPath, installedContent);
    return { targetPath, installMode: 'copied' };
  } catch (error) {
    if (platform === 'darwin' && shouldUseMacAdminInstallBlock(error)) {
      const tempDir = options.tempDir ?? app.getPath('temp');
      const tempWrapperPath = path.join(tempDir, `thinkspc-install-${process.pid}.sh`);
      await fsPromises.mkdir(path.dirname(tempWrapperPath), { recursive: true });
      await fsPromises.writeFile(tempWrapperPath, installedContent, { encoding: 'utf-8', mode: 0o755 });
      await fsPromises.chmod(tempWrapperPath, 0o755);
      try {
        const runMacAdminInstall = options.runMacAdminInstall ?? runMacAdminInstallBlock;
        await runMacAdminInstall(tempWrapperPath, targetPath);
      } finally {
        await fsPromises.rm(tempWrapperPath, { force: true }).catch(() => undefined);
      }
      return { targetPath, installMode: 'copied_with_admin' };
    }
    throw error;
  }
}

export async function ensureCliToolInstalledBlock(
  options: EnsureCliToolInstalledOptionsBlock = {},
): Promise<EnsureCliToolInstalledResultBlock> {
  const isPackaged = options.isPackaged ?? app.isPackaged;
  const resourcesPath = options.resourcesPath ?? process.resourcesPath;
  const platform = options.platform ?? process.platform;
  const userDataPath = options.userDataPath ?? app.getPath('userData');
  const targetPath = options.targetPath ?? getCliTargetPathBlock({ platform });
  const appVersion = options.appVersion ?? app.getVersion();

  if (!isPackaged) {
    return { status: 'skipped', targetPath, reason: 'dev_mode' };
  }

  if (isMountedDmgResourcesPathBlock(resourcesPath, platform)) {
    return { status: 'skipped', targetPath, reason: 'mounted_dmg' };
  }

  const sourcePath = options.sourcePath ?? getCliSourcePathBlock(resourcesPath);
  const state = readCliInstallStateBlock(userDataPath);
  const currentContent = await readTextFileIfPresentBlock(targetPath);
  const desiredContent = await buildDesiredCliTargetContentBlock({
    platform,
    sourcePath,
    resourcesPath,
  });

  if (currentContent === desiredContent) {
    writeCliInstallStateBlock({
      installedVersion: appVersion,
      installedPath: targetPath,
      installedAt: new Date().toISOString(),
      installMode: platform === 'win32' ? 'cmd_wrapper' : 'copied',
      lastFailureResourcesPath: undefined,
      lastFailureCode: undefined,
      lastFailureMessage: undefined,
      lastFailureAt: undefined,
    }, userDataPath);
    return {
      status: 'already_current',
      targetPath,
      installMode: platform === 'win32' ? 'cmd_wrapper' : 'copied',
    };
  }

  if (
    state.lastFailureResourcesPath === resourcesPath
    && state.lastFailureAt
    && isRecentCliFailureBlock(state.lastFailureAt)
  ) {
    return {
      status: 'skipped',
      targetPath,
      reason: 'recent_failure_same_install',
    };
  }

  try {
    const installResult = await installCliToolBlock({
      platform,
      sourcePath,
      targetPath,
      resourcesPath,
    });
    writeCliInstallStateBlock({
      installedVersion: appVersion,
      installedPath: installResult.targetPath,
      installedAt: new Date().toISOString(),
      installMode: installResult.installMode,
      lastFailureResourcesPath: undefined,
      lastFailureCode: undefined,
      lastFailureMessage: undefined,
      lastFailureAt: undefined,
    }, userDataPath);
    return {
      status: 'installed',
      targetPath: installResult.targetPath,
      installMode: installResult.installMode,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    writeCliInstallStateBlock({
      lastFailureResourcesPath: resourcesPath,
      lastFailureCode: classifyCliInstallErrorBlock(error),
      lastFailureMessage: errorMessage,
      lastFailureAt: new Date().toISOString(),
    }, userDataPath);
    return {
      status: 'failed',
      targetPath,
      errorMessage,
    };
  }
}

async function buildDesiredCliTargetContentBlock(options: {
  platform: NodeJS.Platform;
  sourcePath: string;
  resourcesPath: string;
}): Promise<string> {
  if (options.platform === 'win32') {
    return `@echo off\r\nbash "${options.sourcePath}" %*\r\n`;
  }
  const sourceContent = await fsPromises.readFile(options.sourcePath, 'utf-8');
  return buildInstalledCliWrapperBlock(sourceContent, options.resourcesPath);
}

async function readTextFileIfPresentBlock(filePath: string): Promise<string | null> {
  try {
    return await fsPromises.readFile(filePath, 'utf-8');
  } catch (error) {
    const code = getNodeErrorCodeBlock(error);
    if (code === 'ENOENT') return null;
    throw error;
  }
}

async function writeExecutableFileBlock(targetPath: string, content: string): Promise<void> {
  await fsPromises.mkdir(path.dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.${process.pid}.tmp`;
  await fsPromises.writeFile(tempPath, content, { encoding: 'utf-8', mode: 0o755 });
  await fsPromises.chmod(tempPath, 0o755);
  await fsPromises.rename(tempPath, targetPath);
}

function shouldUseMacAdminInstallBlock(error: unknown): boolean {
  const code = getNodeErrorCodeBlock(error);
  return code === 'EACCES' || code === 'EPERM';
}

function getNodeErrorCodeBlock(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const maybeCode = Reflect.get(error, 'code');
  return typeof maybeCode === 'string' ? maybeCode : null;
}

function classifyCliInstallErrorBlock(error: unknown): string {
  const code = getNodeErrorCodeBlock(error);
  if (code) return code;
  const message = error instanceof Error ? error.message : String(error);
  if (/User canceled|User cancelled|-128/.test(message)) return 'USER_CANCELLED';
  return 'UNKNOWN';
}

function isRecentCliFailureBlock(lastFailureAt: string): boolean {
  const parsed = Date.parse(lastFailureAt);
  if (!Number.isFinite(parsed)) return false;
  return Date.now() - parsed < 5 * 60 * 1000;
}

async function runMacAdminInstallBlock(sourcePath: string, targetPath: string): Promise<void> {
  const command = `mkdir -p ${toShellSingleQuotedBlock(path.dirname(targetPath))} && /usr/bin/install -m 755 ${toShellSingleQuotedBlock(sourcePath)} ${toShellSingleQuotedBlock(targetPath)}`;
  const appleScript = `do shell script ${toAppleScriptStringLiteralBlock(command)} with administrator privileges`;

  await new Promise<void>((resolve, reject) => {
    const child = spawn('osascript', ['-e', appleScript], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    let stdout = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      const output = stderr.trim() || stdout.trim() || `osascript exited with code ${code ?? 'unknown'}`;
      reject(new Error(output));
    });
  });
}

function toShellSingleQuotedBlock(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function toAppleScriptStringLiteralBlock(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
