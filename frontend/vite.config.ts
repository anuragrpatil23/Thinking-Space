import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// Electron and Capacitor builds use relative paths so assets load from the app dir.
// For web, use the /thinking-space/ prefix.
// `pages` is the static GitHub Pages build: relative paths and hash routes, so
// it works under any URL prefix and a refresh never asks the host for a route
// it cannot serve.
const buildTarget = process.env.BUILD_TARGET // 'electron' | 'capacitor' | 'pages' | undefined
const isLocalBuild = buildTarget === 'electron' || buildTarget === 'capacitor'
const isPagesBuild = buildTarget === 'pages'

// The static Pages build's Content-Security-Policy. Pages cannot set headers,
// so it ships as a <meta> tag. The page may talk only to its own origin: no
// outside fetches, images or frames, so even a script that got in could not
// send the vault anywhere. That is why RSS, the Web tab, AI and Google are left
// out of this build (staticWebBuildBlock.ts). Mirrors the Electron production
// policy (electron/src/setup.ts), minus its outbound allowances.
const PAGES_CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  // React inline style props; see the Electron policy for why this stays.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "media-src 'self' data: blob:",
  "connect-src 'self' data: blob:",
  "worker-src 'self' blob:",
  // Vault HTML pages render in a sandboxed blob: iframe (HtmlDocumentBlock).
  "frame-src blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ')

export default defineConfig({
  base: isLocalBuild || isPagesBuild ? './' : '/thinking-space/',
  define: {
    'import.meta.env.VITE_HASH_ROUTER': JSON.stringify(isPagesBuild ? 'true' : ''),
  },
  plugins: [
    react(),
    isPagesBuild && {
      name: 'thinking-space-pages-csp',
      transformIndexHtml: () => [
        { tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: PAGES_CSP }, injectTo: 'head-prepend' as const },
      ],
    },
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
  build: {
    // Skip gzip size computation — saves ~3s per build and removes the size wall in output
    reportCompressedSize: false,
    // Suppress chunk-size warnings (large deps like Excalidraw/heic2any are expected)
    chunkSizeWarningLimit: 10000,
    // Use esnext for local builds — Electron ships a recent Chromium, no legacy transforms needed
    target: isLocalBuild ? 'esnext' : undefined,
    rollupOptions: {
      output: {
        // Split heavy vendor dependencies into separate chunks for better caching
        // and smaller initial bundle size
        // Only split vendors that are genuinely needed at startup. Heavy libs
        // (Excalidraw, pdfjs, CodeMirror, recharts) are reached exclusively via
        // dynamic import boundaries, so Rollup already splits them into lazy
        // chunks — listing them here would force them back into the entry's
        // static import graph (object-form manualChunks preserves side-effect
        // ordering by importing the chunk eagerly).
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-dexie': ['dexie'],
        },
      },
    },
  },
})
