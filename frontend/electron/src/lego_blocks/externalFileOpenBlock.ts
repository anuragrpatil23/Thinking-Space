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

const EXTERNAL_MARKDOWN_EXTENSIONS_BLOCK = new Set(['.md', '.markdown']);

// A markdown file outside every vault that macOS handed over is opened by its
// absolute real path. Handing it over is the user's consent for that one file,
// so main records it here and the `externalFile:*` IPCs serve exactly the
// recorded paths — never a sibling, a folder, or a path the renderer names.
// Grants live for the app session only.
export function createExternalFileGrantsBlock() {
  const granted = new Set<string>();

  return {
    /** Records the file and returns its route, or null when it is not a
     *  regular markdown file. */
    grant(filePath: string): string | null {
      try {
        const target = fs.realpathSync(filePath);
        if (!fs.statSync(target).isFile()) return null;
        if (!EXTERNAL_MARKDOWN_EXTENSIONS_BLOCK.has(path.extname(target).toLowerCase())) return null;
        granted.add(target);
        return `/thinking-space?file=${encodeURIComponent(target)}`;
      } catch {
        return null;
      }
    },

    /** Returns the path when it was granted; throws otherwise. The renderer
     *  sends back the real path it was routed to, and a symlink swapped in
     *  since must still resolve to that same file. */
    assertGranted(filePath: unknown): string {
      if (typeof filePath !== 'string' || !path.isAbsolute(filePath) || !granted.has(filePath)) {
        throw new Error('External file was not opened from outside the app');
      }
      if (fs.realpathSync(filePath) !== filePath) {
        throw new Error('External file changed location since it was opened');
      }
      return filePath;
    },
  };
}
