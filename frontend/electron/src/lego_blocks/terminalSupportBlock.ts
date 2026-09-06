import * as path from 'path';

type TerminalSupportMetadataBlock = {
  thinkingSpace?: {
    terminalEnabled?: boolean;
  };
};

function readPackageTerminalEnabledBlock(): boolean | null {
  try {
    // Three levels, not two. This file compiles to
    // `<root>/build/src/lego_blocks/`, so `../..` lands on `build/` — a
    // directory that has never held a package.json. Every read therefore threw,
    // returned null, and fell through to the enabled-by-default branch, which
    // made the whole `terminalEnabled: false` mechanism inert: the Windows lite
    // build correctly omitted node-pty and then loaded as if it were present,
    // and crashed on launch with "Cannot find module 'node-pty'".
    const packageJsonPath = path.resolve(__dirname, '../../../package.json');
    const packageJson = require(packageJsonPath) as TerminalSupportMetadataBlock;
    if (typeof packageJson?.thinkingSpace?.terminalEnabled === 'boolean') {
      return packageJson.thinkingSpace.terminalEnabled;
    }
  } catch {
    // Fall through to default behavior.
  }
  return null;
}

export function isTerminalEnabledBlock(): boolean {
  const rawValue = process.env.THINKING_SPACE_ENABLE_TERMINAL?.trim().toLowerCase();
  if (rawValue) {
    return rawValue !== '0' && rawValue !== 'false' && rawValue !== 'off';
  }

  const packageValue = readPackageTerminalEnabledBlock();
  if (packageValue !== null) return packageValue;

  return true;
}
