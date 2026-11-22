/**
 * The published package (one package with subpath exports):
 * `pnpm build` writes ES modules to dist/lib and declarations to dist/types.
 * Vue, Reka UI and mammoth stay imports, so the host's bundler shares them.
 */
import { readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { type Plugin, defineConfig } from 'vite'
import { sanitizerPolicy } from './src/render/sanitize'

const src = (f: string): string => resolve(import.meta.dirname, 'src', f)

/** Interface languages besides the built-in English, each its own entry (`@lamka02sk/proza/locales/sk`). */
const LOCALES = ['sk', 'cs', 'de', 'es', 'fr', 'hu']

/**
 * Library mode inlines every asset as a data: URL, and a font as data: needs `font-src data:`
 * in the host's CSP. The fonts are emitted as files instead, addressed from the module.
 */
function fontFiles(): Plugin {
  return {
    name: 'proza-font-files',
    enforce: 'pre',
    load(id) {
      if (!id.endsWith('.woff2?url')) return null
      const file = id.slice(0, -'?url'.length)
      const ref = this.emitFile({ type: 'asset', name: basename(file), source: readFileSync(file) })
      return `export default new URL(import.meta.ROLLUP_FILE_URL_${ref}).href`
    },
  }
}

/** Files beside the modules: the published page's stylesheet, and the sanitiser policy for servers in other languages (PHP). */
function extras(): Plugin {
  return {
    name: 'proza-package-extras',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'content.css', source: readFileSync(src('render/content.css'), 'utf8') })
      this.emitFile({ type: 'asset', fileName: 'sanitizer-policy.json', source: `${JSON.stringify(sanitizerPolicy(), null, 2)}\n` })
    },
  }
}

export default defineConfig({
  plugins: [fontFiles(), extras()],
  publicDir: false,
  // Asset addresses relative to the module that uses them: the host serves the package anywhere.
  base: './',
  define: { __VUE_OPTIONS_API__: 'false', __VUE_PROD_DEVTOOLS__: 'false', __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false' },
  build: {
    outDir: resolve(import.meta.dirname, 'dist/lib'),
    emptyOutDir: true,
    target: 'es2023',
    minify: true,
    sourcemap: true,
    // Fonts stay files: a data: URL would need `font-src data:` in the host's CSP.
    assetsInlineLimit: 0,
    lib: {
      entry: {
        index: src('index.ts'), render: src('render-entry.ts'), element: src('element.ts'), vue: src('vue.ts'),
        ...Object.fromEntries(LOCALES.map((l) => [`locales/${l}`, src(`locales/${l}.ts`)])),
      },
      formats: ['es'],
    },
    rolldownOptions: {
      external: [/^vue(\/|$)/, /^reka-ui(\/|$)/, /^mammoth(\/|$)/, /^@vue\//],
      output: { chunkFileNames: 'chunks/[name]-[hash].js', assetFileNames: 'assets/[name]-[hash][extname]' },
    },
  },
})
