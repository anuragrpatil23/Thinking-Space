import path from 'path'
import { build, type Plugin } from 'vite'

// Builds the model-diagram engine (modelDiagramMountBlock.ts, with three.js)
// into one IIFE script and hands it to the app as the string module
// `virtual:model-diagram-engine`. Every build has it, dev and release: it is
// built the first time something imports it and kept for the rest of the run.
// In a release build it lands in a chunk of its own, behind the dynamic import
// in modelDiagramEngineBundleBlock.ts, so it costs nothing at startup.

const ID = 'virtual:model-diagram-engine'
const RESOLVED = '\0' + ID

export function modelDiagramEnginePlugin(): Plugin {
  const frontend = __dirname
  const entry = path.resolve(frontend, 'src/services/lego_blocks/integrations/modelDiagramMountBlock.ts')
  let code: Promise<string> | null = null
  const bundle = async (): Promise<string> => {
    const result = await build({
      configFile: false,
      logLevel: 'warn',
      root: frontend,
      resolve: { alias: { '@': path.resolve(frontend, 'src') } },
      define: { 'process.env.NODE_ENV': '"production"' },
      build: {
        lib: { entry, name: 'ModelDiagram', formats: ['iife'], fileName: () => 'model-diagram-engine.iife.js' },
        write: false,
        minify: true,
        sourcemap: false,
        copyPublicDir: false,
      },
    })
    const outputs = Array.isArray(result) ? result : [result]
    for (const out of outputs) {
      if (!('output' in out)) continue
      for (const chunk of out.output) if (chunk.type === 'chunk') return chunk.code
    }
    throw new Error('The model-diagram engine bundle came out empty.')
  }
  return {
    name: 'thinking-space-model-diagram-engine',
    resolveId(id) { return id === ID ? RESOLVED : null },
    load(id) {
      if (id !== RESOLVED) return null
      code ??= bundle()
      return code.then((js) => `export default ${JSON.stringify(js)}`)
    },
    // The engine's own files changing in dev makes the next export build it again.
    handleHotUpdate({ file }) { if (/modelDiagram[A-Za-z]*Block\.ts$/.test(file)) code = null },
  }
}
