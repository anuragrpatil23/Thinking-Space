// ESLint flat config.
//
// The `lint` script existed long before this file did — `eslint .` with no
// ESLint installed and no config, so it had never run. That is worth stating,
// because it sets what this config is for: a lint that reports thousands of
// problems on a codebase this size is one nobody runs twice, and an unrun lint
// is indistinguishable from no lint.
//
// So the baseline is deliberately narrow and green. It catches the things that
// are *bugs* — a floating promise in an async orchestrator, a React hook whose
// dependency array lies, an unused symbol left behind by a refactor — and stays
// quiet about style, which Prettier-shaped arguments never win and which the
// codebase already applies consistently by hand.
//
// Type-aware rules (`recommendedTypeChecked`) are deliberately not on. They are
// the ones worth graduating to, but they need `parserOptions.project` and a
// pass over several hundred existing violations first; turning them on now
// would produce exactly the wall of noise this config exists to avoid.

import { fileURLToPath } from 'node:url'
import { includeIgnoreFile } from '@eslint/compat'
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

// Build output is already enumerated, correctly and in one place, by the
// .gitignore files. Restating it here would be a second list answering the same
// question as the first — which is how it drifts, and how 28k of the first
// run's 28.3k problems came from minified bundles in `electron/app`.
export default tseslint.config(
  includeIgnoreFile(fileURLToPath(new URL('../.gitignore', import.meta.url)), 'repo gitignore'),
  includeIgnoreFile(
    fileURLToPath(new URL('electron/.gitignore', import.meta.url)),
    'electron gitignore',
  ),
  {
    // Checked in, but not hand-written: generated bundles and vendored code.
    ignores: [
      'electron/resources/**',
      'electron/src/cli/capabilityRunner.bundle.cjs',
      'public/tikzjax/**',
      'ios/**',
      'android/**',
      'src/personal_extension/vendor/**',
      '**/*.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,

      // Warn, not error — for now. A lying dependency array is a real defect
      // class in a codebase this hook-heavy, but there are 42 pre-existing
      // ones and each needs its own judgement (some are deliberate, with the
      // reason in a comment above). Failing the build on all 42 today would
      // mean the first thing anyone does is turn the rule off. Graduate it to
      // 'error' once the backlog is worked through.
      'react-hooks/exhaustive-deps': 'warn',

      // Fast-refresh correctness, not style: a module that exports both a
      // component and a constant loses hot-reload state on every edit.
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      // `_`-prefixed is the codebase's existing convention for "deliberately
      // unused" (see the runner's `..._args`), so honour it rather than fight it.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      // `any` is a real hole, but it is load-bearing in the capability router's
      // cross-boundary casts and in test doubles. Warn so new ones are visible
      // without failing the build on the existing ones.
      '@typescript-eslint/no-explicit-any': 'warn',

      // Empty catch blocks are used deliberately and constantly here — vault
      // reads that must degrade rather than throw, with the reason written in a
      // comment above. The rule cannot see the comment.
      'no-empty': ['error', { allowEmptyCatch: true }],

      // `interface X extends Y {}` is a deliberate pattern here: the sidebar
      // chrome blocks each name their own state type so the surfaces stay
      // nominally distinct even while they share a shape. Collapsing them to
      // `type X = Y` would erase the distinction the naming exists to make.
      '@typescript-eslint/no-empty-object-type': 'off',

      // A non-breaking space inside a character class is the *point* in a
      // parser that has to match vault text as typed — see `folderMapBlock`.
      // Keep the rule for code, drop it for the two places it belongs.
      'no-irregular-whitespace': ['error', { skipRegExps: true, skipStrings: true }],
    },
  },
  {
    // CommonJS and plain-Node files: build configs, the live-reload runner,
    // Electron packaging scripts. `require` and `module` are the language here,
    // not a lapse.
    files: ['**/*.cjs', '**/*.js'],
    languageOptions: {
      globals: { ...globals.node },
      sourceType: 'commonjs',
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      'no-undef': 'off',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // `.mjs` is ESM, so `__dirname` is genuinely absent and deriving it from
    // `import.meta.url` is the correct idiom rather than a redeclaration.
    files: ['**/*.mjs'],
    languageOptions: { globals: { ...globals.node }, sourceType: 'module' },
    rules: { 'no-redeclare': 'off', '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    // Electron main. Lazy `require()` is load-bearing rather than legacy: a
    // native module pulled in at module scope is paid for on every cold start,
    // and STARTUP-PERFORMANCE.md is explicit that heavy vendors must not be
    // statically reachable from the entry.
    files: ['electron/**/*.ts'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    // Tests reach past type boundaries on purpose to build fixtures and doubles.
    files: ['tests/**/*.ts', '**/*.test.ts', '**/*.test.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    files: ['scripts/**/*.{ts,mjs,js}', '*.config.{ts,js,mjs}', 'electron/scripts/**/*.{js,mjs}'],
    languageOptions: { globals: { ...globals.node } },
    rules: { 'no-console': 'off' },
  },
)
