import { resolve } from 'node:path'
import { readdirSync, statSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'

const root = resolve(import.meta.dirname, 'playground')

// Every index.html under playground/ is a page.
function pages(dir: string, out: Record<string, string> = {}): Record<string, string> {
  for (const name of readdirSync(dir)) {
    const path = resolve(dir, name)
    if (statSync(path).isDirectory()) pages(path, out)
    else if (name === 'index.html') out[path.slice(root.length + 1) || 'index'] = path
  }
  return out
}

const MAX_UPLOAD = 20 * 1024 * 1024
const MAX_STORED = 200 * 1024 * 1024

/**
 * A stand-in for a host's upload endpoint, for the playground and the end-to-end
 * tests: POST /__upload stores the body in memory, GET /__upload/<id> serves it.
 * Uploaded bytes come back on the playground's origin, so they are served inert:
 * never sniffed, sandboxed, and downloaded unless they are media.
 */
function uploads(): Plugin {
  const files = new Map<string, { type: string; body: Buffer }>()
  let stored = 0
  return {
    name: 'proza-playground-uploads',
    configureServer(server) {
      server.middlewares.use('/__upload', (req, res) => {
        if (req.method === 'POST') {
          const chunks: Buffer[] = []
          let size = 0
          let refused = false
          req.on('data', (c: Buffer) => {
            if (refused) return
            size += c.length
            if (size > MAX_UPLOAD || stored + size > MAX_STORED) { refused = true; res.statusCode = 413; res.end(); req.destroy(); return }
            chunks.push(c)
          })
          req.on('end', () => {
            if (refused) return
            const id = randomUUID()
            stored += size
            files.set(id, { type: req.headers['content-type'] ?? 'application/octet-stream', body: Buffer.concat(chunks) })
            res.setHeader('content-type', 'application/json')
            res.end(JSON.stringify({ url: `/__upload/${id}` }))
          })
          return
        }
        const file = files.get((req.url ?? '').replace(/^\//, '').split('?')[0]!)
        if (!file) { res.statusCode = 404; res.end(); return }
        res.setHeader('content-type', file.type)
        res.setHeader('x-content-type-options', 'nosniff')
        res.setHeader('content-security-policy', 'sandbox')
        if (!/^(image|video|audio)\//.test(file.type)) res.setHeader('content-disposition', 'attachment')
        res.end(file.body)
      })
    },
  }
}

export default defineConfig({
  root,
  plugins: [uploads()],
  publicDir: resolve(import.meta.dirname, 'brand'),
  server: { port: 5199, strictPort: true },
  // Vue's compile-time flags: no Options API (components use setup), no devtools or hydration details in builds.
  define: { __VUE_OPTIONS_API__: 'false', __VUE_PROD_DEVTOOLS__: 'false', __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false' },
  build: {
    outDir: resolve(import.meta.dirname, 'dist/playground'),
    emptyOutDir: true,
    rolldownOptions: { input: pages(root) },
  },
  test: {
    root: import.meta.dirname,
    include: ['src/**/*.test.ts', 'tests/unit/**/*.test.ts'],
    environment: 'node',
  },
})
