import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@figma-var-export/core': fileURLToPath(
        new URL('../figma-var-export/src/generate.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'node',
  },
})
