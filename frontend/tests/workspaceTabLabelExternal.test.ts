import { describe, expect, it } from 'vitest'
import { getTabLabel } from '@/services/lego_blocks/integrations/workspaceTabsBlock'

describe('getTabLabel for files', () => {
  it('labels a vault file as Space and an outside file as External', () => {
    expect(getTabLabel(`/thinking-space?file=${encodeURIComponent('notes/plan.md')}`, new Map())).toBe('Space · plan.md')
    expect(getTabLabel(`/thinking-space?file=${encodeURIComponent('/Volumes/repo/docs/PLAN.md')}`, new Map())).toBe('External · PLAN.md')
  })
})
