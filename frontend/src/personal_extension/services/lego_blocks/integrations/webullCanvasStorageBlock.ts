import { createCanvasStorageAdapter } from '@/services/lego_blocks/integrations/canvasStorageBlock'

export const WEBULL_F9_CANVAS_PATH = '.thinking-space/webull-f9-canvas.json'
export const WEBULL_F9_CANVAS_DIR = '.thinking-space'
// v2 (2026-06): world dimensions tightened; seed post-its repositioned.
// Bump forces a re-seed on next read; persisted tile positions from v1 are
// discarded so post-its land inside the new bounds instead of off-screen.
export const WEBULL_F9_CANVAS_VERSION = 2

export const webullF9CanvasStorage = createCanvasStorageAdapter({
  path: WEBULL_F9_CANVAS_PATH,
  dir: WEBULL_F9_CANVAS_DIR,
  version: WEBULL_F9_CANVAS_VERSION,
})

// Separate persisted board for the Sim subtab so its post-its/widgets don't
// collide with the Study canvas above.
export const WEBULL_F9_SIM_CANVAS_PATH = '.thinking-space/webull-f9-sim-canvas.json'
export const WEBULL_F9_SIM_CANVAS_VERSION = 1

export const webullF9SimCanvasStorage = createCanvasStorageAdapter({
  path: WEBULL_F9_SIM_CANVAS_PATH,
  dir: WEBULL_F9_CANVAS_DIR,
  version: WEBULL_F9_SIM_CANVAS_VERSION,
})
