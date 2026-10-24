// "Is it working?": the smallest real request through the intelligence layer,
// sent from Settings → AI's Test button. The answer is shown as it came back.

import { defineContractBlock, type ContractOutput } from '../promptContractBlock'
import { s } from '../schemaBlock'

export const settingsPingContract = defineContractBlock<{ at: string }, ReturnType<typeof s.string>, string>({
  id: 'settings-test',
  promptVersion: 1,
  outputSchema: s.string({ description: 'One short line' }),
  // Every test is its own request
  cacheKey: (input: { at: string }) => input.at,
  buildRequest: () => ({
    system: 'You are checking a connection. Answer in one short line.',
    messages: [{ role: 'user' as const, content: 'Reply with: ready' }],
    temperature: 0,
  }),
  finalize: (raw: string): ContractOutput<string> | null => {
    const text = raw.replace(/\s+/g, ' ').trim()
    return text ? { value: text.slice(0, 120), meta: {} } : null
  },
})
