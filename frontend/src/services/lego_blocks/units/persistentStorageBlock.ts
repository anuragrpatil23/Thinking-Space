// Persistent-storage request — asks the browser/WebView to exempt this
// origin's storage (IndexedDB vault cache, localStorage sync markers) from
// best-effort eviction. Matters most on iOS: WKWebView storage is evictable
// under disk pressure, and losing the IndexedDB cache silently downgrades the
// next launch to a full vault re-sync. Fire-and-forget: browsers may deny or
// not implement it, and the app works either way — the cache is rebuildable
// by design (locked decision #3), persistence just avoids paying the rebuild.

export function requestPersistentStorageBlock(): void {
  try {
    void navigator.storage?.persist?.().catch(() => undefined)
  } catch {
    // Older WebViews without the Storage API — nothing to do.
  }
}
