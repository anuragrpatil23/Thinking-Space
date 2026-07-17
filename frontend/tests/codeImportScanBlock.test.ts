import { describe, expect, it } from 'vitest'
import {
  buildCodeGraphLinksBlock,
  extractImportSpecifiersBlock,
  isGeneratedCodePathBlock,
  resolveImportSpecifierBlock,
} from '@/services/lego_blocks/units/codeImportScanBlock'

describe('extractImportSpecifiersBlock — JS/TS family', () => {
  it('extracts static, side-effect, type, re-export, require, and dynamic imports', () => {
    const src = `
import { a, b } from './foo'
import * as ns from '../bar/baz'
import def from '@/services/x'
import type { T } from './types'
import './side-effect.css'
export { y } from './re-exported'
export * from './star'
const c = require('./cjs-dep')
const d = await import('./dynamic')
`
    expect(extractImportSpecifiersBlock(src, '.ts')).toEqual([
      './foo',
      '../bar/baz',
      '@/services/x',
      './types',
      './side-effect.css',
      './re-exported',
      './star',
      './cjs-dep',
      './dynamic',
    ])
  })

  it('ignores commented-looking non-import text and bare words', () => {
    const src = `const important = 'not an import'; reimport('./nope')`
    expect(extractImportSpecifiersBlock(src, '.ts')).toEqual([])
  })
})

describe('extractImportSpecifiersBlock — Python', () => {
  it('extracts import/from forms including relative and comma lists', () => {
    const src = `
import os
import pkg.mod, other.thing as t
from .sibling import helper
from ..parent.mod import x
from . import registry
from pkg.sub import y
`
    expect(extractImportSpecifiersBlock(src, '.py')).toEqual([
      '.sibling',
      '..parent.mod',
      '.',
      'pkg.sub',
      'os',
      'pkg.mod',
      'other.thing',
    ])
  })
})

describe('extractImportSpecifiersBlock — Rust', () => {
  it('extracts mod declarations, including pub variants', () => {
    const src = `
mod parser;
pub mod lexer;
pub(crate) mod util;
// mod commented; -- still matches (lexical scan accepts this noise)
fn main() {}
`
    expect(extractImportSpecifiersBlock(src, '.rs')).toContain('parser')
    expect(extractImportSpecifiersBlock(src, '.rs')).toContain('lexer')
    expect(extractImportSpecifiersBlock(src, '.rs')).toContain('util')
  })
})

describe('resolveImportSpecifierBlock — JS/TS resolution', () => {
  const index = new Set([
    'frontend/src/App.tsx',
    'frontend/src/services/x.ts',
    'frontend/src/components/Button/index.tsx',
    'frontend/src/styles/main.css',
    'frontend/src/util.ts',
    'other/deep/a.js',
  ])

  it('resolves relative specifiers with extension inference', () => {
    expect(resolveImportSpecifierBlock('frontend/src/App.tsx', './util', index)).toBe(
      'frontend/src/util.ts',
    )
  })

  it('resolves directory imports to index files', () => {
    expect(
      resolveImportSpecifierBlock('frontend/src/App.tsx', './components/Button', index),
    ).toBe('frontend/src/components/Button/index.tsx')
  })

  it('resolves the @/ alias to the nearest ancestor src root', () => {
    expect(
      resolveImportSpecifierBlock('frontend/src/components/Button/index.tsx', '@/services/x', index),
    ).toBe('frontend/src/services/x.ts')
  })

  it('keeps explicit extensions and strips bundler query suffixes', () => {
    expect(
      resolveImportSpecifierBlock('frontend/src/App.tsx', './styles/main.css?raw', index),
    ).toBe('frontend/src/styles/main.css')
  })

  it('returns null for bare package imports and escapes past root', () => {
    expect(resolveImportSpecifierBlock('frontend/src/App.tsx', 'react', index)).toBeNull()
    expect(resolveImportSpecifierBlock('other/deep/a.js', '../../../outside', index)).toBeNull()
  })
})

describe('resolveImportSpecifierBlock — Python resolution', () => {
  const index = new Set([
    'app/main.py',
    'app/pkg/__init__.py',
    'app/pkg/mod.py',
    'app/pkg/sub/helper.py',
  ])

  it('resolves absolute dotted paths from ancestor roots', () => {
    expect(resolveImportSpecifierBlock('app/main.py', 'pkg.mod', index)).toBe('app/pkg/mod.py')
  })

  it('resolves package imports to __init__.py', () => {
    expect(resolveImportSpecifierBlock('app/main.py', 'pkg', index)).toBe('app/pkg/__init__.py')
  })

  it('resolves relative imports, including dotted climbs', () => {
    expect(resolveImportSpecifierBlock('app/pkg/sub/helper.py', '..mod', index)).toBe(
      'app/pkg/mod.py',
    )
    expect(resolveImportSpecifierBlock('app/pkg/mod.py', '.', index)).toBe('app/pkg/__init__.py')
  })
})

describe('resolveImportSpecifierBlock — Rust mod resolution', () => {
  const index = new Set(['src/main.rs', 'src/parser.rs', 'src/lexer/mod.rs', 'src/lexer/token.rs'])

  it('resolves mod from a root file into its own directory', () => {
    expect(resolveImportSpecifierBlock('src/main.rs', 'parser', index)).toBe('src/parser.rs')
    expect(resolveImportSpecifierBlock('src/main.rs', 'lexer', index)).toBe('src/lexer/mod.rs')
  })

  it('resolves mod from a named file into its child directory', () => {
    expect(resolveImportSpecifierBlock('src/lexer/mod.rs', 'token', index)).toBe(
      'src/lexer/token.rs',
    )
  })
})

describe('buildCodeGraphLinksBlock', () => {
  it('builds deduped file-level edges and skips self/unresolved imports', () => {
    const files = [
      {
        path: 'src/a.ts',
        content: `import { b } from './b'\nimport { b as again } from './b'\nimport react from 'react'\nimport self from './a'`,
      },
      { path: 'src/b.ts', content: `import big from './huge-bundle'` },
    ]
    // huge-bundle.ts exists as a node (too big to scan) — still a valid target.
    const links = buildCodeGraphLinksBlock(files, ['src/a.ts', 'src/b.ts', 'src/huge-bundle.ts'])
    expect(links).toEqual([
      { sourceFilePath: 'src/a.ts', targetFilePath: 'src/b.ts' },
      { sourceFilePath: 'src/b.ts', targetFilePath: 'src/huge-bundle.ts' },
    ])
  })
})

describe('isGeneratedCodePathBlock', () => {
  it('flags build-output segments anywhere in the path', () => {
    expect(isGeneratedCodePathBlock('frontend/dist/index.js')).toBe(true)
    expect(isGeneratedCodePathBlock('target/debug/foo.rs')).toBe(true)
    expect(isGeneratedCodePathBlock('src/distribution/x.ts')).toBe(false)
    expect(isGeneratedCodePathBlock('src/app.ts')).toBe(false)
  })
})
