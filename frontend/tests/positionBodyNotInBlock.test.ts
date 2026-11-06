import { describe, expect, it } from 'vitest'
import { positionBodyNotInBlock } from '@/personal_extension/services/lego_blocks/integrations/webullExecutionStorageBlock'

describe('positionBodyNotInBlock', () => {
  it('treats the default headings alone as nothing to keep', () => {
    expect(positionBodyNotInBlock('## Notes\n\n\n## Comments\n', 'anything')).toBe('')
  })
  it('finds nothing to keep when the current body already holds the text', () => {
    expect(positionBodyNotInBlock('## Notes\nsell near 500\n## Comments\n', '## Notes\nsell  near 500\n\n## Comments\n')).toBe('')
  })
  it('returns the text the current body lacks', () => {
    expect(positionBodyNotInBlock('## Notes\nsell near 500\n', '## Notes\n\n## Comments\n')).toBe('sell near 500')
  })
})
