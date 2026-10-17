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

export default defineConfig({
  base: isLocalBuild || isPagesBuild ? './' : '/thinking-space/',
  define: {
    'import.meta.env.VITE_HASH_ROUTER': JSON.stringify(isPagesBuild ? 'true' : ''),
  },
  plugins: [react()],
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
