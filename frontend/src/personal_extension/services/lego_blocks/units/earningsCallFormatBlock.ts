// An earnings call as readable Markdown: frontmatter (ticker, date, quarter),
// a title, "Prepared remarks" and "Questions and answers" (split where someone
// first opens the floor to questions), one paragraph per speaker turn with
// the speaker in bold, and long turns broken every five sentences. Only line
// breaks and markup are added; the words stay as transcribed. The vault's
// existing calls were rewritten the same way (2026-10-23).

const QA_START_BLOCK = /(first question|open (?:it |the call |the line )?(?:up )?(?:for|to) questions|begin the question|question-and-answer session|now take questions|open the line for questions|move to Q&A|Q&A session)/i
const TURN_BLOCK = /^([A-Z][\w.'-]+(?: [A-Z][\w.'-]+){0,4}|Operator|Unidentified [A-Za-z ]+|Unknown [A-Za-z ]+):\s+(.*)$/
const SENTENCES_PER_PARAGRAPH_BLOCK = 5

function paragraphsBlock(text: string): string[] {
  const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z"[])/)
  const out: string[] = []
  for (let i = 0; i < sentences.length; i += SENTENCES_PER_PARAGRAPH_BLOCK) {
    out.push(sentences.slice(i, i + SENTENCES_PER_PARAGRAPH_BLOCK).join(' '))
  }
  return out
}

/** `body` is the transcript as speaker turns ("Name: text"), one per line or paragraph. */
export function formatEarningsCallBlock(params: { ticker: string; date: string; quarter: string; body: string }): string {
  const turns: Array<{ speaker: string; text: string }> = []
  for (const raw of params.body.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const turn = TURN_BLOCK.exec(line)
    if (turn) turns.push({ speaker: turn[1], text: turn[2] })
    else if (turns.length > 0) turns[turns.length - 1].text += `\n\n${line}`
    else turns.push({ speaker: '', text: line })
  }
  const when = /^\d{4}-\d{2}-\d{2}$/.test(params.date)
    ? new Date(`${params.date}T12:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    : params.quarter
  const out = ['---', `ticker: ${params.ticker}`, `date: ${params.date}`, `quarter: ${params.quarter}`, 'type: earnings-call', '---', '', `# ${params.ticker} earnings call · ${when}`, '', '## Prepared remarks', '']
  let inQa = false
  turns.forEach(({ speaker, text }, index) => {
    if (!inQa && index > 0 && QA_START_BLOCK.test(text)) {
      out.push('## Questions and answers', '')
      inQa = true
    }
    const paragraphs = text.split('\n\n').flatMap(paragraphsBlock).filter(Boolean)
    if (paragraphs.length === 0) return
    out.push(speaker ? `**${speaker}:** ${paragraphs[0]}` : paragraphs[0], '')
    for (const p of paragraphs.slice(1)) out.push(p, '')
  })
  return `${out.join('\n').trimEnd()}\n`
}
