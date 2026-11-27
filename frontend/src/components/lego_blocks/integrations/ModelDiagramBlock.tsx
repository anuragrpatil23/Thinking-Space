// A model drawn in 3D: the step strip, the stage and the cards under it. A thin
// React shell around the framework-free mount, which is loaded on demand so
// three.js never reaches the app's startup bundle. The parent gives it a box of
// full content width; it sets its own height.
import { useEffect, useRef } from 'react'
import type { ModelSpec, ModelValues } from '../../../services/lego_blocks/units/modelDiagramFormatBlock'
import type { ModelDiagramHandleBlock } from '../../../services/lego_blocks/integrations/modelDiagramMountBlock'

export interface ModelDiagramBlockProps {
  spec: ModelSpec
  /** Names of the values files, in order. */
  inputs: string[]
  /** Called only when the drawing needs an input's values. */
  loadValues: (input: string) => Promise<ModelValues>
  /** An address an <img> can show for the picture that went in with this input; null when it has none. */
  loadPicture?: (input: string) => Promise<string | null>
  /** 1-based index into spec.steps; 0 is the whole model. */
  step: number
  /** The stop inside that step, when the step opens into several. */
  part?: string
  onStep: (step: number, part?: string) => void
  onPickBlock?: (id: string) => void
  theme?: 'light' | 'dark'
  onReady?: (info: { firstFrameMs: number }) => void
  className?: string
}

export default function ModelDiagramBlock(props: ModelDiagramBlockProps) {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const handleRef = useRef<ModelDiagramHandleBlock | null>(null)
  const latest = useRef(props)
  latest.current = props

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let gone = false
    void import('../../../services/lego_blocks/integrations/modelDiagramMountBlock').then(({ mountModelDiagram }) => {
      if (gone) return
      const p = latest.current
      handleRef.current = mountModelDiagram(host, {
        spec: p.spec, inputs: p.inputs, step: p.step, part: p.part, theme: p.theme, appearance: 'app',
        loadValues: (input) => latest.current.loadValues(input),
        loadPicture: (input) => latest.current.loadPicture?.(input) ?? Promise.resolve(null),
        onStep: (step, part) => latest.current.onStep(step, part),
        onPickBlock: (id) => latest.current.onPickBlock?.(id),
        onReady: (info) => latest.current.onReady?.(info),
      })
    })
    return () => { gone = true; handleRef.current?.dispose(); handleRef.current = null }
    // A different model or set of inputs is a different drawing.
  }, [props.spec, props.inputs])

  useEffect(() => { handleRef.current?.setStep(props.step, props.part) }, [props.step, props.part])
  useEffect(() => { handleRef.current?.setTheme(props.theme) }, [props.theme])

  return <div ref={hostRef} className={props.className} />
}
