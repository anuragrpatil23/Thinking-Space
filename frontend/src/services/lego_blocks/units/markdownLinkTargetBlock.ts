/**
 * Classifies the href of a plain markdown link (`[text](href)`), so the viewer
 * can route it itself. Left to the browser, a relative href navigates the
 * whole app document to a path that is not the app.
 */
export type MarkdownLinkTargetBlock =
  | { kind: 'anchor'; fragment: string }
  | { kind: 'external'; url: string }
  | { kind: 'vault'; path: string }
  | { kind: 'other' }

const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function classifyMarkdownLinkTargetBlock(href: string | null | undefined): MarkdownLinkTargetBlock {
  const trimmed = typeof href === 'string' ? href.trim() : ''
  if (!trimmed) return { kind: 'other' }

  if (trimmed.startsWith('#')) {
    const fragment = safeDecode(trimmed.slice(1))
    return fragment ? { kind: 'anchor', fragment } : { kind: 'other' }
  }

  if (trimmed.startsWith('//')) return { kind: 'external', url: `https:${trimmed}` }
  if (/^https?:\/\//i.test(trimmed)) return { kind: 'external', url: trimmed }
  if (SCHEME_PATTERN.test(trimmed)) return { kind: 'other' }

  const path = safeDecode(trimmed.split(/[?#]/, 1)[0]).trim()
  return path ? { kind: 'vault', path } : { kind: 'other' }
}
