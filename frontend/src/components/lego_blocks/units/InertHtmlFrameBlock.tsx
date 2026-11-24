import { useEffect, useRef, useState } from 'react'

// Shows a self-contained HTML file (a drawn figure, a report) as a picture:
// no scripts, no network (a CSP allows only inline styles and data: images and
// fonts), and no clicks reach it, so nothing inside can navigate or run. It is
// laid out at `pageWidth` and scaled to fit the box, at its full height.

const INERT_CSP = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:"

export function inertHtmlDocumentBlock(html: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${INERT_CSP}">`
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, match => `${match}${meta}`) : `${meta}${html}`
}

export default function InertHtmlFrameBlock({ html, title, pageWidth = 980, maxHeight }: {
  html: string
  title: string
  /** The width the page is laid out at before scaling. */
  pageWidth?: number
  /** Cut off below this many shown pixels; the rest is hidden, not scrolled. */
  maxHeight?: number
}) {
  const box = useRef<HTMLDivElement>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  const [width, setWidth] = useState(0)
  const [pageHeight, setPageHeight] = useState(400)

  useEffect(() => {
    const node = box.current
    if (!node) return
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  const measure = () => {
    // Same origin but scriptless, so the parent can read the laid-out height.
    const doc = frame.current?.contentDocument
    if (doc?.documentElement) setPageHeight(Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight ?? 0))
  }

  const scale = width > 0 ? Math.min(1, width / pageWidth) : 0
  const shown = pageHeight * scale
  return (
    <div ref={box} className="relative w-full overflow-hidden" style={{ height: maxHeight ? Math.min(shown, maxHeight) : shown }}>
      {scale > 0 && (
        <iframe
          ref={frame}
          title={title}
          srcDoc={inertHtmlDocumentBlock(html)}
          sandbox="allow-same-origin"
          referrerPolicy="no-referrer"
          onLoad={measure}
          className="pointer-events-none absolute left-0 top-0 origin-top-left border-0 bg-white"
          style={{ width: pageWidth, height: pageHeight, transform: `scale(${scale})` }}
        />
      )}
    </div>
  )
}
