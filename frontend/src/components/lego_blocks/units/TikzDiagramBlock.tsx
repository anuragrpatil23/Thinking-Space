import { useEffect, useRef, useState } from 'react'
import { requestTikzJaxProcessBlock } from '@/services/lego_blocks/integrations/tikzJaxLoaderBlock'

interface TikzDiagramBlockProps {
  source: string
  className?: string
}

function wrapTikzSource(source: string): string {
  const trimmed = source.trim()
  if (trimmed.includes('\\begin{document}')) return trimmed
  if (trimmed.startsWith('\\begin{tikzpicture}')) return trimmed
  return `\\begin{tikzpicture}\n${trimmed}\n\\end{tikzpicture}`
}

const TIKZ_PER_DIAGRAM_BUDGET_MS = 6000
const TIKZ_MIN_TIMEOUT_MS = 15000

function computeTikzRenderTimeoutBlock(): number {
  if (typeof document === 'undefined') return TIKZ_MIN_TIMEOUT_MS
  const pending = document.querySelectorAll('script[type="text/tikz"]').length
  return Math.max(TIKZ_MIN_TIMEOUT_MS, pending * TIKZ_PER_DIAGRAM_BUDGET_MS)
}

function waitForTikzRenderBlock(container: HTMLDivElement, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (container.querySelector('svg')) {
      resolve()
      return
    }

    const deadline = window.setTimeout(() => {
      observer.disconnect()
      reject(new Error('Timed out waiting for TikZ SVG output'))
    }, timeoutMs)

    const observer = new MutationObserver(() => {
      if (container.querySelector('svg')) {
        window.clearTimeout(deadline)
        observer.disconnect()
        resolve()
      }
    })

    observer.observe(container, { childList: true, subtree: true })
  })
}

export default function TikzDiagramBlock({ source, className }: TikzDiagramBlockProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    setErrorMessage(null)

    const container = containerRef.current
    if (!container) return

    container.innerHTML = ''
    const script = document.createElement('script')
    script.type = 'text/tikz'
    script.setAttribute('data-show-console', 'true')
    script.text = wrapTikzSource(source)
    container.appendChild(script)

    const renderTimeoutMs = computeTikzRenderTimeoutBlock()
    requestTikzJaxProcessBlock()
      .then(() => {
        return waitForTikzRenderBlock(container, renderTimeoutMs)
      })
      .then(() => {
        if (!cancelled) {
          setStatus('ready')
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setErrorMessage(err instanceof Error ? err.message : String(err))
        setStatus('error')
      })

    return () => {
      cancelled = true
    }
  }, [source])

  return (
    <div className={className ?? 'ltm-tikz-block my-4 flex justify-center overflow-x-auto'}>
      {status === 'loading' && (
        <div className="text-sm text-muted-foreground">Rendering TikZ…</div>
      )}
      {status === 'error' && (
        <pre className="text-sm text-red-600 dark:text-red-400 whitespace-pre-wrap">
{`TikZ render failed: ${errorMessage ?? 'unknown error'}

${source}`}
        </pre>
      )}
      <div ref={containerRef} />
    </div>
  )
}
