import { registerPlugin } from '@capacitor/core'
import type { PluginListenerHandle } from '@capacitor/core'

/** Color scheme forced onto the guest website so its `prefers-color-scheme`
 *  matches the app. 'system' lets the device decide (default WKWebView). */
export type InlineWebViewTheme = 'light' | 'dark' | 'system'

interface InlineWebViewPlugin {
  open(options: { url: string; x: number; y: number; width: number; height: number; theme?: InlineWebViewTheme }): Promise<void>
  close(): Promise<void>
  setTheme(options: { theme: InlineWebViewTheme }): Promise<void>
  suspend(): Promise<void>
  resume(options: { x: number; y: number; width: number; height: number }): Promise<{ resumed: boolean }>
  updateFrame(options: { x: number; y: number; width: number; height: number }): Promise<void>
  getCurrentUrl(): Promise<{ url: string }>
  addListener(event: 'inlineWebViewEdgeSwipeOpen', handler: () => void): Promise<PluginListenerHandle>
  addListener(event: 'inlineWebViewEdgeSwipeClose', handler: () => void): Promise<PluginListenerHandle>
  addListener(event: 'urlChanged', handler: (data: { url: string }) => void): Promise<PluginListenerHandle>
}

const InlineWebView = registerPlugin<InlineWebViewPlugin>('InlineWebView')

export async function openInlineWebViewBlock(
  url: string,
  rect: DOMRect,
  theme: InlineWebViewTheme = 'system',
): Promise<void> {
  await InlineWebView.open({ url, x: rect.left, y: rect.top, width: rect.width, height: rect.height, theme })
}

/** Live-update the guest webview's forced color scheme (app theme toggled while
 *  an article is open). No-op if the plugin predates this method. */
export async function setInlineWebViewThemeBlock(theme: InlineWebViewTheme): Promise<void> {
  await InlineWebView.setTheme?.({ theme })
}

export async function closeInlineWebViewBlock(): Promise<void> {
  await InlineWebView.close()
}

/** Move the WKWebView offscreen, preserving all session state. */
export async function suspendInlineWebViewBlock(): Promise<void> {
  await InlineWebView.suspend()
}

/** Restore a suspended WKWebView to the given frame without reloading.
 *  Returns true if a suspended webview was found and resumed. */
export async function resumeInlineWebViewBlock(rect: DOMRect): Promise<boolean> {
  const result = await InlineWebView.resume({ x: rect.left, y: rect.top, width: rect.width, height: rect.height })
  return result.resumed
}

export async function updateInlineWebViewFrameBlock(rect: DOMRect): Promise<void> {
  await InlineWebView.updateFrame({ x: rect.left, y: rect.top, width: rect.width, height: rect.height })
}

export async function addInlineWebViewSwipeOpenListenerBlock(handler: () => void): Promise<PluginListenerHandle> {
  return InlineWebView.addListener('inlineWebViewEdgeSwipeOpen', handler)
}

export async function addInlineWebViewSwipeCloseListenerBlock(handler: () => void): Promise<PluginListenerHandle> {
  return InlineWebView.addListener('inlineWebViewEdgeSwipeClose', handler)
}

export async function getInlineWebViewCurrentUrlBlock(): Promise<string> {
  const result = await InlineWebView.getCurrentUrl()
  return result.url
}

export async function addInlineWebViewUrlChangedListenerBlock(handler: (url: string) => void): Promise<PluginListenerHandle> {
  return InlineWebView.addListener('urlChanged', (data) => handler(data.url))
}
