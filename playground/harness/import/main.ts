/**
 * The import pipeline in a real DOM, for Playwright in each engine
 * (tests/e2e/import.spec.ts): fixture runs and property checks. Node has no
 * DOMParser, so these cannot run in Vitest.
 */
import fc from 'fast-check'
import { coreBlocks } from '../../../src/blocks/index'
import { docxToHtml } from '../../../src/import/docx'
import { type ImportOptions, importHtml, importText } from '../../../src/import/pipeline'
import type { ImportSource } from '../../../src/import/report'
import { DOC_VERSION, serializeDoc, validateDoc } from '../../../src/model/schema'
import type { Block } from '../../../src/model/tree'
import { renderBlocks } from '../../../src/render/render'
import { arbBlocks, arbHtml, uniqueAnchors } from './arbitraries'

const registry = new Map(coreBlocks.map((b) => [b.name, b]))
const PALETTE = [
  { name: 'grey', color: '#4B4C56' },
  { name: 'orange', color: '#B93E0C' },
  { name: 'blue', color: '#1D4ED8' },
]

/** Stored JSON without ids: what two imports must agree on. */
function shape(blocks: readonly Block[]): unknown {
  const strip = (list: readonly unknown[]): unknown[] => list.map((b) => {
    const { children, ...rest } = b as { id?: string; children?: unknown[] }
    delete rest.id
    return children ? { ...rest, children: strip(children) } : rest
  })
  return strip(serializeDoc({ version: DOC_VERSION, blocks }, registry).blocks)
}

function counter(): () => string {
  let n = 0
  return () => `b${++n}`
}

export interface FixtureOptions {
  readonly source?: ImportSource
  readonly rtf?: string
  readonly text?: boolean
  readonly notes?: ImportOptions['notes']
}

function run(input: string, options: FixtureOptions = {}) {
  const opts: ImportOptions = {
    palette: PALETTE, createId: counter(),
    ...(options.source ? { source: options.source } : {}), ...(options.rtf ? { rtf: options.rtf } : {}), ...(options.notes ? { notes: options.notes } : {}),
  }
  const result = options.text ? importText(input, registry, opts) : importHtml(input, registry, opts)
  return {
    blocks: shape(result.blocks),
    report: result.report,
    pending: result.pending.map((p) => ({ name: p.name, file: p.file ? { name: p.file.name, type: p.file.type, size: p.file.size } : null })),
    html: renderBlocks(result.blocks, registry),
  }
}

function check<T>(name: string, prop: fc.IProperty<[T]>, runs: number): string | null {
  const r = fc.check(prop, { numRuns: runs })
  const error = r.errorInstance instanceof Error ? `\n${r.errorInstance.message}` : ''
  return r.failed ? `${name}: ${fc.defaultReportMessage(r) ?? 'failed'}${error}` : null
}

const importHarness = {
  run,
  /** A `.docx` (base64) through mammoth.js, then the pipeline. */
  async docx(base64: string) {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
    const { html, notes } = await docxToHtml(new Blob([bytes]))
    return run(html, { source: 'docx', notes })
  },
  /** A stored document as `run` returns blocks: validated, without ids. */
  shape: (stored: unknown) => shape(validateDoc(stored, registry).doc.blocks),
  /** Each property returns null or a failure message. */
  properties(runs = 200): string[] {
    const failures = [
      check('any HTML imports without throwing into a valid document', fc.property(arbHtml, (html) => {
        for (const source of [undefined, 'word-desktop', 'google-docs', 'tinymce', 'proza'] as const) {
          const r = importHtml(html, registry, { palette: PALETTE, ...(source ? { source } : {}) })
          const stored = serializeDoc({ version: DOC_VERSION, blocks: r.blocks }, registry)
          const again = validateDoc(stored, registry)
          if (again.issues.length > 0) throw new Error(`${source ?? 'detected'}: ${JSON.stringify(again.issues.slice(0, 3))}`)
          renderBlocks(r.blocks, registry)
        }
        return true
      }), runs),
      check('import(render(doc)) equals doc', fc.property(arbBlocks, (gen) => {
        const doc = validateDoc({ version: DOC_VERSION, blocks: uniqueAnchors(gen).map((b, i) => withIds(b, `g${i}`)) }, registry).doc
        const html = renderBlocks(doc.blocks, registry)
        const back = importHtml(html, registry, { source: 'proza' })
        const a = JSON.stringify(shape(doc.blocks)), b = JSON.stringify(shape(back.blocks))
        if (a !== b) throw new Error(`\n${html}\nwant ${a}\ngot  ${b}`)
        return true
      }), runs),
      check('render(import(html)) is a fixed point', fc.property(arbHtml, (html) => {
        const once = renderBlocks(importHtml(html, registry, { palette: PALETTE }).blocks, registry)
        const twice = renderBlocks(importHtml(once, registry, { source: 'proza' }).blocks, registry)
        if (once !== twice) throw new Error(`\n${html}\nonce  ${once}\ntwice ${twice}`)
        return true
      }), runs),
    ]
    return failures.filter((f): f is string => f !== null)
  },
}

function withIds(b: { type: string; attrs: Record<string, unknown>; children?: unknown[] }, id: string): unknown {
  return { id, type: b.type, attrs: b.attrs, ...(b.children ? { children: (b.children as typeof b[]).map((c, i) => withIds(c, `${id}-${i}`)) } : {}) }
}

declare global { interface Window { __import?: typeof importHarness } }
window.__import = importHarness
