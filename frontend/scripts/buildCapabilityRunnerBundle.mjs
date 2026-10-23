import path from 'node:path'
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const frontendRoot = path.resolve(__dirname, '..')
const entryPoint = path.join(frontendRoot, 'scripts', 'agent', 'capabilityRunner.ts')
const outFile = path.join(frontendRoot, 'electron', 'src', 'cli', 'capabilityRunner.bundle.cjs')
const bundledNodeOutFile = path.join(frontendRoot, 'electron', 'src', 'cli', 'bin', process.platform === 'win32' ? 'node.exe' : 'node')

await build({
  entryPoints: [entryPoint],
  outfile: outFile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  tsconfig: path.join(frontendRoot, 'tsconfig.json'),
  // Shared code reads Vite's build-time env (e.g. staticWebBuildBlock); this
  // bundle is not a Vite build, so every flag there is simply unset.
  define: { 'import.meta.env': '{}' },
  logLevel: 'info',
})

await fs.mkdir(path.dirname(bundledNodeOutFile), { recursive: true })
await fs.copyFile(process.execPath, bundledNodeOutFile)
if (process.platform !== 'win32') {
  await fs.chmod(bundledNodeOutFile, 0o755)
}
