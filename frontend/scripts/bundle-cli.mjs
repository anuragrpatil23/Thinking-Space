// Bundle the thinkspc CLI (capabilityRunner.ts + all its deps) into a single
// self-contained ESM file that the Electron-as-Node shim can invoke.
//
// Output: frontend/electron/resources/cli/thinkspc-runner.mjs
//
// Invoked as part of the electron build (see frontend/electron/package.json).
// Also runnable standalone for dev: `node frontend/scripts/bundle-cli.mjs`.

import { build } from 'esbuild';
import { mkdir, readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FRONTEND = resolve(__dirname, '..');
const ENTRY = resolve(FRONTEND, 'scripts/agent/capabilityRunner.ts');
const OUT = resolve(FRONTEND, 'electron/resources/cli/thinkspc-runner.mjs');

await mkdir(dirname(OUT), { recursive: true });

// Skills (`thinkspc skill.*`, see src/services/lego_blocks/units/skillContractBlock.ts):
// every <root>/<name>/ with a contract.json, embedded so the CLI stays one file.
// The private F9 folder is read only when it is present.
const SKILL_ROOTS = [
  resolve(FRONTEND, 'src/skills'),
  resolve(FRONTEND, 'src/personal_extension/thinkingspace-personal/skills'),
];

async function filesUnder(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (entry.name.startsWith('.')) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await filesUnder(full));
    else out.push(full);
  }
  return out;
}

async function collectSkills() {
  const skills = [];
  for (const root of SKILL_ROOTS) {
    for (const entry of await readdir(root, { withFileTypes: true }).catch(() => [])) {
      if (!entry.isDirectory()) continue;
      const dir = join(root, entry.name);
      const contractPath = join(dir, 'contract.json');
      if (!(await stat(contractPath).catch(() => null))) continue;
      const contract = JSON.parse(await readFile(contractPath, 'utf8'));
      const instructions = await readFile(join(dir, 'SKILL.md'), 'utf8').catch(() => '');
      const files = {};
      for (const file of await filesUnder(dir)) {
        const rel = relative(dir, file);
        if (rel === 'contract.json' || rel === 'SKILL.md') continue;
        files[rel] = await readFile(file, 'utf8');
      }
      skills.push({ contract, instructions, files });
    }
  }
  return skills;
}

const SKILLS = await collectSkills();
console.log(`[bundle-cli] skills: ${SKILLS.map((g) => g.contract.name).join(', ') || 'none'}`);

const result = await build({
  entryPoints: [ENTRY],
  outfile: OUT,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  // Node 20+ ESM doesn't auto-resolve __dirname; banner provides shims.
  banner: {
    js: [
      "import { createRequire as __thinkspcCreateRequire } from 'node:module';",
      "import { fileURLToPath as __thinkspcFileURLToPath } from 'node:url';",
      "import { dirname as __thinkspcDirname } from 'node:path';",
      "const require = __thinkspcCreateRequire(import.meta.url);",
      "const __filename = __thinkspcFileURLToPath(import.meta.url);",
      "const __dirname = __thinkspcDirname(__filename);",
    ].join('\n'),
  },
  // Keep names + don't minify for sane stack traces; size is not a concern
  // (one file, a few MB at worst).
  minify: false,
  sourcemap: false,
  keepNames: true,
  legalComments: 'none',
  // Mark Node built-ins as external so esbuild doesn't try to bundle them.
  external: [
    'node:*',
    'electron',
  ],
  define: {
    __THINKSPC_SKILLS__: JSON.stringify(SKILLS),
    // Shared code reads Vite's build-time env (e.g. staticWebBuildBlock); the
    // CLI is not a Vite build, so every flag there is simply unset.
    'import.meta.env': '{}',
  },
  logLevel: 'info',
  metafile: true,
});

const totalBytes = Object.values(result.metafile.outputs).reduce((n, o) => n + o.bytes, 0);
console.log(`[bundle-cli] wrote ${OUT} (${(totalBytes / 1024).toFixed(1)} KB)`);
