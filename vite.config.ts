import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const MANIFEST_ID = '/in-wo-osu/'

function assertManifestId(): Plugin {
  return {
    name: 'assert-manifest-id',
    apply: 'build',
    enforce: 'post',
    closeBundle() {
      const file = resolve('dist/manifest.webmanifest')
      const manifest = JSON.parse(readFileSync(file, 'utf8')) as { id?: string }
      if (manifest.id !== MANIFEST_ID) {
        throw new Error(
          `manifest id must be ${MANIFEST_ID} (never './'), got ${String(manifest.id)}`,
        )
      }
    },
  }
}

// pdf.js loads CMaps (Japanese PDFs), standard fonts, ICC profiles and wasm
// decoders at runtime. Ship them in dist/pdfjs/ so they are precached and work offline.
function pdfjsAssets(): Plugin {
  const root = resolve('node_modules/pdfjs-dist')
  const dirs: Record<string, (name: string) => boolean> = {
    cmaps: (n) => n.endsWith('.bcmap') || n.startsWith('LICENSE'),
    standard_fonts: () => true,
    iccs: () => true,
    wasm: (n) => (n.endsWith('.wasm') && !n.startsWith('quickjs')) || n.startsWith('LICENSE'),
  }
  return {
    name: 'pdfjs-assets',
    apply: 'build',
    generateBundle() {
      for (const [dir, keep] of Object.entries(dirs)) {
        for (const name of readdirSync(resolve(root, dir))) {
          if (!keep(name)) continue
          this.emitFile({
            type: 'asset',
            fileName: `pdfjs/${dir}/${name}`,
            source: readFileSync(resolve(root, dir, name)),
          })
        }
      }
    },
  }
}

export default defineConfig({
  base: './',
  plugins: [
    pdfjsAssets(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon-32.png', 'icons/icon-180.png'],
      manifest: {
        id: MANIFEST_ID,
        name: '印を押す',
        short_name: '印を押す',
        description: '書類に、はんこやサインを。Add your seal or signature to a document.',
        lang: 'ja',
        dir: 'ltr',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'any',
        background_color: '#f6f1e3',
        theme_color: '#1c3d32',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icons/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: [
          '**/*.{js,mjs,css,html,svg,png,webmanifest,woff2}',
          'pdfjs/**/*.{bcmap,pfb,ttf,icc,wasm}',
        ],
        // the pdf.js worker is larger than workbox's 2 MiB default
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
    }),
    assertManifestId(),
  ],
})
