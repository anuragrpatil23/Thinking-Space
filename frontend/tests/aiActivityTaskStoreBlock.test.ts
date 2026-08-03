import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TASK_DIR_BLOCK,
  taskDirBlock,
} from '@/services/lego_blocks/integrations/aiActivityTaskStoreBlock'

describe('taskDirBlock', () => {
  it('defaults to the organizer directory F9 files its records in', () => {
    expect(DEFAULT_TASK_DIR_BLOCK).toBe('epics')
    expect(taskDirBlock('lifeblood_systems/f9')).toBe(
      'lifeblood_systems/f9/thinking-organizer/epics',
    )
  })

  it('points at whichever directory the project names', () => {
    // Thinking Space's 325 live records are under `tasks/`; the hardcoded
    // `epics` used to render its 34 stale DEV-era items instead, which is worse
    // than an empty pane because it looks populated.
    expect(taskDirBlock('lifeblood_systems/thinkingspace.ai', 'tasks')).toBe(
      'lifeblood_systems/thinkingspace.ai/thinking-organizer/tasks',
    )
  })

  it('tolerates stray slashes on either side', () => {
    expect(taskDirBlock('projects/demo/', '/tasks/')).toBe(
      'projects/demo/thinking-organizer/tasks',
    )
  })
})
