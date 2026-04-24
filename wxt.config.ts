import { fileURLToPath } from 'node:url'

import { defineConfig } from 'wxt'

const figmaMatches = ['https://www.figma.com/*', 'https://figma.com/*']

export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: 'figma-var-export',
    description: 'Export Figma variables as vars.css from the variables panel.',
    host_permissions: figmaMatches,
    web_accessible_resources: [
      {
        resources: ['page-bridge.js'],
        matches: figmaMatches,
      },
    ],
    browser_specific_settings: {
      gecko: {
        id: 'figma-var-export@bmjs.local',
        data_collection_permissions: {
          required: ['none'],
        },
      },
    },
  },
  vite: () => ({
    resolve: {
      alias: {
        '@figma-var-export/core': fileURLToPath(
          new URL('../figma-var-export/src/generate.ts', import.meta.url),
        ),
      },
    },
    server: {
      fs: {
        allow: [fileURLToPath(new URL('..', import.meta.url))],
      },
    },
  }),
})
