/**
 * The published package, checked after `pnpm build`:
 *
 * 1. The tarball holds the built modules, declarations and docs, and nothing else.
 * 2. Every entry imports in Node with no browser globals ("safe to import on a server"),
 *    and `@lamka02sk/proza/render` renders and sanitises there.
 * 3. Size budget: a host bundling `createEditor` (Vue and Reka UI included, minified)
 *    loads at most BUDGET bytes of gzipped JavaScript before the author does anything.
 *    Parts loaded on use (code highlighting, characters, .docx) are not counted.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { gzipSync } from 'node:zlib'
import { build } from 'vite'

const root = resolve(import.meta.dirname, '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
// Measured for 0.1.0: 206.3 kB (Vue and Reka UI included). The budget leaves room for fixes, not for a new dependency.
const BUDGET = 215_000
let failed = false
const fail = (msg) => { console.error(`✗ ${msg}`); failed = true }
const ok = (msg) => { console.log(`✓ ${msg}`) }

// 1. Tarball contents.
const [packed] = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: root, encoding: 'utf8' }))
const files = packed.files.map((f) => f.path)
const stray = files.filter((f) => !/^(dist\/lib\/|dist\/types\/|README\.md$|CHANGELOG\.md$|LICENSE$|package\.json$)/.test(f))
if (stray.length) fail(`unexpected files in the package: ${stray.slice(0, 5).join(', ')}`)
for (const target of Object.values(pkg.exports).flatMap((e) => (typeof e === 'string' ? [e] : Object.values(e)))) {
  if (!files.includes(target.replace(/^\.\//, ''))) fail(`export target missing from the package: ${target}`)
}
if (!failed) ok(`package: ${files.length} files, ${(packed.size / 1024).toFixed(0)} kB packed`)

// 2. Node, no DOM.
// Node has `navigator` since 21; the editor reads it only when called.
for (const g of ['window', 'document', 'HTMLElement', 'customElements']) if (g in globalThis) fail(`Node has a ${g} global; the check needs a plain Node`)
const entry = (name) => import(join(root, 'dist/lib', `${name}.js`))
for (const name of ['index', 'render', 'element', 'vue']) {
  try { await entry(name); ok(`import ${name === 'index' ? pkg.name : `${pkg.name}/${name}`} in Node`) } catch (e) { fail(`import ${name} in Node: ${e.message}`) }
}
const r = await entry('render')
const html = r.render({ version: 1, blocks: [{ id: 'a', type: 'core/paragraph', attrs: { content: { text: 'Hello', formats: [{ type: 'bold', start: 0, end: 5 }] } } }] }, r.coreRegistry)
if (html !== '<p><strong>Hello</strong></p>') fail(`render in Node gave ${html}`)
else ok('@lamka02sk/proza/render renders in Node')
if (r.sanitizeElement('a', { href: 'javascript:x' }).href !== undefined) fail('sanitizeElement kept a javascript: address')
const policy = JSON.parse(readFileSync(join(root, 'dist/lib/sanitizer-policy.json'), 'utf8'))
if (JSON.stringify(policy) !== JSON.stringify(r.sanitizerPolicy())) fail('sanitizer-policy.json differs from sanitizerPolicy()')
else ok('sanitizer-policy.json matches sanitizerPolicy()')

// 3. Size budget, as a host's bundler would build it.
const dir = mkdtempSync(join(tmpdir(), 'proza-size-'))
try {
  writeFileSync(join(dir, 'main.js'), `import { createEditor } from '${pkg.name}'\ncreateEditor({ target: '#app' })\n`)
  await build({
    root: dir, logLevel: 'silent', configFile: false,
    resolve: { alias: { [pkg.name]: join(root, 'dist/lib/index.js') } },
    define: { __VUE_OPTIONS_API__: 'false', __VUE_PROD_DEVTOOLS__: 'false', __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false', 'process.env.NODE_ENV': '"production"' },
    build: { outDir: join(dir, 'out'), lib: false, modulePreload: false, rolldownOptions: { input: join(dir, 'main.js') }, minify: true, emptyOutDir: true, manifest: true },
  })
  const manifest = JSON.parse(readFileSync(join(dir, 'out/.vite/manifest.json'), 'utf8'))
  const seen = new Set()
  const walk = (key) => {
    if (seen.has(key)) return
    seen.add(key)
    for (const k of manifest[key].imports ?? []) walk(k)
  }
  walk(Object.keys(manifest).find((k) => manifest[k].isEntry))
  const initial = [...seen].map((k) => manifest[k].file)
  const bytes = initial.reduce((n, f) => n + gzipSync(readFileSync(join(dir, 'out', f))).length, 0)
  const lazy = readdirSync(join(dir, 'out/assets')).filter((f) => f.endsWith('.js') && !initial.includes(`assets/${f}`))
  const line = `initial JavaScript ${(bytes / 1000).toFixed(1)} kB gzipped (budget ${(BUDGET / 1000).toFixed(0)} kB); ${lazy.length} chunks load on use`
  if (bytes > BUDGET) fail(line)
  else ok(line)
} finally {
  rmSync(dir, { recursive: true, force: true })
}

process.exit(failed ? 1 : 0)
