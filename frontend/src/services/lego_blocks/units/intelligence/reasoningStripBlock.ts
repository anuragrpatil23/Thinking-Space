// Normalize the many ways a model can leak hidden reasoning into visible
// output. This runs on the raw content field AFTER the provider has already
// separated the top-level `reasoning` field (mlx_lm.server ≥0.31, Anthropic's
// extended thinking). What's left here is inline leakage: `<think>…</think>`
// blocks, unterminated `<think>…EOF` when the model hit max_tokens mid-thought,
// and plain-text preambles like "Here's my thinking process:".
//
// Kept centralized so a future model that leaks a new way is a one-file fix.

const THINK_TAG_CLOSED = /<think>[\s\S]*?<\/think>/gi
const THINK_TAG_UNTERMINATED = /<think>[\s\S]*$/i
// Preamble line — model announces it's thinking, then dumps thoughts.
const REASONING_PREAMBLE = /^[^\n]*\b(thinking process|let me think|let'?s think|here'?s (?:my|the) (?:thinking|reasoning|approach)|i need to think|first,?\s+let me)\b[^\n]*\n+/i
// Parenthetical meta commentary that entire-line only.
const META_PARENS = /^\s*\((?:note|comment|aside)[^)]*\)\s*$/gim

export interface StripResult {
  content: string
  /** True if we actually stripped something — useful for telemetry. */
  strippedLeakage: boolean
}

export function stripReasoningLeakageBlock(raw: string): StripResult {
  let v = raw
  const original = raw
  v = v.replace(THINK_TAG_CLOSED, '').trim()
  v = v.replace(THINK_TAG_UNTERMINATED, '').trim()
  v = v.replace(REASONING_PREAMBLE, '').trim()
  v = v.replace(META_PARENS, '').trim()
  return { content: v, strippedLeakage: v !== original.trim() }
}
