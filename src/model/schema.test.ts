import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  type BlockSchema, type Doc, DocumentVersionError, UNSUPPORTED, attrSpecs, blockRegistry, defaultAttrs,
  serializeDoc, validateDoc,
} from './schema'
import { type Block, treeFromBlocks } from './tree'

const para: BlockSchema = {
  name: 't/para',
  attrs: {
    content: { type: 'richtext' },
    plain: { type: 'richtext', formats: ['bold'] },
    level: { type: 'enum', values: [1, 2, 3], default: 2 },
    n: { type: 'number', integer: true, min: 0, max: 10, default: 3 },
    flag: { type: 'boolean' },
    href: { type: 'url' },
    name: { type: 'string', pattern: /^[a-z]+$/, maxLength: 5 },
  },
  supports: { anchor: true, language: true, textAlign: true },
}
const box: BlockSchema = { name: 't/box', attrs: {}, children: {} }
const list: BlockSchema = { name: 't/list', attrs: {}, children: { allowed: ['t/item'] } }
const item: BlockSchema = { name: 't/item', attrs: { content: { type: 'richtext' } }, parent: ['t/list'] }

/** Version 3. v1 had `title`, v2 renamed it to `heading`, v3 added `size`. */
const versioned: BlockSchema = {
  name: 't/old',
  version: 3,
  attrs: { heading: { type: 'string' }, size: { type: 'enum', values: ['s', 'm'] } },
  migrate(attrs, from) {
    let a = { ...attrs }
    if (from < 2) { const { title, ...rest } = a; a = { ...rest, heading: title } }
    if (from < 3) a = { ...a, size: a.heading === 'big' ? 'm' : 's' }
    return a
  },
}
const broken: BlockSchema = { name: 't/broken', version: 2, attrs: {}, migrate: () => { throw new Error('boom') } }
const unmigrated: BlockSchema = { name: 't/nomigrate', version: 2, attrs: {} }
const bogus: BlockSchema = { name: 't/bogus', version: 2, attrs: {}, migrate: () => null as unknown as Record<string, unknown> }

const registry = blockRegistry([para, box, list, item, versioned, broken, unmigrated, bogus])

function ids(): () => string {
  let n = 0
  return () => `gen${++n}`
}

const v = (input: unknown) => validateDoc(input, registry, { createId: ids() })
const one = (block: unknown): Block => v({ version: 1, blocks: [block] }).doc.blocks[0]!
const messages = (input: unknown): string[] => v(input).issues.map((i) => `${i.path}: ${i.message}`)

/** Placeholder ids are regenerated when the original id was unusable; compare without them. */
function withoutPlaceholderIds(blocks: readonly Block[]): unknown[] {
  return blocks.map((b) => (b.type === UNSUPPORTED ? { ...b, id: '*' } : { ...b, ...(b.children ? { children: withoutPlaceholderIds(b.children) } : {}) }))
}

// ---------------------------------------------------------------------------
// Generators: mostly-valid documents with every kind of damage mixed in.

const TYPES = ['t/para', 't/box', 't/list', 't/item', 't/old', 't/broken', 't/nomigrate', 't/bogus', 'x/unknown', UNSUPPORTED]

const arbRich = fc.oneof(
  fc.record({
    text: fc.string({ unit: fc.constantFrom('a', ' ', '\n', '\r', '\u0000', '<', 'é', '😀'), maxLength: 12 }),
    formats: fc.array(fc.record({
      type: fc.constantFrom('bold', 'italic', 'link', 'x-custom', 'Bad Type'),
      start: fc.integer({ min: -2, max: 14 }),
      end: fc.integer({ min: -2, max: 14 }),
      attrs: fc.option(fc.record({ href: fc.constantFrom('https://a.b', ' /x ', 'javascript:alert(1)', 'data:x') }), { nil: undefined }),
    }, { requiredKeys: ['type', 'start', 'end'] }), { maxLength: 4 }),
  }),
  fc.jsonValue(),
)

const arbAttrs = fc.record({
  content: arbRich, plain: arbRich,
  level: fc.oneof(fc.constantFrom(1, 2, 3), fc.jsonValue()),
  n: fc.oneof(fc.integer({ min: -2, max: 12 }), fc.double(), fc.jsonValue()),
  flag: fc.oneof(fc.boolean(), fc.jsonValue()),
  href: fc.constantFrom('https://x.y', 'javascript:x', '', 3),
  name: fc.constantFrom('abc', 'toolong', 'ABC', ''),
  anchor: fc.constantFrom('a1', '1a', ''), lang: fc.constantFrom('sk', 'en-GB', 'x y'), dir: fc.constantFrom('rtl', 'up'),
  title: fc.string(), heading: fc.string(), extra: fc.jsonValue(),
}, { requiredKeys: [] })

const { arbBlock } = fc.letrec<{ arbBlock: unknown }>((tie) => ({
  arbBlock: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    fc.record({
      id: fc.oneof(fc.constantFrom('a', 'b', 'c', 'd'), fc.constantFrom('', 'bad id', 7)),
      type: fc.constantFrom(...TYPES),
      version: fc.constantFrom(1, 2, 3, 4, 0, 'x'),
      attrs: fc.oneof(arbAttrs, fc.jsonValue()),
      children: fc.oneof(fc.array(tie('arbBlock'), { maxLength: 3 }), fc.jsonValue()),
    }, { requiredKeys: ['type'] }),
    fc.jsonValue(),
  ),
}))

const arbDoc = fc.record({ version: fc.constantFrom(1, undefined, 0, 'x'), blocks: fc.array(arbBlock, { maxLength: 5 }) }, { requiredKeys: ['blocks'] })

// ---------------------------------------------------------------------------

describe('validateDoc', () => {
  it('never throws on arbitrary JSON, except for an envelope from the future', () => {
    fc.assert(fc.property(fc.oneof(fc.jsonValue(), arbDoc), (input) => {
      try { v(input) } catch (e) { expect(e).toBeInstanceOf(DocumentVersionError) }
    }))
  })

  it('produces a valid tree: unique valid ids, containers with children, defaults filled', () => {
    fc.assert(fc.property(arbDoc, (input) => {
      const { doc } = v(input)
      treeFromBlocks(doc.blocks) // throws on a bad or repeated id
      const check = (blocks: readonly Block[]): void => {
        for (const b of blocks) {
          if (b.type === UNSUPPORTED) { expect(b.children).toBeUndefined(); continue }
          const schema = registry.get(b.type)!
          expect(Object.keys(b.attrs).sort()).toEqual(Object.keys(attrSpecs(schema)).sort())
          expect(b.children !== undefined).toBe(Boolean(schema.children))
          check(b.children ?? [])
        }
      }
      check(doc.blocks)
    }))
  })

  it('saving and loading again changes nothing', () => {
    fc.assert(fc.property(arbDoc, (input) => {
      const first = v(input).doc
      const again = v(serializeDoc(first, registry))
      expect(withoutPlaceholderIds(again.doc.blocks)).toEqual(withoutPlaceholderIds(first.blocks))
      // The only issues left are the placeholders, which stay placeholders.
      for (const issue of again.issues) expect(issue.message).toMatch(/kept as an unsupported block$/)
    }))
  })

  it('fills defaults, including those added by supports', () => {
    const b = one({ id: 'a', type: 't/para' })
    expect(b.attrs).toEqual(defaultAttrs(para))
    expect(b.attrs).toMatchObject({ level: 2, n: 3, flag: false, href: '', name: '', anchor: '', lang: '', dir: '', textAlign: '' })
    expect(b.attrs.content).toEqual({ text: '', formats: [] })
  })

  it('replaces invalid values with defaults and drops unknown attributes', () => {
    expect(messages({ version: 1, blocks: [{ id: 'a', type: 't/para', attrs: { level: 7, n: 2.5, href: 'javascript:x', name: 'ABC', anchor: '9', extra: 1 } }] })).toEqual([
      'blocks[0].attrs.level: Invalid enum, default used',
      'blocks[0].attrs.n: Invalid number, default used',
      'blocks[0].attrs.href: Invalid url, default used',
      'blocks[0].attrs.name: Invalid string, default used',
      'blocks[0].attrs.anchor: Invalid string, default used',
      'blocks[0].attrs.extra: Unknown attribute of t/para, dropped',
    ])
  })

  it('cleans rich text: line endings, control characters, unsafe links, disallowed formats', () => {
    const b = one({
      id: 'a', type: 't/para', attrs: {
        content: { text: 'a\r\nb\u0007c', formats: [
          { type: 'bold', start: 0, end: 6 },
          { type: 'link', start: 0, end: 1, attrs: { href: 'javascript:alert(1)' } },
          { type: 'link', start: 5, end: 6, attrs: { href: ' https://x.y ', onclick: 'x' } },
        ] },
        plain: { text: 'xy', formats: [{ type: 'italic', start: 0, end: 1 }, { type: 'bold', start: 1, end: 2 }] },
      },
    })
    // Stored "a\r\nb\u0007c": CR LF is one character and the bell is gone, so "c" (stored 5..6) is at 3..4.
    expect(b.attrs.content).toEqual({ text: 'a\nbc', formats: [
      { type: 'bold', start: 0, end: 4 },
      { type: 'link', start: 3, end: 4, attrs: { href: 'https://x.y' } },
    ] })
    expect(b.attrs.plain).toEqual({ text: 'xy', formats: [{ type: 'bold', start: 1, end: 2 }] })
  })

  it('keeps valid objects and removes object characters without a valid object', () => {
    const O = '\uFFFC'
    const b = one({
      id: 'a', type: 't/para', attrs: {
        content: { text: `${O}a${O}b${O}`, formats: [
          { type: 'image', start: 0, end: 1, attrs: { src: '/a.png', alt: 'A', onerror: 'x' } },
          { type: 'image', start: 2, end: 3, attrs: { src: 'javascript:x', alt: '' } },
          { type: 'color', start: 3, end: 4, attrs: { color: 'Red!' } },
          { type: 'highlight', start: 3, end: 4, attrs: { color: 'yellow' } },
        ] },
      },
    })
    expect(b.attrs.content).toEqual({ text: `${O}ab`, formats: [
      { type: 'image', start: 0, end: 1, attrs: { src: '/a.png', alt: 'A' } },
      { type: 'highlight', start: 2, end: 3, attrs: { color: 'yellow' } },
    ] })
  })

  it('gives missing, invalid and repeated ids new ones', () => {
    const { doc } = v({ version: 1, blocks: [{ id: 'a', type: 't/box' }, { id: 'a', type: 't/box' }, { type: 't/box' }, { id: 'x y', type: 't/box' }] })
    expect(doc.blocks.map((b) => b.id)).toEqual(['a', 'gen1', 'gen2', 'gen3'])
  })

  it('enforces children and parent rules with placeholders', () => {
    const { doc } = v({ version: 1, blocks: [
      { id: 'a', type: 't/item' },
      { id: 'b', type: 't/list', children: [{ id: 'c', type: 't/item' }, { id: 'd', type: 't/para' }] },
      { id: 'e', type: 't/para', children: [{ id: 'f', type: 't/para' }] },
    ] })
    expect(doc.blocks.map((b) => b.type)).toEqual([UNSUPPORTED, 't/list', UNSUPPORTED])
    expect(doc.blocks[1]!.children!.map((b) => b.type)).toEqual(['t/item', UNSUPPORTED])
  })

  it('keeps unknown blocks untouched and gives them back on save', () => {
    const original = { id: 'z', type: 'x/gallery', version: 4, attrs: { images: [1, 2], deep: { a: null } }, children: [{ any: 'thing' }] }
    const { doc, issues } = v({ version: 1, blocks: [original, { id: 'p', type: 't/para' }] })
    expect(doc.blocks[0]).toMatchObject({ id: 'z', type: UNSUPPORTED, attrs: { original } })
    expect(issues).toEqual([{ path: 'blocks[0]', message: 'Unknown block type x/gallery; kept as an unsupported block' }])
    const saved = serializeDoc(doc, registry)
    expect(saved.blocks[0]).toBe(original)
    // The common attributes are stored only when set.
    const { lock, variant, htmlStyle, htmlClass, ...stored } = defaultAttrs(para)
    expect([lock, variant, htmlStyle, htmlClass]).toEqual(['', '', '', ''])
    expect(saved.blocks[1]).toEqual({ id: 'p', type: 't/para', attrs: stored })
  })

  it('stores lock and variant only when set, and loads them back', () => {
    const { doc } = v({ version: 1, blocks: [{ id: 'p', type: 't/para', attrs: { lock: 'all', variant: 'lead' } }, { id: 'q', type: 't/para', attrs: { lock: 'nope', variant: 'Bad Name' } }] })
    expect(doc.blocks.map((b) => [b.attrs.lock, b.attrs.variant])).toEqual([['all', 'lead'], ['', '']])
    const saved = serializeDoc(doc, registry)
    expect(saved.blocks[0]!.attrs).toMatchObject({ lock: 'all', variant: 'lead' })
    expect('lock' in saved.blocks[1]!.attrs || 'variant' in saved.blocks[1]!.attrs).toBe(false)
  })

  it('rejects an envelope newer than this code', () => {
    expect(() => v({ version: 2, blocks: [] })).toThrow(DocumentVersionError)
  })

  it('reports a document that is not one', () => {
    for (const input of [null, [], 'x', { version: 1 }]) expect(v(input).doc).toEqual({ version: 1, blocks: [] })
  })
})

describe('migrations', () => {
  // Stored fixtures, one per past version of t/old. Each must load as the current shape.
  const fixtures: [string, unknown][] = [
    ['version 1', { id: 'a', type: 't/old', attrs: { title: 'big' } }],
    ['version 1, explicit', { id: 'a', type: 't/old', version: 1, attrs: { title: 'big' } }],
    ['version 2', { id: 'a', type: 't/old', version: 2, attrs: { heading: 'big' } }],
    ['version 3', { id: 'a', type: 't/old', version: 3, attrs: { heading: 'big', size: 'm' } }],
  ]
  it.each(fixtures)('%s loads as the current version', (_name, stored) => {
    const { doc, issues } = v({ version: 1, blocks: [stored] })
    expect(issues).toEqual([])
    expect(doc.blocks[0]).toEqual({ id: 'a', type: 't/old', attrs: { heading: 'big', size: 'm', lock: '', variant: '', htmlStyle: '', htmlClass: '' } })
    expect(serializeDoc(doc, registry).blocks[0]).toEqual({ id: 'a', type: 't/old', version: 3, attrs: { heading: 'big', size: 'm' } })
  })

  it('keeps a block from a newer version, one whose migration fails, and one without a migration', () => {
    const { doc, issues } = v({ version: 1, blocks: [
      { id: 'a', type: 't/old', version: 4, attrs: {} },
      { id: 'b', type: 't/broken', attrs: {} },
      { id: 'c', type: 't/nomigrate', attrs: {} },
      { id: 'd', type: 't/bogus', attrs: {} },
    ] })
    expect(doc.blocks.map((b) => b.type)).toEqual([UNSUPPORTED, UNSUPPORTED, UNSUPPORTED, UNSUPPORTED])
    expect(issues.map((i) => i.message)).toEqual([
      't/old version 4 is newer than supported version 3; kept as an unsupported block',
      'Migration of t/broken from version 1 failed: Error: boom; kept as an unsupported block',
      't/nomigrate has no migration from version 1; kept as an unsupported block',
      'Migration of t/bogus from version 1 returned no attributes; kept as an unsupported block',
    ])
  })

  it('does not let a migration change its input', () => {
    const attrs = Object.freeze({ title: 'x' })
    one({ id: 'a', type: 't/old', attrs })
    expect(attrs).toEqual({ title: 'x' })
  })
})

describe('serializeDoc', () => {
  it('omits the version of blocks at version 1', () => {
    const doc: Doc = { version: 1, blocks: [{ id: 'a', type: 't/box', attrs: {}, children: [{ id: 'b', type: 't/old', attrs: { heading: '', size: 's' } }] }] }
    expect(serializeDoc(doc, registry)).toEqual({
      version: 1,
      blocks: [{ id: 'a', type: 't/box', attrs: {}, children: [{ id: 'b', type: 't/old', version: 3, attrs: { heading: '', size: 's' } }] }],
    })
  })
})
