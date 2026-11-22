/**
 * Stored JSON is untrusted: a server renders what any
 * client saved. Small documents must not cost large time or memory, and no
 * document may make validation or rendering throw.
 */
import { describe, expect, it } from 'vitest'
import { coreRegistry } from '../../src/blocks/core'
import { render } from '../../src/render/render'
import { fileType } from '../../src/blocks/media'
import { detectSource } from '../../src/import/detect'
import { textToBlocks } from '../../src/import/plain-text'
import { OBJECT_CHAR } from '../../src/model/richtext'
import { validateDoc } from '../../src/model/schema'

const rich = (text: string, formats: unknown[] = []) => ({ text, formats })
const timed = (fn: () => unknown): number => { const t = performance.now(); fn(); return performance.now() - t }

describe('untrusted documents stay cheap', () => {
  it('a table whose cells claim huge spans', () => {
    const n = 400
    const cell = { type: 'core/table-cell', attrs: { colspan: 1000, rowspan: 65534 }, children: [] }
    const rows = [{ type: 'core/table-row', attrs: {}, children: Array.from({ length: n }, () => cell) },
      ...Array.from({ length: n - 1 }, () => ({ type: 'core/table-row', attrs: {}, children: [] }))]
    const doc = { version: 1, blocks: [{ type: 'core/table', attrs: {}, children: rows }] }
    expect(timed(() => render(doc, coreRegistry))).toBeLessThan(1000)
  })

  it('a table with more rows than allowed keeps them as placeholders', () => {
    const row = { type: 'core/table-row', attrs: {}, children: [{ type: 'core/table-cell', attrs: {}, children: [] }] }
    const { doc, issues } = validateDoc({ version: 1, blocks: [{ type: 'core/table', attrs: {}, children: Array.from({ length: 2001 }, () => row) }] }, coreRegistry)
    expect(doc.blocks[0]!.children).toHaveLength(2001)
    expect(doc.blocks[0]!.children![2000]!.type).toBe('core/unsupported')
    expect(issues.some((i) => i.message.startsWith('More than 2000 parts'))).toBe(true)
  })

  it('an embed with a long address', () => {
    const doc = { version: 1, blocks: [{ type: 'core/embed', attrs: { url: `http://${'a'.repeat(40_000)} b` } }] }
    expect(timed(() => render(doc, coreRegistry))).toBeLessThan(100)
  })

  it('nesting deeper than any layout', () => {
    let block: unknown = { type: 'core/paragraph', attrs: { content: rich('deep') } }
    for (let i = 0; i < 5000; i++) block = { type: 'core/group', attrs: {}, children: [block] }
    const doc = { version: 1, blocks: [block] }
    expect(() => render(doc, coreRegistry)).not.toThrow()
    const { issues } = validateDoc(doc, coreRegistry)
    expect(issues.some((i) => i.message.startsWith('Nested more than'))).toBe(true)
  })

  it('a paragraph with very many overlapping formats', () => {
    const text = 'x'.repeat(200_000)
    const formats = Array.from({ length: 20_000 }, (_, i) => ({ type: i % 2 ? 'bold' : 'link', start: 0, end: text.length, attrs: i % 2 ? undefined : { href: `/p${i}` } }))
    const doc = { version: 1, blocks: [{ type: 'core/paragraph', attrs: { content: rich(text, formats) } }] }
    expect(timed(() => validateDoc(doc, coreRegistry))).toBeLessThan(1000)
  })

  it('unknown format types: short names, few attributes, at most 16 types in a value', () => {
    const text = 'x'.repeat(4000)
    const nested = Array.from({ length: 3000 }, (_, i) => ({ type: `x${i}`, start: i, end: 4000 - i }))
    const long = { type: `x${'a'.repeat(200)}`, start: 0, end: 1 }
    const wide = { type: 'wide', start: 0, end: 1, attrs: Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`a${i}`, 'v'])) }
    const doc = { version: 1, blocks: [{ type: 'core/paragraph', attrs: { content: rich(text, [...nested, long, wide]) } }] }
    const { doc: valid, issues } = validateDoc(doc, coreRegistry)
    const content = valid.blocks[0]!.attrs.content as { formats: { type: string }[] }
    expect(new Set(content.formats.map((f) => f.type)).size).toBe(16)
    expect(issues.some((i) => i.message.startsWith('More than 16 unknown format types'))).toBe(true)
    expect(issues.some((i) => i.message.startsWith('Unknown format wide'))).toBe(true)
    expect(() => render(doc, coreRegistry)).not.toThrow()
  })

  it('object characters without objects, many of them', () => {
    const text = `a${OBJECT_CHAR}`.repeat(80_000)
    const doc = { version: 1, blocks: [{ type: 'core/paragraph', attrs: { content: rich(text, [{ type: 'bold', start: 0, end: text.length }]) } }] }
    expect(timed(() => validateDoc(doc, coreRegistry))).toBeLessThan(1000)
  })

  it('an abbreviation title is not copied onto thousands of pieces', () => {
    const text = 'x'.repeat(20_000)
    const bold = Array.from({ length: 9_999 }, (_, i) => ({ type: 'bold', start: i * 2, end: i * 2 + 1 }))
    const doc = { version: 1, blocks: [{ type: 'core/paragraph', attrs: { content: rich(text, [{ type: 'abbr', start: 0, end: text.length, attrs: { title: 't'.repeat(10_000) } }, ...bold]) } }] }
    const { issues } = validateDoc(doc, coreRegistry)
    expect(issues.some((i) => i.message.startsWith('Format abbr without'))).toBe(true)
    expect(render(doc, coreRegistry).length).toBeLessThan(1_000_000)
  })

  it('many headings with one text get anchors without counting up each time', () => {
    const heading = { type: 'core/heading', attrs: { level: 2, content: rich('a') } }
    const doc = { version: 1, blocks: [{ type: 'core/toc', attrs: {} }, ...Array.from({ length: 8000 }, () => heading)] }
    expect(timed(() => render(doc, coreRegistry))).toBeLessThan(1000)
    expect(render({ version: 1, blocks: [{ type: 'core/toc', attrs: {} }, heading, heading, heading] }, coreRegistry)).toContain('id="a-3"')
  })

  it('a file address with many dots and no extension', () => {
    const started = performance.now()
    for (let i = 0; i < 200; i++) fileType(`${'.a?'.repeat(2700)}\nb`)
    expect(performance.now() - started).toBeLessThan(200)
    expect(fileType('https://x.example/report.pdf?v=2#p')).toBe('PDF')
  })

  it('source detection over markup made to backtrack', () => {
    for (const html of ['<meta'.repeat(40_000), 'class='.repeat(40_000), 'mso-'.repeat(40_000), 'data-mce-'.repeat(30_000), '&lt;div class=&quot;row&quot;&gt;'.repeat(8_000)]) {
      expect(timed(() => detectSource(html))).toBeLessThan(200)
    }
    expect(detectSource('<meta name="Generator" content="Microsoft Word 15">')).toBe('word-desktop')
    expect(detectSource('<p class="MsoNormal" style="mso-margin-top-alt:auto">x</p>')).toBe('word-desktop')
    expect(detectSource('<span class="TextRun SCXW1">x</span>')).toBe('word-web')
  })

  it('plain text: deep lists stop nesting, long space runs are cheap', () => {
    const deep = Array.from({ length: 3000 }, (_, i) => `${' '.repeat(i)}- x`).join('\n')
    let depth = 0
    const measure = (blocks: readonly { children?: readonly unknown[] }[], d: number): void => {
      depth = Math.max(depth, d)
      for (const b of blocks) if (b.children) measure(b.children as { children?: readonly unknown[] }[], d + 1)
    }
    measure(textToBlocks(deep), 1)
    expect(depth).toBeLessThanOrEqual(81)
    expect(timed(() => textToBlocks(`a\n\nb${' '.repeat(40_000)}c`))).toBeLessThan(100)
  })
})
