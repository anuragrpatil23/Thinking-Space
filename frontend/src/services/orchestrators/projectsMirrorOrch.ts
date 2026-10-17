/**
 * Keep `.thinking-space/projects.md` in step with `projects.json` however the
 * JSON was changed. Settings saves already rewrite the mirror; this covers
 * everything else: once at launch for edits made while the app was closed, and
 * on every outside change while it is open (Electron only; elsewhere launch is
 * the only trigger).
 */

import {
  PROJECTS_FILE_PATH_BLOCK,
  reconcileProjectsFromDiskBlock,
} from '@/services/lego_blocks/integrations/projectsStorageBlock'
import { subscribeExternalVaultChangesBlock } from '@/services/lego_blocks/integrations/vaultExternalChangeBlock'

const CHANGE_DEBOUNCE_MS = 300

export function startProjectsMirrorOrch(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null
  void reconcileProjectsFromDiskBlock()
  const unsubscribe = subscribeExternalVaultChangesBlock(change => {
    if (change.relPath !== PROJECTS_FILE_PATH_BLOCK || change.kind === 'unlink') return
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void reconcileProjectsFromDiskBlock()
    }, CHANGE_DEBOUNCE_MS)
  })
  return () => {
    unsubscribe()
    if (timer !== null) clearTimeout(timer)
    timer = null
  }
}
