import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// A directory handle as far as BrowserVaultFS and the persistence store need:
// structured-cloneable (plain data) with a permission state the test controls.
let permission: PermissionState = 'granted'
const handle = {
  kind: 'directory',
  name: 'my-vault',
}
const handleMethods = {
  queryPermission: vi.fn(async () => permission),
  requestPermission: vi.fn(async () => {
    permission = 'granted'
    return permission
  }),
}

const store = new Map<string, string>()
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => { store.set(k, v) },
  removeItem: (k: string) => { store.delete(k) },
  clear: () => store.clear(),
})
vi.stubGlobal('window', {
  showDirectoryPicker: async () => handle,
  dispatchEvent: () => true,
})

// fake-indexeddb clones values, which drops functions; give the restored copy
// the same permission methods a real handle carries.
const realGet = IDBObjectStore.prototype.get
IDBObjectStore.prototype.get = function (this: IDBObjectStore, key: IDBValidKey) {
  const req = realGet.call(this, key)
  req.addEventListener('success', () => {
    if (req.result && typeof req.result === 'object') Object.assign(req.result, handleMethods)
  })
  return req
}

const fsBlock = await import('@/services/lego_blocks/integrations/fsBlock')

describe('browser vault folder', () => {
  beforeEach(() => {
    permission = 'granted'
    handleMethods.requestPermission.mockClear()
  })

  it('survives the vault-root change that setup makes right after picking', async () => {
    const picked = await fsBlock.pickAndInitBrowserVaultFS()
    fsBlock.setVaultFSInstance(picked)
    fsBlock.setVaultRoot(fsBlock.BROWSER_VAULT_ROOT_BLOCK)
    expect(fsBlock.getVaultFS()).toBe(picked)
  })

  it('reconnects silently while permission is still granted', async () => {
    const fs = await fsBlock.initBrowserVaultFS()
    expect(fs).not.toBeNull()
    expect(handleMethods.requestPermission).not.toHaveBeenCalled()
  })

  it('does not prompt on load, and prompts only when asked to', async () => {
    permission = 'prompt'
    expect(await fsBlock.initBrowserVaultFS()).toBeNull()
    expect(handleMethods.requestPermission).not.toHaveBeenCalled()

    expect(await fsBlock.initBrowserVaultFS({ prompt: true })).not.toBeNull()
    expect(handleMethods.requestPermission).toHaveBeenCalledTimes(1)
  })
})
