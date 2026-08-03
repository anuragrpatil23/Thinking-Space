// Pure-validator tests for scheduleStorageBlock.
// We test the exported sanitizeScheduleSpecBlock function because it does
// the actual rule-checking. The block's I/O wrappers (read/write/list/delete)
// import electron's `app` to resolve userData; mocking that across the
// transitive import boundary is flaky in this monorepo layout, and the pure
// validator covers the dumb regressions we actually care about.

import { describe, expect, it, vi } from 'vitest'

// Electron is imported transitively by the block under test. We don't exercise
// `app.getPath` in any test below, but the import statement itself runs at
// module-load time — so we stub the module to keep the load from failing in
// non-electron environments.
vi.mock('electron', () => ({ app: { getPath: () => '/tmp' } }))

async function loadBlock() {
  return import('../electron/src/lego_blocks/scheduleStorageBlock')
}

function baseSpec(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    key: 'test-spec',
    label: 'com.thinkingspace.test-spec',
    title: 'Test spec',
    enabled: true,
    execution: { kind: 'shell', command: '/bin/echo', args: ['hi'] },
    schedule: { kind: 'calendar', entries: [{ hour: 9, minute: 0 }] },
    managedBy: 'thinking-space',
    createdAt: '2026-05-22T00:00:00Z',
    updatedAt: '2026-05-22T00:00:00Z',
    ...overrides,
  }
}

describe('sanitizeScheduleSpecBlock', () => {
  describe('happy paths', () => {
    it('accepts a minimal valid shell spec', async () => {
      const { sanitizeScheduleSpecBlock } = await loadBlock()
      const out = sanitizeScheduleSpecBlock(baseSpec())
      expect(out).not.toBeNull()
      expect(out!.key).toBe('test-spec')
      expect(out!.execution.kind).toBe('shell')
      expect(out!.managedBy).toBe('thinking-space')
    })

    it('accepts a claude-code spec with all optional fields', async () => {
      const { sanitizeScheduleSpecBlock } = await loadBlock()
      const out = sanitizeScheduleSpecBlock(baseSpec({
        execution: {
          kind: 'claude-code',
          prompt: 'do the thing',
          cwd: '/tmp',
          session: { mode: 'resume', id: '01H' },
          model: 'opus',
          skipPermissions: true,
          claudeBinary: '/opt/homebrew/bin/claude',
        },
      }))
      expect(out).not.toBeNull()
      expect(out!.execution.kind).toBe('claude-code')
      if (out!.execution.kind === 'claude-code') {
        expect(out!.execution.session?.id).toBe('01H')
        expect(out!.execution.skipPermissions).toBe(true)
      }
    })

    it('defaults enabled to true when omitted', async () => {
      const { sanitizeScheduleSpecBlock } = await loadBlock()
      const raw = baseSpec()
      delete raw.enabled
      expect(sanitizeScheduleSpecBlock(raw)!.enabled).toBe(true)
    })

    it('defaults enabled to true when truthy non-false value', async () => {
      const { sanitizeScheduleSpecBlock } = await loadBlock()
      expect(sanitizeScheduleSpecBlock(baseSpec({ enabled: true }))!.enabled).toBe(true)
    })

    it('honors enabled: false', async () => {
      const { sanitizeScheduleSpecBlock } = await loadBlock()
      expect(sanitizeScheduleSpecBlock(baseSpec({ enabled: false }))!.enabled).toBe(false)
    })

    it('maps unknown managedBy values to thinking-space', async () => {
      const { sanitizeScheduleSpecBlock } = await loadBlock()
      expect(sanitizeScheduleSpecBlock(baseSpec({ managedBy: 'whatever' }))!.managedBy).toBe('thinking-space')
    })

    it('preserves managedBy: external', async () => {
      const { sanitizeScheduleSpecBlock } = await loadBlock()
      expect(sanitizeScheduleSpecBlock(baseSpec({ managedBy: 'external' }))!.managedBy).toBe('external')
    })
  })

  describe('key validation', () => {
    it.each([
      ['UPPER', 'uppercase letters'],
      ['-leading', 'leading hyphen'],
      ['has spaces', 'space'],
      ['has/slash', 'slash'],
      ['a'.repeat(64), 'too long'],
      ['', 'empty'],
    ])('rejects key "%s" (%s)', async (key) => {
      const { sanitizeScheduleSpecBlock } = await loadBlock()
      expect(sanitizeScheduleSpecBlock(baseSpec({ key }))).toBeNull()
    })

    it.each(['a', 'a-b', 'abc-123', 'auto-commit', '0', '0-key'])('accepts key "%s"', async (key) => {
      const { sanitizeScheduleSpecBlock } = await loadBlock()
      expect(sanitizeScheduleSpecBlock(baseSpec({ key, label: `com.thinkingspace.${key}` }))).not.toBeNull()
    })
  })

  describe('execution validation', () => {
    it('rejects shell spec with missing command', async () => {
      const { sanitizeScheduleSpecBlock } = await loadBlock()
      expect(sanitizeScheduleSpecBlock(baseSpec({
        execution: { kind: 'shell', command: '', args: [] },
      }))).toBeNull()
    })

    it('rejects shell spec with non-string args', async () => {
      const { sanitizeScheduleSpecBlock } = await loadBlock()
      expect(sanitizeScheduleSpecBlock(baseSpec({
        execution: { kind: 'shell', command: '/bin/echo', args: [1, 2] },
      }))).toBeNull()
    })

    it('rejects claude-code spec missing prompt', async () => {
      const { sanitizeScheduleSpecBlock } = await loadBlock()
      expect(sanitizeScheduleSpecBlock(baseSpec({
        execution: { kind: 'claude-code', prompt: '   ', cwd: '/tmp' },
      }))).toBeNull()
    })

    it('rejects claude-code spec missing cwd', async () => {
      const { sanitizeScheduleSpecBlock } = await loadBlock()
      expect(sanitizeScheduleSpecBlock(baseSpec({
        execution: { kind: 'claude-code', prompt: 'do', cwd: '' },
      }))).toBeNull()
    })

    it('rejects claude-code resume mode without session.id', async () => {
      const { sanitizeScheduleSpecBlock } = await loadBlock()
      expect(sanitizeScheduleSpecBlock(baseSpec({
        execution: {
          kind: 'claude-code',
          prompt: 'do',
          cwd: '/tmp',
          session: { mode: 'resume', id: '' },
        },
      }))).toBeNull()
    })

    it('accepts claude-code continue mode without session.id', async () => {
      const { sanitizeScheduleSpecBlock } = await loadBlock()
      expect(sanitizeScheduleSpecBlock(baseSpec({
        execution: {
          kind: 'claude-code',
          prompt: 'do',
          cwd: '/tmp',
          session: { mode: 'continue' },
        },
      }))).not.toBeNull()
    })

    it('rejects unknown execution kind', async () => {
      const { sanitizeScheduleSpecBlock } = await loadBlock()
      expect(sanitizeScheduleSpecBlock(baseSpec({
        execution: { kind: 'wat', command: '/bin/echo', args: [] },
      }))).toBeNull()
    })

    it('rejects missing execution object', async () => {
      const { sanitizeScheduleSpecBlock } = await loadBlock()
      expect(sanitizeScheduleSpecBlock(baseSpec({ execution: null }))).toBeNull()
    })
  })

  describe('schedule validation', () => {
    it('rejects calendar with empty entries array', async () => {
      const { sanitizeScheduleSpecBlock } = await loadBlock()
      expect(sanitizeScheduleSpecBlock(baseSpec({
        schedule: { kind: 'calendar', entries: [] },
      }))).toBeNull()
    })

    it.each([
      [{ hour: -1, minute: 0 }, 'hour < 0'],
      [{ hour: 24, minute: 0 }, 'hour > 23'],
      [{ hour: 9, minute: 60 }, 'minute > 59'],
      [{ hour: 9, minute: -1 }, 'minute < 0'],
      [{ hour: 'nine', minute: 0 }, 'hour non-numeric'],
    ])('rejects out-of-range calendar entry %j (%s)', async (entry, _label) => {
      const { sanitizeScheduleSpecBlock } = await loadBlock()
      expect(sanitizeScheduleSpecBlock(baseSpec({
        schedule: { kind: 'calendar', entries: [entry] },
      }))).toBeNull()
    })

    it('rejects calendar entry with weekday out of range', async () => {
      const { sanitizeScheduleSpecBlock } = await loadBlock()
      expect(sanitizeScheduleSpecBlock(baseSpec({
        schedule: { kind: 'calendar', entries: [{ hour: 9, minute: 0, weekday: 8 }] },
      }))).toBeNull()
    })

    it('accepts calendar entry with optional weekday in range', async () => {
      const { sanitizeScheduleSpecBlock } = await loadBlock()
      const out = sanitizeScheduleSpecBlock(baseSpec({
        schedule: { kind: 'calendar', entries: [{ hour: 9, minute: 0, weekday: 1 }] },
      }))
      expect(out).not.toBeNull()
    })

    it('rejects interval schedule with zero seconds', async () => {
      const { sanitizeScheduleSpecBlock } = await loadBlock()
      expect(sanitizeScheduleSpecBlock(baseSpec({
        schedule: { kind: 'interval', seconds: 0 },
      }))).toBeNull()
    })

    it('rejects interval schedule with negative seconds', async () => {
      const { sanitizeScheduleSpecBlock } = await loadBlock()
      expect(sanitizeScheduleSpecBlock(baseSpec({
        schedule: { kind: 'interval', seconds: -5 },
      }))).toBeNull()
    })

    it('accepts interval schedule with positive seconds', async () => {
      const { sanitizeScheduleSpecBlock } = await loadBlock()
      const out = sanitizeScheduleSpecBlock(baseSpec({
        schedule: { kind: 'interval', seconds: 600 },
      }))
      expect(out!.schedule.kind).toBe('interval')
    })

    it('rejects unknown schedule kind', async () => {
      const { sanitizeScheduleSpecBlock } = await loadBlock()
      expect(sanitizeScheduleSpecBlock(baseSpec({
        schedule: { kind: 'cron', expression: '* * * * *' },
      }))).toBeNull()
    })
  })

  describe('top-level shape', () => {
    it('rejects null input', async () => {
      const { sanitizeScheduleSpecBlock } = await loadBlock()
      expect(sanitizeScheduleSpecBlock(null)).toBeNull()
    })

    it('rejects array input', async () => {
      const { sanitizeScheduleSpecBlock } = await loadBlock()
      expect(sanitizeScheduleSpecBlock([])).toBeNull()
    })

    it('rejects empty label', async () => {
      const { sanitizeScheduleSpecBlock } = await loadBlock()
      expect(sanitizeScheduleSpecBlock(baseSpec({ label: '' }))).toBeNull()
    })

    it('rejects non-string title', async () => {
      const { sanitizeScheduleSpecBlock } = await loadBlock()
      expect(sanitizeScheduleSpecBlock(baseSpec({ title: 42 }))).toBeNull()
    })

    it('falls back createdAt/updatedAt to now when missing', async () => {
      const { sanitizeScheduleSpecBlock } = await loadBlock()
      const raw = baseSpec()
      delete raw.createdAt
      delete raw.updatedAt
      const out = sanitizeScheduleSpecBlock(raw)
      expect(out!.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
      expect(out!.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    })
  })
})
