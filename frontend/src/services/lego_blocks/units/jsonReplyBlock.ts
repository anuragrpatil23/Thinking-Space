/**
 * Pulling a JSON object out of a model reply.
 *
 * Every "return STRICT JSON" prompt in the app hits the same three realities:
 * the model fences the block, or prefixes it with a sentence, or both. This is
 * the one place that knows how to survive that. It is a unit rather than a
 * private helper because the alternative — which is what the codebase had —
 * is each caller quietly disagreeing about whether a fenced reply parses.
 */
export function extractJsonObjectBlock(text: string): Record<string, unknown> | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  const raw = fenced ? fenced[1].trim() : text.trim()
  const firstBrace = raw.indexOf('{')
  const lastBrace = raw.lastIndexOf('}')
  if (firstBrace < 0 || lastBrace <= firstBrace) return null
  try {
    const parsed = JSON.parse(raw.slice(firstBrace, lastBrace + 1)) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}
