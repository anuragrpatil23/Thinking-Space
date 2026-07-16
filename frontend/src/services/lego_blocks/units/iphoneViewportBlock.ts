// iPhone viewport lock — pins the viewport meta to a non-zoomable scale so the
// native iOS shell doesn't pinch-zoom the web layer. Previously an inline
// <script> in index.html; moved into the module entry so the built HTML carries
// zero inline scripts and the production CSP can drop script-src 'unsafe-inline'
// (see setupContentSecurityPolicy in electron/src/setup.ts). No-op off iOS.

export function enforceIPhoneViewportNoZoomBlock(): void {
  if (typeof navigator === 'undefined' || typeof document === 'undefined') return
  const ua = navigator.userAgent || ''
  if (!/iPhone/i.test(ua)) return
  const meta = document.querySelector('meta[name="viewport"]')
  if (!meta) return
  meta.setAttribute(
    'content',
    'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover',
  )
}
