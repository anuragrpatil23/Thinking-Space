function appDocumentPath(url: string): string {
  const pathname = new URL(url).pathname;
  return pathname === '' || pathname === '/index.html' ? '/' : pathname;
}

// The app is one document routed by hash, so a navigation that changes the
// path under the app's own scheme can only land on a page that is not the app
// (a relative link the renderer failed to intercept). Reloads keep the path;
// other schemes are not this guard's concern.
export function isStrayAppNavigationBlock(currentUrl: string, nextUrl: string, customScheme: string): boolean {
  const prefix = `${customScheme}://`;
  if (!currentUrl.startsWith(prefix) || !nextUrl.startsWith(prefix)) return false;
  try {
    return appDocumentPath(currentUrl) !== appDocumentPath(nextUrl);
  } catch {
    return true;
  }
}
