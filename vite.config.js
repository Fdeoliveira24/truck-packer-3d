import { readFile } from 'node:fs/promises';

import { defineConfig } from 'vite';

const VENDOR_FALLBACK_FILES = [
  'fa-brands-400.woff2',
  'fa-solid-900.woff2',
  'fontawesome.min.css',
  'jspdf.umd.min.js',
  'supabase.min.js',
  'tween.umd.js',
  'xlsx.full.min.js',
];

function preserveVendorFallbacks() {
  return {
    name: 'tp3d-preserve-vendor-fallbacks',
    apply: 'build',
    async generateBundle() {
      await Promise.all(
        VENDOR_FALLBACK_FILES.map(async fileName => {
          this.emitFile({
            type: 'asset',
            fileName: `vendor/${fileName}`,
            source: await readFile(new URL(`./vendor/${fileName}`, import.meta.url)),
          });
        })
      );
    },
  };
}

export default defineConfig({
  base: './',
  server: {
    host: 'localhost',
    port: 5500,
    strictPort: true,
  },
  preview: {
    host: 'localhost',
    port: 5500,
    strictPort: true,
  },
  build: {
    target: ['chrome90', 'edge90', 'firefox103', 'safari13.1'],
    outDir: 'dist',
    emptyOutDir: true,
  },
  plugins: [preserveVendorFallbacks()],
});
