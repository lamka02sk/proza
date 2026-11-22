/**
 * The linear normalize, dropOrphanObjects and toTree against the direct
 * versions they replaced (per character, per orphan, per segment), which
 * are easy to read and were the behaviour before.
 */
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  OBJECT_CHAR, attrsKey, defaultFormats, deleteRange, dropOrphanObjects, normalize, objectAt, toTree,
  type FormatRange, type FormatRegistry, type RichNode, type RichTextValue,
} from './richtext'

const priority = (type: string, registry: FormatRegistry): number => registry.get(type)?.priority ?? 1000
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)
const range = (type: string, start: number, end: number, attrs: FormatRange['attrs']): FormatRange =>
  attrs && Object.keys(attrs).length > 0 ? { type, start, end, attrs: { ...attrs } } : { type, start, end }

function normalizeByCharacter(value: RichTextValue, registry: FormatRegistry = defaultFormats): RichTextValue {
  const len = value.text.length
  const byType = new Map<string, FormatRange[]>()
  for (const f of value.formats) {
    const start = Math.max(0, Math.min(len, Math.trunc(f.start)))
    const end = Math.max(0, Math.min(len, Math.trunc(f.end)))
    if (!(start < end) || !f.type) continue
    byType.set(f.type, [...(byType.get(f.type) ?? []), range(f.type, start, end, f.attrs)])
  }
  const ownLinks = value.formats
    .filter((f) => registry.get(f.type)?.ownLink && value.text[f.start] === OBJECT_CHAR && f.end - f.start === 1)
    .map((f) => f.start)
  const out: FormatRange[] = []
  for (const [type, ranges] of byType) {
    const owner = new Array<number>(len).fill(-1)
    ranges.forEach((r, k) => { for (let i = r.start; i < r.end; i++) owner[i] = k })
    if (registry.get(type)?.tag === 'a') for (const at of ownLinks) owner[at] = -1
    const keys = ranges.map((r) => attrsKey(r.attrs))
    const object = registry.get(type)?.object === true
    let i = 0
    while (i < len) {
      const o = owner[i]!
      if (o < 0 || (object && value.text[i] !== OBJECT_CHAR)) { i++; continue }
      let j = i + 1
      if (!object) while (j < len && owner[j]! >= 0 && keys[owner[j]!] === keys[o]) j++
      out.push(range(type, i, j, ranges[o]!.attrs))
      i = j
    }
  }
  out.sort((a, b) => a.start - b.start || priority(a.type, registry) - priority(b.type, registry) || cmp(a.type, b.type) || a.end - b.end)
  return { text: value.text, formats: out }
}

function dropOrphansOneByOne(value: RichTextValue): RichTextValue {
  let v = value
  for (let i = v.text.lastIndexOf(OBJECT_CHAR); i >= 0; i = i === 0 ? -1 : v.text.lastIndexOf(OBJECT_CHAR, i - 1)) {
    if (!objectAt(v, i)) v = deleteRange(v, i, i + 1)
  }
  return v
}

function treeBySegment(value: RichTextValue, registry: FormatRegistry = defaultFormats): RichNode[] {
  const { text, formats } = value
  const points = [...new Set([0, text.length, ...formats.flatMap((f) => [f.start, f.end])])].sort((a, b) => a - b)
  const root: RichNode[] = []
  const stack: { range: FormatRange; children: RichNode[] }[] = []
  const top = (): RichNode[] => stack.at(-1)?.children ?? root
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!, b = points[i + 1]!
    const active = formats.filter((f) => f.start <= a && b <= f.end)
      .sort((x, y) => priority(x.type, registry) - priority(y.type, registry) || x.start - y.start || y.end - x.end || cmp(x.type, y.type))
    let keep = 0
    while (keep < stack.length && keep < active.length && stack[keep]!.range === active[keep]) keep++
    stack.length = keep
    for (let k = keep; k < active.length; k++) {
      const children: RichNode[] = []
      top().push({ format: active[k]!, children })
      stack.push({ range: active[k]!, children })
    }
    top().push({ text: text.slice(a, b) })
  }
  return root
}

const arbText = fc.string({ unit: fc.constantFrom('a', 'b', '\n', OBJECT_CHAR, '😀'), maxLength: 20 })
const arbRaw: fc.Arbitrary<RichTextValue> = arbText.chain((text) => fc.array(
  fc.record({
    type: fc.constantFrom('bold', 'italic', 'link', 'abbr', 'image', 'footnote', 'x-unknown'),
    start: fc.integer({ min: -2, max: text.length + 2 }),
    end: fc.integer({ min: -2, max: text.length + 2 }),
    v: fc.constantFrom('a', 'b'),
  }).map(({ type, start, end, v }): FormatRange => (type === 'bold' || type === 'italic' ? { type, start, end } : { type, start, end, attrs: { v } })),
  { maxLength: 10 },
).map((formats) => ({ text, formats })))

describe('linear rewrites', () => {
  it('normalize paints like the per-character version', () => {
    fc.assert(fc.property(arbRaw, (raw) => { expect(normalize(raw)).toEqual(normalizeByCharacter(raw)) }), { numRuns: 2000 })
  })

  it('dropOrphanObjects removes like the one-by-one version', () => {
    fc.assert(fc.property(arbRaw, (raw) => {
      const v = normalize(raw)
      expect(dropOrphanObjects(v)).toEqual(dropOrphansOneByOne(v))
    }), { numRuns: 2000 })
  })

  it('toTree nests like the per-segment version', () => {
    fc.assert(fc.property(arbRaw, (raw) => {
      const v = normalize(raw)
      expect(toTree(v)).toEqual(treeBySegment(v))
    }), { numRuns: 2000 })
  })

  it('costs grow with the input, not with types times length', () => {
    const text = 'a'.repeat(100_000) + OBJECT_CHAR.repeat(50_000)
    const formats: FormatRange[] = Array.from({ length: 2_000 }, (_, i) => ({ type: `x${i % 16}-${i}`, start: i * 50, end: i * 50 + 10 }))
    const started = performance.now()
    const v = dropOrphanObjects(normalize({ text, formats }))
    toTree(v)
    expect(v.text.length).toBe(100_000)
    expect(performance.now() - started).toBeLessThan(1_000)
  })
})
