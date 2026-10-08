import fs from 'fs';
import path from 'path';

// Maps a file path handed to the app from outside the renderer (macOS
// `open-file`) to the in-app route that shows it, or null when the file is not
// a regular file inside the given vault. Containment is checked on real paths,
// so a symlink cannot point the route out of the vault.
export function resolveExternalFileRouteBlock(filePath: string, vaultRoot: string): string | null {
  try {
    const root = fs.realpathSync(vaultRoot);
    const target = fs.realpathSync(filePath);
    if (!fs.statSync(target).isFile()) return null;
    const rel = path.relative(root, target);
    if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) return null;
    return `/thinking-space?file=${encodeURIComponent(rel.split(path.sep).join('/'))}`;
  } catch {
    return null;
  }
}
