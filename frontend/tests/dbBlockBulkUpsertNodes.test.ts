import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import { bulkUpsertNodes, deleteDb, getNodeCount, type NodeRecord } from '@/services/lego_blocks/integrations/dbBlock'

function noteBlock(i: number): Omit<NodeRecord, 'id'> {
  return {
    uuid: `uuid-${i}`,
    key: `note-${i}`,
    title: `Note ${i}`,
    type: 'note',
    level: 0,
    filePath: `notes/note-${i}.md`,
  } as Omit<NodeRecord, 'id'>
}

describe('bulkUpsertNodes', () => {
  afterEach(async () => {
    await deleteDb()
  })

  /* Two syncs overlapping (focus refresh + startup) used to both read the
     same notes as new and both bulkAdd them; the second failed with
     "31 of 32 operations failed. ConstraintError". */
  it('lets overlapping syncs of the same new notes both succeed', async () => {
    const batch = Array.from({ length: 32 }, (_, i) => noteBlock(i))
    const results = await Promise.all([bulkUpsertNodes(batch), bulkUpsertNodes(batch)])
    expect(results.map(r => r.writtenCount)).toEqual([32, 32])
    expect(await getNodeCount()).toBe(32)
  })
})
