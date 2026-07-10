import { Fragment, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

// Deliberately-minimal inline Markdown renderer. NOT a markdown engine — it
// only understands `**bold**` and inline `` `code` ``, the two tokens the AI
// summaries actually emit. Everything else (newlines, indentation, list
// numbers) is passed through verbatim and preserved by `whitespace-pre-wrap`,
// so the block stays as lightweight and responsive as the raw <pre> it
// replaced. If a token is malformed/unbalanced it simply renders as literal
// text — there's no failure mode that hides content.

// One pass matches either a **bold** run or a `code` run. Non-greedy bodies
// stop at the first closing delimiter; `[\s\S]` lets a run wrap lines, which
// is harmless and keeps the regex simple.
const TOKEN_RE = /\*\*([\s\S]+?)\*\*|`([^`]+?)`/g

function renderInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  TOKEN_RE.lastIndex = 0
  let i = 0
  while ((match = TOKEN_RE.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index))
    if (match[1] !== undefined) {
      nodes.push(
        <strong key={i++} className="font-semibold text-foreground/90">
          {match[1]}
        </strong>,
      )
    } else if (match[2] !== undefined) {
      nodes.push(
        <code
          key={i++}
          className="rounded bg-muted/50 px-1 py-px font-mono text-[0.92em] text-foreground/85"
        >
          {match[2]}
        </code>,
      )
    }
    lastIndex = TOKEN_RE.lastIndex
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex))
  return nodes
}

interface Props {
  text: string
  className?: string
}

/** Render `text` with very light inline Markdown (`**bold**`, `` `code` ``),
 *  preserving all whitespace/newlines. Drop-in replacement for a
 *  `whitespace-pre-wrap` <pre> that was showing raw markdown. */
export default function LightMarkdownTextBlock({ text, className }: Props) {
  return (
    <div className={cn('whitespace-pre-wrap break-words', className)}>
      {renderInline(text).map((node, i) => (
        <Fragment key={i}>{node}</Fragment>
      ))}
    </div>
  )
}
