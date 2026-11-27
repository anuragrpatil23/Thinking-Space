// The model-diagram engine as one self-contained script (the mount with
// three.js, an IIFE that defines the global `ModelDiagram`), for a page that
// must work with no app around it: the "export as one HTML file" of a model.
// The script is made by the app's own Vite build (modelDiagramEnginePlugin.ts)
// and sits behind a dynamic import, so it is fetched only when asked for.

export async function loadModelDiagramEngineBundleBlock(): Promise<string> {
  return (await import('virtual:model-diagram-engine')).default
}
