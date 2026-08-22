import { execFile } from 'child_process';
import { promisify } from 'util';
import { powerMonitor } from 'electron';

const execFileAsync = promisify(execFile);
const PMSET = '/usr/bin/pmset';

// Whether the machine is in a state where it is fair to spend minutes of GPU
// on a background model run.
//
// Two independent signals, because they mean different things:
//   - `onBattery`  — Electron knows this natively and updates on an event.
//   - `lowPowerMode` — the user explicitly asking the OS to conserve. macOS
//     does not expose it to Electron at all, so it comes from `pmset -g`.
// `known` is false off macOS or when the probe fails; callers treat unknown as
// permissive rather than blocking work on a platform we cannot read.
export interface PowerStateBlock {
  onBattery: boolean;
  lowPowerMode: boolean;
  known: boolean;
}

// Low Power Mode is a settings-app toggle, not something that flips on its own,
// so a short TTL is plenty and spares us a subprocess per query. No timer keeps
// this warm — it refreshes only when someone asks (see the Energy contract).
const LOW_POWER_TTL_MS = 30_000;
let cachedLowPower: { value: boolean; known: boolean; atMs: number } | null = null;

// Plugging in or unplugging is exactly when macOS is likely to have flipped Low
// Power Mode underneath us, so drop the cache rather than serve a stale answer.
let listenersBound = false;
function bindInvalidationOnce(): void {
  if (listenersBound) return;
  listenersBound = true;
  const invalidate = () => { cachedLowPower = null; };
  powerMonitor.on('on-ac', invalidate);
  powerMonitor.on('on-battery', invalidate);
  powerMonitor.on('resume', invalidate);
}

async function readLowPowerModeBlock(): Promise<{ value: boolean; known: boolean }> {
  if (process.platform !== 'darwin') return { value: false, known: false };
  const now = Date.now();
  if (cachedLowPower && now - cachedLowPower.atMs < LOW_POWER_TTL_MS) {
    return { value: cachedLowPower.value, known: cachedLowPower.known };
  }
  try {
    const { stdout } = await execFileAsync(PMSET, ['-g'], { timeout: 5_000 });
    cachedLowPower = { ...parseLowPowerModeBlock(stdout), atMs: now };
    return { value: cachedLowPower.value, known: cachedLowPower.known };
  } catch {
    cachedLowPower = { value: false, known: false, atMs: now };
    return { value: false, known: false };
  }
}

/**
 * Read Low Power Mode out of `pmset -g`.
 *
 * The key differs by era, and getting this wrong fails open (no gate at all),
 * so both spellings are accepted:
 *   - Apple Silicon / recent macOS: ` powermode 0|1|2` — automatic, low, high.
 *   - Older Intel Macs: ` lowpowermode 0|1`.
 * `pmset -g` prints the "Currently in use" block, which already resolves the
 * per-source setting (Low Power Mode can be on for battery and off for AC), so
 * there is no source to disambiguate here.
 *
 * Only mode 1 blocks. High Power (2) is the opposite of a reason to hold back.
 * Absent on Macs too old to have the feature — a legitimate "off", but reported
 * as unknown so the caller does not treat silence as evidence.
 */
export function parseLowPowerModeBlock(stdout: string): { value: boolean; known: boolean } {
  const match = /^\s*(low)?powermode\s+(\d+)\s*$/m.exec(stdout);
  if (!match) return { value: false, known: false };
  return { value: match[2] === '1', known: true };
}

export async function getPowerStateBlock(): Promise<PowerStateBlock> {
  bindInvalidationOnce();
  const lowPower = await readLowPowerModeBlock();
  return {
    onBattery: powerMonitor.onBatteryPower,
    lowPowerMode: lowPower.value,
    // Battery/AC is always readable; Low Power Mode is the part that can fail.
    known: lowPower.known,
  };
}
