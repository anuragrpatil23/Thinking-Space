// Lexical import extraction + resolution for the codebase graph mode.
//
// An import statement is the code equivalent of a wikilink: a directed
// reference from one file to another. This block extracts specifiers with
// per-language regexes (no parser, no LSP — ~95% of file-level edges for a
// fraction of the cost) and resolves them against the set of files the vault
// walk actually found. Bare package imports (react, dexie, …) are external by
// definition and never become edges.
//
// Deliberately renderer-side and pure: the codebase is opened as a profile's
// vault, so the existing vault-walk/read IPC (already vault-root-guarded)
// supplies everything — no new main-process surface, works in the web build.

/** Extensions that become graph nodes. Broad on purpose — folder gravity makes
 *  a useful map even for languages we extract no edges from. */
export const CODE_GRAPH_NODE_EXTENSIONS = [
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte',
  '.py', '.rs', '.go', '.swift', '.java', '.kt', '.rb',
  '.c', '.h', '.cc', '.cpp', '.hpp', '.cs',
  '.css', '.scss',
]

/** Files larger than this are kept as nodes but never content-scanned —
 *  anything this size is a generated bundle or vendored blob, and its
 *  "imports" would be noise. */
export const CODE_SCAN_MAX_BYTES = 400_000

// Build outputs and vendored trees drown the real code. Dot-dirs and
// node_modules/.git are already excluded by the vault walk itself.
const GENERATED_SEGMENTS = new Set([
  'dist', 'build', 'out', 'coverage', 'target', 'vendor', 'Pods', 'DerivedData',
])

export function isGeneratedCodePathBlock(path: string): boolean {
  return path.split('/').some(segment => GENERATED_SEGMENTS.has(segment))
}

const JS_FAMILY = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte'])
/** Extensions tried when a JS-family specifier omits one, plus /index variants. */
const JS_RESOLVE_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte', '.css', '.scss', '.json']

// Static import (incl. side-effect + `import type`), re-export, and
// require()/dynamic import(). Specifier must be quoted on the same line.
const JS_STATIC_IMPORT_RE = /(?:^|[^\w$.])import\s+(?:[\w$*{},\s]+?from\s+)?["']([^"'\n]+)["']/g
const JS_REEXPORT_RE = /(?:^|[^\w$.])export\s+[\w$*{},\s]+?from\s+["']([^"'\n]+)["']/g
const JS_CALL_IMPORT_RE = /(?:^|[^\w$.])(?:require|import)\s*\(\s*["']([^"'\n]+)["']\s*\)/g

const PY_FROM_RE = /^[ \t]*from[ \t]+(\.*[\w.]*)[ \t]+import/gm
const PY_IMPORT_RE = /^[ \t]*import[ \t]+([\w.]+(?:[ \t]*,[ \t]*[\w.]+)*)/gm

const RS_MOD_RE = /^[ \t]*(?:pub(?:\([^)]*\))?[ \t]+)?mod[ \t]+(\w+)[ \t]*;/gm

function extOf(path: string): string {
  const dot = path.lastIndexOf('.')
  const slash = path.lastIndexOf('/')
  return dot > slash ? path.slice(dot).toLowerCase() : ''
}

function dirOf(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash === -1 ? '' : path.slice(0, slash)
}

/** Collapse `.`/`..` segments; null when the path escapes the vault root. */
function normalizeRelativeBlock(path: string): string | null {
  const out: string[] = []
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (out.length === 0) return null
      out.pop()
      continue
    }
    out.push(segment)
  }
  return out.join('/')
}

function collectMatches(re: RegExp, source: string, into: string[]): void {
  re.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(source)) !== null) into.push(m[1])
}

/**
 * Raw import specifiers from a source file, dispatched on extension.
 * Specifiers are returned verbatim — resolution decides what they point at.
 */
export function extractImportSpecifiersBlock(content: string, ext: string): string[] {
  const specs: string[] = []
  if (JS_FAMILY.has(ext)) {
    collectMatches(JS_STATIC_IMPORT_RE, content, specs)
    collectMatches(JS_REEXPORT_RE, content, specs)
    collectMatches(JS_CALL_IMPORT_RE, content, specs)
  } else if (ext === '.py') {
    collectMatches(PY_FROM_RE, content, specs)
    const multi: string[] = []
    collectMatches(PY_IMPORT_RE, content, multi)
    for (const group of multi) {
      for (const part of group.split(',')) {
        const name = part.trim().split(/[ \t]/)[0]
        if (name) specs.push(name)
      }
    }
  } else if (ext === '.rs') {
    collectMatches(RS_MOD_RE, content, specs)
  }
  return specs
}

function firstExisting(candidates: string[], index: ReadonlySet<string>): string | null {
  for (const candidate of candidates) {
    if (index.has(candidate)) return candidate
  }
  return null
}

/** Every ancestor directory of a path, deepest first, ending with '' (root). */
function ancestorsOf(fromDir: string): string[] {
  const out: string[] = []
  let dir = fromDir
  while (dir !== '') {
    out.push(dir)
    dir = dirOf(dir)
  }
  out.push('')
  return out
}

function jsCandidatesFor(base: string): string[] {
  const candidates = [base]
  for (const ext of JS_RESOLVE_EXTS) candidates.push(base + ext)
  for (const ext of JS_RESOLVE_EXTS) candidates.push(`${base}/index${ext}`)
  return candidates
}

function resolveJsBlock(fromPath: string, rawSpec: string, index: ReadonlySet<string>): string | null {
  // Strip bundler suffixes (`?raw`, `#fragment`) before path work.
  const spec = rawSpec.split(/[?#]/)[0]
  if (spec === '') return null

  if (spec.startsWith('.')) {
    const base = normalizeRelativeBlock(`${dirOf(fromPath)}/${spec}`)
    if (base === null) return null
    return firstExisting(jsCandidatesFor(base), index)
  }

  // `@/x` and `~/x` conventionally alias a package's src root. Without parsing
  // tsconfigs, try `<ancestor>/src/x` then `<ancestor>/x` from the importing
  // file upward — nearest package wins, which matches how aliases are scoped.
  if (spec.startsWith('@/') || spec.startsWith('~/')) {
    const rest = spec.slice(2)
    for (const ancestor of ancestorsOf(dirOf(fromPath))) {
      const prefix = ancestor === '' ? '' : `${ancestor}/`
      const hit =
        firstExisting(jsCandidatesFor(`${prefix}src/${rest}`), index) ??
        firstExisting(jsCandidatesFor(`${prefix}${rest}`), index)
      if (hit) return hit
    }
    return null
  }

  // Bare specifier — an external package, never an edge.
  return null
}

function pyCandidatesFor(base: string): string[] {
  return [`${base}.py`, `${base}/__init__.py`]
}

function resolvePyBlock(fromPath: string, spec: string, index: ReadonlySet<string>): string | null {
  const fromDir = dirOf(fromPath)

  if (spec.startsWith('.')) {
    // `from .a import x` — one leading dot is the current package, each extra
    // dot climbs one level.
    let dots = 0
    while (dots < spec.length && spec[dots] === '.') dots++
    const rest = spec.slice(dots).replace(/\./g, '/')
    let dir = fromDir
    for (let i = 1; i < dots; i++) {
      if (dir === '') return null
      dir = dirOf(dir)
    }
    const base = rest === '' ? dir : dir === '' ? rest : `${dir}/${rest}`
    if (base === '') return null
    return firstExisting(pyCandidatesFor(base), index)
  }

  // Absolute module path — try each ancestor as the import root, nearest
  // first, mirroring how sys.path usually anchors at the package's parent.
  const rel = spec.replace(/\./g, '/')
  for (const ancestor of ancestorsOf(fromDir)) {
    const base = ancestor === '' ? rel : `${ancestor}/${rel}`
    const hit = firstExisting(pyCandidatesFor(base), index)
    if (hit) return hit
  }
  return null
}

function resolveRsBlock(fromPath: string, name: string, index: ReadonlySet<string>): string | null {
  // `mod foo;` in a/b.rs points into a/b/; in mod.rs / lib.rs / main.rs it
  // points into the file's own directory.
  const fromDir = dirOf(fromPath)
  const base = fromPath.slice(fromDir === '' ? 0 : fromDir.length + 1)
  const isRootFile = base === 'mod.rs' || base === 'lib.rs' || base === 'main.rs'
  const stem = base.endsWith('.rs') ? base.slice(0, -3) : base
  const childDir = isRootFile ? fromDir : fromDir === '' ? stem : `${fromDir}/${stem}`
  const prefix = childDir === '' ? '' : `${childDir}/`
  return firstExisting([`${prefix}${name}.rs`, `${prefix}${name}/mod.rs`], index)
}

/** Resolve one specifier to a vault-relative file path, or null when it is
 *  external, unresolvable, or points outside the scanned set. */
export function resolveImportSpecifierBlock(
  fromPath: string,
  spec: string,
  index: ReadonlySet<string>,
): string | null {
  const ext = extOf(fromPath)
  if (JS_FAMILY.has(ext)) return resolveJsBlock(fromPath, spec, index)
  if (ext === '.py') return resolvePyBlock(fromPath, spec, index)
  if (ext === '.rs') return resolveRsBlock(fromPath, spec, index)
  return null
}

export interface CodeGraphLink {
  sourceFilePath: string
  targetFilePath: string
}

/**
 * File-level import edges for a scanned codebase. `files` holds the contents
 * that were actually read; `allPaths` is every node path (including files too
 * large to scan), so oversized files can still be link *targets*.
 */
export function buildCodeGraphLinksBlock(
  files: Array<{ path: string; content: string }>,
  allPaths: Iterable<string>,
): CodeGraphLink[] {
  const index = new Set(allPaths)
  const links: CodeGraphLink[] = []
  for (const file of files) {
    const specs = extractImportSpecifiersBlock(file.content, extOf(file.path))
    if (specs.length === 0) continue
    const targets = new Set<string>()
    for (const spec of specs) {
      const target = resolveImportSpecifierBlock(file.path, spec, index)
      if (target && target !== file.path) targets.add(target)
    }
    for (const target of targets) {
      links.push({ sourceFilePath: file.path, targetFilePath: target })
    }
  }
  return links
}
