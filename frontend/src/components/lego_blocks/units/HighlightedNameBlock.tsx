// A file or folder name with the parts the search matched set in bold —
// tells you at a glance why a row is in a filtered tree.

import { Fragment, useMemo } from 'react'

export interface HighlightedNameBlockProps {
  text: string
  /** Lowercased query tokens. */
  tokens: readonly string[]
  className?: string
}

export default function HighlightedNameBlock({ text, tokens, className }: HighlightedNameBlockProps) {
  const parts = useMemo(() => {
    if (tokens.length === 0) return null
    const lower = text.toLowerCase()
    const lit = new Array<boolean>(text.length).fill(false)
    for (const token of tokens) {
      for (let at = lower.indexOf(token); at !== -1; at = lower.indexOf(token, at + token.length)) {
        lit.fill(true, at, at + token.length)
      }
    }
    if (!lit.includes(true)) return null
    const out: { text: string; lit: boolean }[] = []
    for (let i = 0; i < text.length; i++) {
      const last = out[out.length - 1]
      if (last && last.lit === lit[i]) last.text += text[i]
      else out.push({ text: text[i], lit: lit[i] })
    }
    return out
  }, [text, tokens])

  if (!parts) return <span className={className}>{text}</span>
  return (
    <span className={className}>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {part.lit ? <span className="font-semibold text-foreground">{part.text}</span> : part.text}
        </Fragment>
      ))}
    </span>
  )
}
