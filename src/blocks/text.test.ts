import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { coreRegistry as textRegistry } from './core'
import { serializeDoc, validateDoc } from '../model/schema'
import type { Block } from '../model/tree'
import { RenderError } from '../render/html'
import { render, renderBlocks } from '../render/render'
import { OBJECT_CHAR, normalize, type RichTextValue } from '../model/richtext'

const dir = join(import.meta.dirname, '../../tests/fixtures/documents')

/**
 * Stored documents with their expected HTML. A fixture never changes once
 * committed: when a block's attributes change version, the old file keeps
 * proving that its migration still produces the same output.
 */
describe('stored documents', () => {
  const names = readdirSync(dir).filter((f) => f.endsWith('.json'))
  it.each(names)('%s loads without issues and renders its .html', (name) => {
    const stored: unknown = JSON.parse(readFileSync(join(dir, name), 'utf8'))
    const { doc, issues } = validateDoc(stored, textRegistry)
    expect(issues).toEqual([])
    expect(render(stored, textRegistry) + '\n').toBe(readFileSync(join(dir, name.replace(/\.json$/, '.html')), 'utf8'))
    expect(validateDoc(serializeDoc(doc, textRegistry), textRegistry).doc).toEqual(doc)
  })
})

const doc = (...blocks: unknown[]) => ({ version: 1, blocks })
const text = (t: string) => ({ text: t, formats: [] })
const html = (...blocks: unknown[]) => render(doc(...blocks), textRegistry)

describe('text blocks', () => {
  it('render every heading level, defaulting to 2', () => {
    for (const level of [1, 2, 3, 4, 5, 6]) {
      expect(html({ id: 'a', type: 'core/heading', attrs: { level, content: text('x') } })).toBe(`<h${level}>x</h${level}>`)
    }
    expect(html({ id: 'a', type: 'core/heading', attrs: { level: 9, content: text('x') } })).toBe('<h2>x</h2>')
  })

  it('render numbering styles through the type attribute, never inline CSS', () => {
    for (const numbering of ['a', 'A', 'i', 'I']) {
      expect(html({ id: 'l', type: 'core/list', attrs: { style: 'number', numbering }, children: [] })).toBe(`<ol type="${numbering}"></ol>`)
    }
    expect(html({ id: 'l', type: 'core/list', attrs: { style: 'bullet', numbering: 'a', start: 4 }, children: [] })).toBe('<ul></ul>')
  })

  it('render checkboxes only inside a checklist', () => {
    const items = [{ id: 'i', type: 'core/list-item', attrs: { content: text('x'), checked: true }, children: [] }]
    expect(html({ id: 'l', type: 'core/list', attrs: { style: 'bullet' }, children: items })).toBe('<ul><li>x</li></ul>')
  })

  it('keep list items inside lists', () => {
    const { doc: d } = validateDoc(doc({ id: 'i', type: 'core/list-item', attrs: { content: text('x') } }), textRegistry)
    expect(d.blocks[0]!.type).toBe('core/unsupported')
    expect(renderBlocks(d.blocks, textRegistry)).toBe('')
  })

  it('strip formats from code, which renders plain', () => {
    expect(html({ id: 'c', type: 'core/code', attrs: { content: { text: 'ab', formats: [{ type: 'bold', start: 0, end: 1 }] } } }))
      .toBe('<pre class="pz-code"><code>ab</code></pre>')
  })

  it('escape hostile content and drop unsafe links from stored JSON', () => {
    const out = html(
      { id: 'a', type: 'core/paragraph', attrs: { content: { text: '<img src=x onerror=alert(1)>', formats: [{ type: 'link', start: 0, end: 4, attrs: { href: 'javascript:alert(1)' } }] } } },
      { id: 'b', type: 'core/code', attrs: { language: '"><script>', content: text('</code></pre><script>x</script>') } },
      { id: 'c', type: 'core/paragraph', attrs: { anchor: '" onclick="x', content: text('y') } },
    )
    expect(out).toBe([
      '<p>&lt;img src=x onerror=alert(1)&gt;</p>',
      '<pre class="pz-code"><code>&lt;/code&gt;&lt;/pre&gt;&lt;script&gt;x&lt;/script&gt;</code></pre>',
      '<p>y</p>',
    ].join('\n'))
  })

  it('render nothing for a placeholder, and refuse a type without a renderer', () => {
    expect(html({ id: 'a', type: 'x/unknown', attrs: {} }, { id: 'b', type: 'core/separator', attrs: {} })).toBe('<hr>')
    const block: Block = { id: 'a', type: 'x/unknown', attrs: {} }
    expect(() => renderBlocks([block], textRegistry)).toThrow(RenderError)
  })

  it('render the same bytes every time', () => {
    const stored = readFileSync(join(dir, 'text-blocks.json'), 'utf8')
    expect(render(JSON.parse(stored), textRegistry)).toBe(render(JSON.parse(stored), textRegistry))
  })
})

describe('footnotes', () => {
  it('numbers footnotes through the document and lists them at the end', () => {
    const note = (n: string, at: number) => ({ type: 'footnote', start: at, end: at + 1, attrs: { note: n } })
    const para = (id: string, text: string, formats: RichTextValue['formats']) => ({ id, type: 'core/paragraph', attrs: { content: normalize({ text, formats }), anchor: '', textAlign: '', lang: '', dir: '' } })
    const html = renderBlocks([para('a', `x${OBJECT_CHAR}`, [note('First <1>', 1)]), para('b', `${OBJECT_CHAR}y`, [note('Second', 0)])], textRegistry, { idPrefix: 'doc' })
    expect(html).toBe([
      '<p>x<sup class="pz-fn" id="doc-fnref-1"><a href="#doc-fn-1" role="doc-noteref">1</a></sup></p>',
      '<p><sup class="pz-fn" id="doc-fnref-2"><a href="#doc-fn-2" role="doc-noteref">2</a></sup>y</p>',
      '<section class="pz-footnotes" role="doc-endnotes" aria-label="Footnotes"><ol>'
        + '<li id="doc-fn-1">First &lt;1&gt; <a href="#doc-fnref-1" role="doc-backlink" aria-label="Back to reference 1">↩</a></li>'
        + '<li id="doc-fn-2">Second <a href="#doc-fnref-2" role="doc-backlink" aria-label="Back to reference 2">↩</a></li></ol></section>',
    ].join('\n'))
    expect(renderBlocks([para('a', 'plain', [])], textRegistry)).toBe('<p>plain</p>')
  })
})
