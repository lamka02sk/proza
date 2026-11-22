/**
 * The checker: each rule of the core types and the
 * generic ones, and the repairs. A repair applies to the tree it came from,
 * removes its own finding and leaves a document that still validates.
 */
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { type Finding, check, genericRules } from '../a11y-check'
import { applyOperations } from '../model/operations'
import type { RichTextValue } from '../model/richtext'
import { validateDoc } from '../model/schema'
import { type Tree, blocksFromTree, treeFromBlocks } from '../model/tree'
import { checksFor } from './checks'
import { coreRegistry } from './core'

const rich = (text: string, formats: RichTextValue['formats'] = []): RichTextValue => ({ text, formats })
type Raw = { id: string; type: string; attrs?: Record<string, unknown>; children?: Raw[] }
let n = 0
const b = (type: string, attrs: Record<string, unknown> = {}, children?: Raw[]): Raw => ({ id: `b${String(++n)}`, type, attrs, ...(children ? { children } : {}) })
const p = (text: string, formats: RichTextValue['formats'] = [], attrs: Record<string, unknown> = {}): Raw => b('core/paragraph', { content: rich(text, formats), ...attrs })
const h = (level: number, text: string): Raw => b('core/heading', { level, content: rich(text) })
const cell = (text: string, header = false, kids?: Raw[]): Raw => b('core/table-cell', { header }, kids ?? [p(text)])
const table = (rows: Raw[][], caption = ''): Raw => b('core/table', { caption: rich(caption) }, rows.map((r) => b('core/table-row', {}, r)))

function treeOf(blocks: Raw[]): Tree {
  const { doc } = validateDoc({ version: 1, blocks }, coreRegistry)
  return treeFromBlocks(doc.blocks)
}
const run = (tree: Tree, options: { lang?: string; colors?: ReadonlySet<string>; current?: string } = {}): Finding[] =>
  check({ tree, schemas: coreRegistry, blockRules: checksFor, documentRules: genericRules, lang: options.lang ?? 'en', colors: options.colors ?? null, current: options.current ?? null })
const rules = (blocks: Raw[], options?: Parameters<typeof run>[1]): string[] => run(treeOf(blocks), options).map((f) => f.rule)

describe('images and media', () => {
  it('a picture needs a description, unless it is decorative; a file name is not one', () => {
    expect(rules([b('core/image', { src: 'https://x.test/a.jpg' })])).toEqual(['alt-missing'])
    expect(rules([b('core/image', { src: 'https://x.test/a.jpg', decorative: true })])).toEqual([])
    expect(rules([b('core/image', { src: 'https://x.test/IMG_2041.jpg', alt: 'IMG_2041' })])).toEqual(['alt-filename'])
    expect(rules([b('core/image', { src: 'https://x.test/a.jpg', alt: 'DSC0042.JPG' })])).toEqual(['alt-filename'])
    expect(rules([b('core/image', { src: 'https://x.test/a.jpg', alt: 'A red bicycle by a wall' })])).toEqual([])
    // Waiting for its file: nothing to describe yet.
    expect(rules([b('core/image')])).toEqual([])
    // Decorative and linked: the link has no name.
    expect(rules([b('core/image', { src: 'https://x.test/a.jpg', decorative: true, href: 'https://x.test' })])).toEqual(['link-empty'])
  })

  it('video needs captions, audio a transcript, an online video a title', () => {
    expect(rules([b('core/video', { src: 'https://x.test/v.mp4' })])).toEqual(['captions-missing'])
    expect(rules([b('core/video', { src: 'https://x.test/v.mp4', captions: 'https://x.test/v.vtt' })])).toEqual([])
    expect(rules([b('core/audio', { src: 'https://x.test/a.mp3' })])).toEqual(['transcript-missing'])
    expect(rules([b('core/audio', { src: 'https://x.test/a.mp3', transcript: rich('Hello.') })])).toEqual([])
    expect(rules([b('core/embed', { url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' })])).toEqual(['embed-title'])
  })

  it('inline pictures with a file name as description', () => {
    expect(rules([p('a￼', [{ type: 'image', start: 1, end: 2, attrs: { src: 'https://x.test/p.png', alt: 'p.png' } }])])).toEqual(['alt-filename'])
  })
})

describe('structure', () => {
  it('headings: skipped levels from the page title down, empty ones; the one being written is left alone', () => {
    expect(rules([h(2, 'A'), h(3, 'B'), h(2, 'C')])).toEqual([])
    expect(rules([h(3, 'A')])).toEqual(['heading-skip'])
    expect(rules([h(2, 'A'), h(4, 'B')])).toEqual(['heading-skip'])
    const empty = h(2, ' ')
    expect(rules([empty, p('x')])).toEqual(['heading-empty'])
    expect(rules([empty, p('x')], { current: empty.id })).toEqual([])
  })

  it('lines written as a list: one finding for the run, bullets and numbers apart', () => {
    expect(rules([p('- one'), p('- two'), p('- three')])).toEqual(['fake-list'])
    expect(rules([p('1. one'), p('2) two'), p('• three')])).toEqual(['fake-list'])
    expect(rules([p('- only one'), p('text')])).toEqual([])
    expect(rules([p('e.g. this is a sentence'), p('a nice day')])).toEqual([])
  })

  it('empty lines between parts, not the last line or the one being written', () => {
    const e = p('')
    expect(rules([p('a'), e, p('b'), p('')])).toEqual(['empty'])
    expect(rules([p('a'), e, p('b')], { current: e.id })).toEqual([])
  })

  it('anchors used twice', () => {
    expect(rules([p('a', [], { anchor: 'x' }), p('b', [], { anchor: 'x' }), p('c', [], { anchor: 'x-2' })])).toEqual(['anchor-duplicate'])
  })
})

describe('tables', () => {
  it('a data table needs header cells and a caption; a layout table is named as one', () => {
    expect(rules([table([[cell('a'), cell('b')], [cell('1'), cell('2')]])])).toEqual(['table-headers', 'table-caption'])
    expect(rules([table([[cell('a', true), cell('b', true)], [cell('1'), cell('2')]], 'Prices')])).toEqual([])
    expect(rules([table([[cell('a'), cell('b')]])])).toEqual(['table-layout'])
    const pic = (): Raw[] => [b('core/image', { src: 'https://x.test/a.jpg', alt: 'A dog' })]
    expect(rules([table([[cell('', false, pic()), cell('', false, pic())], [cell('x'), cell('y')]])])).toEqual(['table-layout'])
  })
})

describe('links and text', () => {
  const link = (start: number, end: number, attrs: Record<string, string> = { href: 'https://x.test' }) => ({ type: 'link', start, end, attrs })
  it('empty, vague, an address as text, a new window not said', () => {
    expect(rules([p('see  now', [link(4, 5)])])).toEqual(['link-empty'])
    expect(rules([p('Read more.', [link(0, 9)])])).toEqual(['link-vague'])
    expect(rules([p('Kliknite sem', [link(0, 12)])])).toEqual(['link-vague'])
    for (const t of ['Klikněte zde', 'Leer más', 'En savoir plus', 'Plus d’informations…', 'Kattintson ide']) expect(rules([p(t, [link(0, t.length)])])).toEqual(['link-vague'])
    expect(rules([p('https://x.test/a', [link(0, 16)])])).toEqual(['link-url'])
    expect(rules([p('The prices', [link(0, 10, { href: 'https://x.test', target: '_blank' })])])).toEqual(['link-new-window'])
    expect(rules([p('The prices (opens in a new window)', [link(0, 34, { href: 'https://x.test', target: '_blank' })])])).toEqual([])
    for (const t of ['Ceny (otevře se v novém okně)', 'Precios (se abre en una nueva pestaña)', 'Les prix (nouvelle fenêtre)', 'Az árak (új ablakban)']) {
      expect(rules([p(t, [link(0, t.length, { href: 'https://x.test', target: '_blank' })])])).toEqual([])
    }
    const buttons = (attrs: Record<string, unknown>): Raw => b('core/buttons', {}, [b('core/button', { href: 'https://x.test', ...attrs })])
    expect(rules([buttons({ text: rich('Click here'), newWindow: true })])).toEqual(['link-vague', 'link-new-window'])
  })

  it('underline that is not a link, capitals, justified text, colours not readable', () => {
    expect(rules([p('some words', [{ type: 'underline', start: 0, end: 4 }])])).toEqual(['underline'])
    expect(rules([p('some words', [link(0, 4), { type: 'underline', start: 0, end: 4 }])])).toEqual([])
    expect(rules([p('PLEASE READ THESE INSTRUCTIONS CAREFULLY now')])).toEqual(['caps'])
    expect(rules([p('The EU and NATO met in the USA')])).toEqual([])
    expect(rules([p('x', [], { textAlign: 'justify' })])).toEqual(['justified'])
    const colors = new Set(['grey'])
    expect(rules([p('x', [{ type: 'color', start: 0, end: 1, attrs: { color: 'yellow' } }], { color: 'grey' })], { colors })).toEqual(['contrast'])
    expect(rules([p('x', [], { color: 'yellow' })], { colors })).toEqual(['contrast'])
    // Without the palette the rule says nothing.
    expect(rules([p('x', [], { color: 'yellow' })])).toEqual([])
  })

  it('a passage in another script without its language; marked passages and names pass', () => {
    expect(rules([p('He said Привет мир to them.')])).toEqual(['language'])
    expect(rules([p('He said Привет мир to them.', [{ type: 'lang', start: 8, end: 18, attrs: { lang: 'ru' } }])])).toEqual([])
    expect(rules([p('Привет мир', [], { lang: 'ru' })])).toEqual([])
    expect(rules([p('Это iPhone и Android', [], { lang: 'ru' })])).toEqual([])
    expect(rules([p('Сказал he did it well', [], { lang: 'ru' })])).toEqual(['language'])
    expect(rules([p('東京 is big')], { lang: 'sk' })).toEqual(['language'])
  })
})

describe('findings', () => {
  it('come in reading order, by position within a part', () => {
    const tree = treeOf([p('Click here and here', [{ type: 'link', start: 15, end: 19, attrs: { href: '/a' } }, { type: 'link', start: 0, end: 10, attrs: { href: '/b' } }]), h(4, 'x')])
    expect(run(tree).map((f) => [f.rule, f.start ?? null])).toEqual([['link-vague', 0], ['link-vague', 15], ['heading-skip', null]])
  })
})

// Every problem a repair exists for, in random documents.
const fixable = (): Raw[] => [
  h(2, ''), p(''), p('- a'), p('- b'), p('x', [{ type: 'underline', start: 0, end: 1 }]),
  p('y', [{ type: 'link', start: 0, end: 1, attrs: { href: '/z', target: '_blank' } }]),
  p('', [], {}), p('w', [], { textAlign: 'justify' }), p('v', [], { anchor: 'dup' }), p('u', [], { anchor: 'dup' }),
  h(5, 'deep'), table([[cell('a'), cell('b')], [cell('1'), cell('2')]]), p('c', [], { color: 'pink' }),
  p('s ￼', [{ type: 'link', start: 2, end: 3, attrs: { href: '/q' } }, { type: 'image', start: 2, end: 3, attrs: { src: '/i.png', alt: 'x' } }]),
  p('t  t', [{ type: 'link', start: 1, end: 3, attrs: { href: '/e' } }]),
]

describe('repairs', () => {
  it('apply to their tree, remove their finding, and leave a valid document', () => {
    fc.assert(fc.property(fc.array(fc.integer({ min: 0, max: 14 }), { minLength: 1, maxLength: 12 }), fc.boolean(), (picks, nested) => {
      const blocks = picks.map((i) => fixable()[i]!)
      const doc = nested ? [b('core/group', {}, [...blocks, p('end')])] : [...blocks, p('end')]
      const tree = treeOf(doc)
      const colors = new Set(['grey'])
      for (const f of run(tree, { colors }).filter((x) => x.fix)) {
        const after = applyOperations(tree, f.fix!()).tree
        const again = run(after, { colors }).filter((x) => x.rule === f.rule && x.blockId === f.blockId && x.start === f.start)
        expect(again).toEqual([])
        const { issues } = validateDoc({ version: 1, blocks: blocksFromTree(after) }, coreRegistry)
        expect(issues).toEqual([])
      }
    }), { numRuns: 60 })
  })
})
