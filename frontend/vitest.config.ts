import { defineConfig } from 'vitest/config'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@excalidraw/excalidraw': fileURLToPath(new URL('./tests/mocks/excalidrawRuntimeMock.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    // .tsx too: @testing-library/react is a dependency but no component
    // test could ever run under a .ts-only include.
    // The private Gaps folder carries its own tests; absent in the public repo.
    include: ['tests/**/*.test.{ts,tsx}', 'src/personal_extension/gaps/tests/**/*.test.{ts,tsx}'],
  },
})
