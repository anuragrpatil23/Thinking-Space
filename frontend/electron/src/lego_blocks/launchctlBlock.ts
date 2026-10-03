import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { buildPlistBlock, getPlistPathBlock, type PlistBuildContextBlock } from './launchdPlistBlock';
import type { ScheduleSpecBlock } from './scheduleStorageBlock';

const execFileAsync = promisify(execFile);

function getGuiTargetBlock(): string {
  return `gui/${process.getuid?.() ?? 501}`;
}

export interface LaunchctlStatusBlock {
  loaded: boolean;
  pid: number | null;
  lastExitCode: number | null;
}

/**
 * Write a plist atomically. Returns the existing content if unchanged so
 * callers can decide whether to skip bootstrap.
 */
export async function writePlistBlock(
  spec: ScheduleSpecBlock,
  ctx: PlistBuildContextBlock,
): Promise<{ path: string; changed: boolean }> {
  const plistPath = getPlistPathBlock(spec.label);
  fs.mkdirSync(path.dirname(plistPath), { recursive: true });
  const content = buildPlistBlock(spec, ctx);
  let existing: string | null = null;
  try { existing = fs.readFileSync(plistPath, 'utf-8'); } catch { /* missing */ }
  if (existing === content) return { path: plistPath, changed: false };
  const tempPath = `${plistPath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, content, { encoding: 'utf-8', mode: 0o644 });
  fs.renameSync(tempPath, plistPath);
  return { path: plistPath, changed: true };
}

export async function writeRawPlistBlock(
  label: string,
  content: string,
): Promise<{ path: string; changed: boolean }> {
  const plistPath = getPlistPathBlock(label);
  fs.mkdirSync(path.dirname(plistPath), { recursive: true });
  let existing: string | null = null;
  try { existing = fs.readFileSync(plistPath, 'utf-8'); } catch { /* missing */ }
  if (existing === content) return { path: plistPath, changed: false };
  const tempPath = `${plistPath}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, content, { encoding: 'utf-8', mode: 0o644 });
  fs.renameSync(tempPath, plistPath);
  return { path: plistPath, changed: true };
}

export async function bootstrapPlistBlock(spec: ScheduleSpecBlock): Promise<void> {
  return bootstrapByLabelBlock(spec.label);
}

export async function bootstrapByLabelBlock(label: string): Promise<void> {
  const plistPath = getPlistPathBlock(label);
  // bootout first (ignore errors — may not be loaded yet)
  await execFileAsync('/bin/launchctl', ['bootout', `${getGuiTargetBlock()}/${label}`]).catch(() => undefined);
  // bootout returns before a still-running job has actually gone (telegram-poll
  // sits in a 25s long-poll), and bootstrap fails while the old instance is
  // still registered — so give it a few short retries before giving up.
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    try {
      await execFileAsync('/bin/launchctl', ['bootstrap', getGuiTargetBlock(), plistPath]);
      return;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

export async function bootoutPlistBlock(label: string): Promise<void> {
  await execFileAsync('/bin/launchctl', ['bootout', `${getGuiTargetBlock()}/${label}`]).catch(() => undefined);
}

export async function removePlistBlock(label: string): Promise<void> {
  await bootoutPlistBlock(label);
  try {
    fs.unlinkSync(getPlistPathBlock(label));
  } catch {
    // already gone
  }
}

export async function kickstartPlistBlock(label: string): Promise<void> {
  await execFileAsync('/bin/launchctl', ['kickstart', '-k', `${getGuiTargetBlock()}/${label}`]);
}

export async function getLaunchctlStatusBlock(label: string): Promise<LaunchctlStatusBlock> {
  try {
    const { stdout } = await execFileAsync('/bin/launchctl', ['list']);
    for (const line of stdout.split('\n')) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 3) continue;
      if (parts[2] === label) {
        const pid = parts[0] === '-' ? null : Number.parseInt(parts[0], 10);
        const exit = parts[1] === '-' ? null : Number.parseInt(parts[1], 10);
        return {
          loaded: true,
          pid: Number.isFinite(pid as number) ? (pid as number) : null,
          lastExitCode: Number.isFinite(exit as number) ? (exit as number) : null,
        };
      }
    }
  } catch (err) {
    console.warn('[launchctl] status failed', err);
  }
  return { loaded: false, pid: null, lastExitCode: null };
}

export async function listExternalAgentsBlock(): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync('/bin/launchctl', ['list']);
    const labels: string[] = [];
    for (const line of stdout.split('\n')) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 3) continue;
      labels.push(parts[2]);
    }
    return labels;
  } catch {
    return [];
  }
}
