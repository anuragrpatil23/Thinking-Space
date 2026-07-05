// Scheduler self-provisioning. Runs on every Electron launch:
//   1. Copy runner.mjs from app resources to ~/.thinking-space/scheduler/.
//   2. For every user schedule (managedBy: thinking-space) write a plist that
//      invokes Electron-as-Node against runner.mjs. Bootstrap if changed.
//   3. Provision the built-in heartbeat-check agent.
//
// The whole flow is idempotent: identical state in → no writes, no launchctl.
// Source of truth is single: this code. install.sh and any external manifest
// have been removed.

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import {
  buildBuiltinPlistBlock,
  buildWindowStopPlistBlock,
  getStopLabelBlock,
  type PlistBuildContextBlock,
} from './launchdPlistBlock';
import {
  bootstrapPlistBlock,
  bootstrapByLabelBlock,
  bootoutPlistBlock,
  writePlistBlock,
  writeRawPlistBlock,
} from './launchctlBlock';
import {
  listSchedulesBlock,
  type ScheduleSpecBlock,
} from './scheduleStorageBlock';

const HEARTBEAT_LABEL = 'com.thinkingspace.scheduler.heartbeat-check';
const HEARTBEAT_INTERVAL_SECONDS = 6 * 60 * 60; // every 6 hours

const CATCHUP_LABEL = 'com.thinkingspace.scheduler.catchup-check';
const CATCHUP_INTERVAL_SECONDS = 5 * 60; // every 5 minutes

const TELEGRAM_POLL_LABEL = 'com.thinkingspace.scheduler.telegram-poll';
// Each invocation long-polls Bot API for ~25s, so the effective cadence is
// poll → ~5s idle → next poll. Latency from user reply to Claude resume is
// 0–30s.
const TELEGRAM_POLL_INTERVAL_SECONDS = 30;

const RUNNER_RELATIVE_PATH = path.join('scheduler', 'runner.mjs');
// Sibling ESM modules that runner.mjs imports at load time. Must be copied
// into the install dir alongside runner.mjs, otherwise the launchd-spawned
// runner can't resolve them. Any change to any of these files counts as a
// runner change for the "force bootstrap" decision below — the same reason
// runner.mjs itself does.
const RUNNER_SIBLING_MODULES = [
  path.join('scheduler', 'claudeSessionCleanupBlock.mjs'),
] as const;

function getInstallDirBlock(): string {
  return path.join(app.getPath('home'), '.thinking-space', 'scheduler');
}

function getInstalledRunnerPathBlock(): string {
  return path.join(getInstallDirBlock(), 'runner.mjs');
}

// Exported so other main-process code (e.g. Run Now IPC) can shell out to the
// same runner binary launchd uses, instead of duplicating its spawn logic.
export function getInstalledRunnerPath(): string {
  return getInstalledRunnerPathBlock();
}

function resolveSourcePathBlock(relativePath: string): string {
  // Packaged: process.resourcesPath is .../Thinking Space.app/Contents/Resources/
  // Dev:      Resources path resolves to node_modules/electron/dist/.../Resources,
  //           which does NOT contain our bundled runner. Fall back to the repo.
  if (app.isPackaged) {
    return path.join(process.resourcesPath, relativePath);
  }
  // __dirname in dev is .../frontend/electron/build/src/lego_blocks
  return path.resolve(__dirname, '..', '..', '..', 'resources', relativePath);
}

function copyIfChanged(
  relativePath: string,
  installDir: string,
): { path: string; changed: boolean } {
  const src = resolveSourcePathBlock(relativePath);
  // Preserve the sub-directory structure (`scheduler/foo.mjs`) so imports
  // between the copied files resolve identically to how they resolve at
  // source.
  const dst = path.join(installDir, path.basename(relativePath));
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  const srcContent = fs.readFileSync(src, 'utf-8');
  let dstContent: string | null = null;
  try { dstContent = fs.readFileSync(dst, 'utf-8'); } catch { /* missing */ }
  if (dstContent === srcContent) return { path: dst, changed: false };
  const tmp = `${dst}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, srcContent, { encoding: 'utf-8', mode: 0o755 });
  fs.renameSync(tmp, dst);
  return { path: dst, changed: true };
}

function copyRunnerAndSiblingsIfChanged(): { path: string; changed: boolean } {
  const installDir = getInstallDirBlock();
  fs.mkdirSync(installDir, { recursive: true });
  const runner = copyIfChanged(RUNNER_RELATIVE_PATH, installDir);
  let anySiblingChanged = false;
  for (const rel of RUNNER_SIBLING_MODULES) {
    const res = copyIfChanged(rel, installDir);
    if (res.changed) anySiblingChanged = true;
  }
  return { path: runner.path, changed: runner.changed || anySiblingChanged };
}

function buildContextBlock(): PlistBuildContextBlock {
  return {
    electronBinary: process.execPath,
    runnerPath: getInstalledRunnerPathBlock(),
    userDataPath: app.getPath('userData'),
  };
}

export interface ProvisionResultBlock {
  runnerInstalledAt: string;
  runnerChanged: boolean;
  scheduleResults: Array<{ label: string; changed: boolean; bootstrapped: boolean; error?: string }>;
  heartbeat: { changed: boolean; bootstrapped: boolean; error?: string };
  catchup: { changed: boolean; bootstrapped: boolean; error?: string };
  telegramPoll: { changed: boolean; bootstrapped: boolean; error?: string };
}

async function provisionScheduleBlock(
  spec: ScheduleSpecBlock,
  ctx: PlistBuildContextBlock,
  forceBootstrap: boolean = false,
): Promise<{ label: string; changed: boolean; bootstrapped: boolean; error?: string }> {
  try {
    const { changed } = await writePlistBlock(spec, ctx);

    // Window-kind schedules have a paired stop plist that fires SIGTERM at
    // the end of the window. Write/bootstrap it alongside the start plist.
    let stopChanged = false;
    if (spec.schedule.kind === 'window') {
      const stopLabel = getStopLabelBlock(spec);
      const stopContent = buildWindowStopPlistBlock(spec, ctx);
      const result = await writeRawPlistBlock(stopLabel, stopContent);
      stopChanged = result.changed;
      if (!spec.enabled) {
        await bootoutPlistBlock(stopLabel);
      } else if (stopChanged || forceBootstrap) {
        await bootstrapByLabelBlock(stopLabel);
      }
    }

    if (!spec.enabled) {
      // Disabled: ensure it's not loaded.
      await bootoutPlistBlock(spec.label);
      return { label: spec.label, changed: changed || stopChanged, bootstrapped: false };
    }
    if (changed || forceBootstrap) {
      // forceBootstrap covers the runner-rewrite case: the plist content is
      // unchanged, but we just booted the schedule out so launchd would pick
      // up the new runner path on re-bootstrap. Without this, the schedule
      // stays booted out and shows "Not loaded" until manually re-enabled.
      await bootstrapPlistBlock(spec);
      return { label: spec.label, changed: changed, bootstrapped: true };
    }
    return { label: spec.label, changed: stopChanged, bootstrapped: stopChanged };
  } catch (err) {
    return {
      label: spec.label,
      changed: false,
      bootstrapped: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function provisionBuiltinAgent(
  label: string,
  command: string,
  intervalSeconds: number,
  ctx: PlistBuildContextBlock,
): Promise<{ changed: boolean; bootstrapped: boolean; error?: string }> {
  try {
    const content = buildBuiltinPlistBlock(label, command, intervalSeconds, ctx);
    const { changed } = await writeRawPlistBlock(label, content);
    if (changed) {
      // bootout-then-bootstrap so launchd reloads the new content
      await bootstrapByLabelBlock(label);
      return { changed: true, bootstrapped: true };
    }
    return { changed: false, bootstrapped: false };
  } catch (err) {
    return {
      changed: false,
      bootstrapped: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function provisionSchedulerBlock(): Promise<ProvisionResultBlock> {
  const runner = copyRunnerAndSiblingsIfChanged();
  const ctx = buildContextBlock();

  const heartbeat = await provisionBuiltinAgent(
    HEARTBEAT_LABEL, 'heartbeat-check', HEARTBEAT_INTERVAL_SECONDS, ctx,
  );
  const catchup = await provisionBuiltinAgent(
    CATCHUP_LABEL, 'catchup-check', CATCHUP_INTERVAL_SECONDS, ctx,
  );
  const telegramPoll = await provisionBuiltinAgent(
    TELEGRAM_POLL_LABEL, 'telegram-poll', TELEGRAM_POLL_INTERVAL_SECONDS, ctx,
  );

  const specs = listSchedulesBlock().filter((s) => s.managedBy === 'thinking-space');
  const scheduleResults: ProvisionResultBlock['scheduleResults'] = [];
  for (const spec of specs) {
    // If runner location changed, force-rewrite by booting out so the next
    // bootstrap picks up the new ProgramArguments.
    if (runner.changed) {
      try { await bootoutPlistBlock(spec.label); } catch { /* not loaded */ }
      if (spec.schedule.kind === 'window') {
        try { await bootoutPlistBlock(getStopLabelBlock(spec)); } catch { /* not loaded */ }
      }
    }
    scheduleResults.push(await provisionScheduleBlock(spec, ctx, runner.changed));
  }

  return {
    runnerInstalledAt: runner.path,
    runnerChanged: runner.changed,
    scheduleResults,
    heartbeat,
    catchup,
    telegramPoll,
  };
}
