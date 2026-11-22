import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { coreSchemas } from '../../src/blocks/core'
import { createValue } from '../../src/model/richtext'
import { DOC_VERSION, blockRegistry, validateDoc } from '../../src/model/schema'
import { type RawBlock, applySizes, bodySize, fitTree } from '../../src/import/raw'
import { Reporter } from '../../src/import/report'

const schemas = blockRegistry(coreSchemas)
const text = (t: string) => ({ content: createValue(t) })
const p = (t: string): RawBlock => ({ type: 'core/paragraph', attrs: text(t) })
const li = (t: string, children: RawBlock[] = []): RawBlock => ({ type: 'core/list-item', attrs: text(t), children })
const img: RawBlock = { type: 'core/image', attrs: { src: '/a.png' } }

function withIds(list: readonly RawBlock[], n = { i: 0 }): unknown[] {
  return list.map((b) => ({ id: `b${++n.i}`, type: b.type, attrs: b.attrs, ...(b.children ? { children: withIds(b.children, n) } : {}) }))
}

describe('fitting to the schema', () => {
  it('a paragraph in a list becomes an item; stray items get a list', () => {
    const out = fitTree([{ type: 'core/list', attrs: { style: 'bullet' }, children: [p('a')] }, li('b')], schemas, new Reporter())
    expect(out.map((b) => [b.type, b.children?.map((c) => c.type)])).toEqual([['core/list', ['core/list-item']], ['core/list', ['core/list-item']]])
  })
  it('a picture in a numbered list splits it, and the numbering goes on', () => {
    const report = new Reporter()
    const out = fitTree([{ type: 'core/list', attrs: { style: 'number', start: 1 }, children: [li('a', [img]), li('b')] }], schemas, report)
    expect(out.map((b) => [b.type, b.attrs.start, b.children?.length])).toEqual([['core/list', 1, 1], ['core/image', undefined, undefined], ['core/list', 2, 1]])
    expect(report.report('html').entries.map((e) => e.code)).toEqual(['moved'])
  })
  it('whatever the tree, the result validates without repairs to nesting', () => {
    const types = ['core/paragraph', 'core/list', 'core/list-item', 'core/quote', 'core/image', 'core/gallery'] as const
    const { tree } = fc.letrec<{ tree: RawBlock }>((tie) => ({
      tree: fc.record({ type: fc.constantFrom(...types), kids: fc.oneof({ depthSize: 'small' }, fc.constant([]), fc.array(tie('tree'), { maxLength: 3 })) })
        .map(({ type, kids }): RawBlock => ({ type, attrs: type === 'core/image' ? { src: '/a.png' } : text('x'), children: kids })),
    }))
    fc.assert(fc.property(fc.array(tree, { maxLength: 4 }), (list) => {
      const out = fitTree(list, schemas, new Reporter())
      const { issues } = validateDoc({ version: DOC_VERSION, blocks: withIds(out) }, schemas)
      return issues.every((i) => !/unsupported/.test(i.message))
    }))
  })
})

describe('size presets', () => {
  it('the body size is what most text has, headings aside', () => {
    expect(bodySize([{ ...p('a'), fontPx: 14.67, chars: 100 }, { type: 'core/heading', attrs: text('t'), fontPx: 26, chars: 500 }])).toBe(14.5)
  })
  it('a uniformly large paragraph gets the large preset', () => {
    const out = applySizes([{ ...p('body'), chars: 200 }, { ...p('big'), fontPx: 24, chars: 10 }], schemas, new Reporter())
    expect(out.map((b) => b.attrs.size)).toEqual([undefined, 'l'])
  })
})

describe('the report', () => {
  it('groups by code, counts, samples distinct details, lost first', () => {
    const r = new Reporter()
    r.add('font', 'Arial'); r.add('font', 'Arial'); r.add('font', 'Calibri'); r.add('link', 'javascript:x'); r.add('list')
    expect(r.report('word-desktop').entries).toEqual([
      { code: 'link', severity: 'lost', count: 1, samples: ['javascript:x'] },
      { code: 'font', severity: 'changed', count: 3, samples: ['Arial', 'Calibri'] },
      { code: 'list', severity: 'info', count: 1, samples: [] },
    ])
  })
})
