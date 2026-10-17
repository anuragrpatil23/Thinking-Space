/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WEBULL_BASE_URL?: string
  readonly VITE_WEBULL_OPENAPI_BASE_URL?: string
  readonly VITE_WEBULL_ACCOUNT_LIST_PATH?: string
  readonly VITE_WEBULL_ACCOUNT_BALANCE_PATH?: string
  readonly VITE_WEBULL_ACCOUNT_POSITIONS_PATH?: string
  readonly VITE_WEBULL_MARKET_SNAPSHOT_PATH?: string
  readonly VITE_WEBULL_MARKET_QUOTES_PATH?: string
  readonly VITE_WEBULL_QUOTE_SYMBOLS?: string
  /** 'true' in the static GitHub Pages build (vite.config.ts). */
  readonly VITE_HASH_ROUTER?: string
}

// File System Access API types (Chromium-only, not in lib.dom yet)
interface FileSystemDirectoryHandle {
  kind: 'directory'
  name: string
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle>
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FileSystemDirectoryHandle>
  entries(): AsyncIterableIterator<[string, FileSystemDirectoryHandle | FileSystemFileHandle]>
  queryPermission(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
  requestPermission(descriptor: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
}

interface FileSystemFileHandle {
  kind: 'file'
  name: string
  getFile(): Promise<File>
  createWritable(): Promise<FileSystemWritableFileStream>
}

interface FileSystemWritableFileStream extends WritableStream {
  write(data: string | BufferSource | Blob): Promise<void>
  close(): Promise<void>
}

interface Window {
  showDirectoryPicker(options?: { mode?: 'read' | 'readwrite' }): Promise<FileSystemDirectoryHandle>
}
