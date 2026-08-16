import { Fragment, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

// Deliberately-minimal inline Markdown renderer. NOT a markdown engine — it
// understands `**bold**`, inline `` `code` ``, and ATX headings (`## Heading`),
// the tokens the AI summaries actually emit. Everything else (newlines,
// indentation, list numbers) is passed through verbatim and preserved by
// `whitespace-pre-wrap`, so the block stays as lightweight and responsive as
// the raw <pre> it replaced. If a token is malformed/unbalanced it simply
// renders as literal text — there's no failure mode that hides content.
//
// Headings render as an emphasised span rather than a block element: the
// container is `whitespace-pre-wrap`, so the newline after the heading already
// puts it on its own line, and a real block would fight the preserved
// whitespace for spacing.

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

/** `## Heading` at the start of a line, up to six levels. The marker is dropped;
 *  what survives is the emphasis it was standing in for. */
const HEADING_RE = /^(#{1,6})\s+(.*)$/

function renderLines(text: string): ReactNode[] {
  const out: ReactNode[] = []
  const lines = text.split('\n')
  lines.forEach((line, i) => {
    if (i > 0) out.push('\n')
    const heading = HEADING_RE.exec(line)
    if (!heading) {
      out.push(...renderInline(line))
      return
    }
    out.push(
      <span
        key={`h-${i}`}
        className={cn(
          // inline-block so the vertical padding lands — margins do nothing on a
          // plain inline span. The air above a heading is what makes it read as
          // the start of a section rather than another line of the last one.
          'inline-block pb-0.5 font-semibold text-foreground/90',
          i > 0 && 'pt-3',
          // Only the top two levels get a size bump; deeper ones in a summary
          // this compact would be size for its own sake.
          heading[1].length <= 2 && 'text-[1.08em]',
        )}
      >
        {renderInline(heading[2])}
      </span>,
    )
  })
  return out
}

interface Props {
  text: string
  className?: string
}

/** Render `text` with very light Markdown (`**bold**`, `` `code` ``, `## head`),
 *  preserving all whitespace/newlines. Drop-in replacement for a
 *  `whitespace-pre-wrap` <pre> that was showing raw markdown. */
export default function LightMarkdownTextBlock({ text, className }: Props) {
  return (
    <div className={cn('whitespace-pre-wrap break-words', className)}>
      {renderLines(text).map((node, i) => (
        <Fragment key={i}>{node}</Fragment>
      ))}
    </div>
  )
}
