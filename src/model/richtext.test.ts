import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  OBJECT_CHAR, applyFormat, checkFormatAttrs, concat, createValue, defaultFormats, deleteRange, dropOrphanObjects, findChange,
  formatAttrs, formatRangeAt, inheritedMarks, insertObject, insertText, isFormatActive, marked, normalize, objectAt, removeFormat,
  replace, setObjectAttrs, slice, split, toggleFormat, toggleMark, typingMarks, valuesEqual,
  type FormatRange, type RichTextValue,
} from './richtext'

// ---------------------------------------------------------------------------
// Generators

const TYPES = ['bold', 'italic', 'code', 'link', 'subscript', 'superscript', 'x-unknown'] as const

const arbText = fc.string({ unit: fc.constantFrom('a', 'b', ' ', '\n', 'é', '😀'), maxLength: 24 })

const arbRange = (len: number): fc.Arbitrary<FormatRange> =>
  fc.record({
    type: fc.constantFrom(...TYPES),
    start: fc.integer({ min: -2, max: len + 2 }),
    end: fc.integer({ min: -2, max: len + 2 }),
    href: fc.constantFrom('a', 'b'),
  }).map(({ type, start, end, href }) => (type === 'link' ? { type, start, end, attrs: { href } } : { type, start, end }))

/** Raw, possibly invalid input: unsorted, overlapping, out of bounds. */
const arbRaw: fc.Arbitrary<RichTextValue> = arbText.chain((text) =>
  fc.array(arbRange(text.length), { maxLength: 8 }).map((formats) => ({ text, formats })),
)

const arbValue = arbRaw.map((v) => normalize(v))

function checkInvariants(v: RichTextValue): void {
  const len = v.text.length
  for (const f of v.formats) {
    expect(f.start).toBeGreaterThanOrEqual(0)
    expect(f.end).toBeLessThanOrEqual(len)
    expect(f.start).toBeLessThan(f.end)
  }
  // Ranges of one type are disjoint and never touch with equal attributes (they would have merged).
  const byType = new Map<string, FormatRange[]>()
  for (const f of v.formats) byType.set(f.type, [...(byType.get(f.type) ?? []), f])
  for (const list of byType.values()) {
    const sorted = [...list].sort((a, b) => a.start - b.start)
    for (let i = 1; i < sorted.length; i++) {
      const a = sorted[i - 1]!, b = sorted[i]!
      expect(a.end).toBeLessThanOrEqual(b.start)
      if (a.end === b.start) expect(JSON.stringify(a.attrs ?? null)).not.toBe(JSON.stringify(b.attrs ?? null))
    }
  }
  // Already normal: normalize is idempotent.
  expect(valuesEqual(normalize(v), v)).toBe(true)
}

// ---------------------------------------------------------------------------

describe('normalize', () => {
  it('keeps the invariants for any input', () => {
    fc.assert(fc.property(arbRaw, (raw) => { checkInvariants(normalize(raw)) }))
  })

  it('does not depend on the order of the input when attributes agree', () => {
    fc.assert(fc.property(arbText, fc.array(fc.record({ type: fc.constantFrom('bold', 'italic'), start: fc.nat(30), end: fc.nat(30) })), (text, formats) => {
      const a = normalize({ text, formats })
      const b = normalize({ text, formats: [...formats].reverse() })
      expect(valuesEqual(a, b)).toBe(true)
    }))
  })

  it('merges touching ranges of the same format', () => {
    const v = createValue('abcd', [{ type: 'bold', start: 0, end: 2 }, { type: 'bold', start: 2, end: 4 }])
    expect(v.formats).toEqual([{ type: 'bold', start: 0, end: 4 }])
  })

  it('keeps touching links with different targets apart, and a later link wins an overlap', () => {
    const v = createValue('abcd', [
      { type: 'link', start: 0, end: 3, attrs: { href: 'x' } },
      { type: 'link', start: 2, end: 4, attrs: { href: 'y' } },
    ])
    expect(v.formats).toEqual([
      { type: 'link', start: 0, end: 2, attrs: { href: 'x' } },
      { type: 'link', start: 2, end: 4, attrs: { href: 'y' } },
    ])
  })

  it('sorts by start, then priority (link before bold)', () => {
    const v = createValue('abc', [{ type: 'bold', start: 0, end: 3 }, { type: 'link', start: 0, end: 3, attrs: { href: 'x' } }])
    expect(v.formats.map((f) => f.type)).toEqual(['link', 'bold'])
  })
})

describe('slice, concat, split', () => {
  it('split then concat is the identity', () => {
    fc.assert(fc.property(arbValue, fc.nat(30), (v, at) => {
      const [a, b] = split(v, at)
      expect(valuesEqual(concat([a, b]), v)).toBe(true)
    }))
  })

  it('slice keeps invariants', () => {
    fc.assert(fc.property(arbValue, fc.integer({ min: -3, max: 30 }), fc.integer({ min: -3, max: 30 }), (v, s, e) => {
      checkInvariants(normalize(slice(v, s, e)))
    }))
  })
})

describe('replace, insert, delete', () => {
  it('keeps invariants and the expected text', () => {
    fc.assert(fc.property(arbValue, fc.nat(30), fc.nat(30), arbValue, (v, a, b, ins) => {
      const s = Math.min(a, b, v.text.length), e = Math.min(Math.max(a, b), v.text.length)
      const r = replace(v, s, e, ins)
      checkInvariants(r)
      expect(r.text).toBe(v.text.slice(0, s) + ins.text + v.text.slice(e))
    }))
  })

  it('delete is undone by re-inserting the deleted slice', () => {
    fc.assert(fc.property(arbValue, fc.nat(30), fc.nat(30), (v, a, b) => {
      const s = Math.min(a, b, v.text.length), e = Math.min(Math.max(a, b), v.text.length)
      const removed = slice(v, s, e)
      expect(valuesEqual(replace(deleteRange(v, s, e), s, s, removed), v)).toBe(true)
    }))
  })

  it('typing inside bold stays bold, typing after a link is not linked', () => {
    let v = createValue('ab', [{ type: 'bold', start: 0, end: 2 }])
    v = insertText(v, 2, 'c')
    expect(v.formats).toEqual([{ type: 'bold', start: 0, end: 3 }])

    let l = createValue('ab', [{ type: 'link', start: 0, end: 2, attrs: { href: 'x' } }])
    l = insertText(l, 2, 'c')
    expect(l.formats).toEqual([{ type: 'link', start: 0, end: 2, attrs: { href: 'x' } }])
    l = insertText(l, 1, 'z')
    expect(l.formats).toEqual([{ type: 'link', start: 0, end: 3, attrs: { href: 'x' } }])
  })

  it('code is not extended at its end, but is inside', () => {
    const v = createValue('ab', [{ type: 'code', start: 0, end: 2 }])
    expect(inheritedMarks(v, 2)).toEqual([])
    expect(inheritedMarks(v, 1)).toEqual([{ type: 'code' }])
  })

  it('typing at offset 0 continues an inclusive format of the first character', () => {
    const v = createValue('ab', [{ type: 'bold', start: 0, end: 2 }, { type: 'link', start: 0, end: 2, attrs: { href: 'x' } }])
    expect(inheritedMarks(v, 0)).toEqual([{ type: 'bold' }])
  })

  it('explicit marks override inheritance (pending formats)', () => {
    const v = createValue('ab', [{ type: 'bold', start: 0, end: 2 }])
    const r = insertText(v, 2, 'c', [])
    expect(r.formats).toEqual([{ type: 'bold', start: 0, end: 2 }])
  })
})

describe('formats', () => {
  it('toggle twice restores the value', () => {
    fc.assert(fc.property(arbValue, fc.nat(30), fc.nat(30), fc.constantFrom('bold', 'italic', 'code'), (v, a, b, type) => {
      const s = Math.min(a, b, v.text.length), e = Math.min(Math.max(a, b), v.text.length)
      if (s === e) return
      const once = toggleFormat(v, s, e, { type })
      const twice = toggleFormat(once, s, e, { type })
      // After the first toggle the range is uniform, so the second one always restores uniformity the other way.
      expect(isFormatActive(once, s, e, type)).toBe(!isFormatActive(v, s, e, type))
      expect(isFormatActive(twice, s, e, type)).toBe(isFormatActive(v, s, e, type) && true)
      checkInvariants(twice)
    }))
  })

  it('partially bold selection toggles to fully bold', () => {
    const v = createValue('abcd', [{ type: 'bold', start: 0, end: 2 }])
    expect(toggleFormat(v, 0, 4, { type: 'bold' }).formats).toEqual([{ type: 'bold', start: 0, end: 4 }])
  })

  it('remove splits a range', () => {
    const v = createValue('abcd', [{ type: 'bold', start: 0, end: 4 }])
    expect(removeFormat(v, 1, 3, 'bold').formats).toEqual([{ type: 'bold', start: 0, end: 1 }, { type: 'bold', start: 3, end: 4 }])
  })

  it('subscript and superscript exclude each other', () => {
    const v = applyFormat(createValue('ab', [{ type: 'superscript', start: 0, end: 2 }]), 0, 2, { type: 'subscript' })
    expect(v.formats).toEqual([{ type: 'subscript', start: 0, end: 2 }])
    expect(toggleMark([{ type: 'superscript' }], { type: 'subscript' })).toEqual([{ type: 'subscript' }])
  })

  it('applying a link over a link replaces its target', () => {
    const v = applyFormat(createValue('abc', [{ type: 'link', start: 0, end: 3, attrs: { href: 'x' } }]), 0, 3, { type: 'link', attrs: { href: 'y' } })
    expect(v.formats).toEqual([{ type: 'link', start: 0, end: 3, attrs: { href: 'y' } }])
  })
})

describe('findChange', () => {
  it('describes the edit exactly', () => {
    fc.assert(fc.property(arbText, arbText, (a, b) => {
      const c = findChange(a, b)
      if (a === b) { expect(c).toBeNull(); return }
      expect(c).not.toBeNull()
      const { start, oldEnd, newEnd } = c!
      expect(a.slice(0, start) + b.slice(start, newEnd) + a.slice(oldEnd)).toBe(b)
    }))
  })

  it('places an ambiguous insertion at the caret', () => {
    expect(findChange('aa', 'aaa', 1)).toEqual({ start: 0, oldEnd: 0, newEnd: 1 })
    expect(findChange('aa', 'aaa', 3)).toEqual({ start: 2, oldEnd: 2, newEnd: 3 })
    expect(findChange('abab', 'ababab', 2)).toEqual({ start: 0, oldEnd: 0, newEnd: 2 })
  })

  it('places an ambiguous deletion at the caret', () => {
    expect(findChange('aaa', 'aa', 0)).toEqual({ start: 0, oldEnd: 1, newEnd: 0 })
  })

  it('stays exact with any hint', () => {
    fc.assert(fc.property(arbText, arbText, fc.nat(30), (a, b, hint) => {
      const c = findChange(a, b, hint)
      if (!c) return
      expect(a.slice(0, c.start) + b.slice(c.start, c.newEnd) + a.slice(c.oldEnd)).toBe(b)
    }))
  })

  it('never splits a surrogate pair', () => {
    expect(findChange('😀', '😁')).toEqual({ start: 0, oldEnd: 2, newEnd: 2 })
    expect(findChange('🈀', '😀')).toEqual({ start: 0, oldEnd: 2, newEnd: 2 })
  })
})

// ---------------------------------------------------------------------------
// Inline objects and attribute rules

const IMG = { type: 'image', attrs: { src: '/a.png', alt: 'A' } } as const
const O = OBJECT_CHAR

describe('inline objects', () => {
  it('never merge: two pictures side by side stay two', () => {
    const v = normalize({ text: `${O}${O}`, formats: [{ type: 'image', start: 0, end: 2, attrs: IMG.attrs }] })
    expect(v.formats).toEqual([{ type: 'image', start: 0, end: 1, attrs: IMG.attrs }, { type: 'image', start: 1, end: 2, attrs: IMG.attrs }])
  })

  it('sit only on U+FFFC', () => {
    expect(normalize({ text: `a${O}b`, formats: [{ type: 'image', start: 0, end: 3, attrs: IMG.attrs }] }).formats)
      .toEqual([{ type: 'image', start: 1, end: 2, attrs: IMG.attrs }])
  })

  it('keep one character per object through any edit', () => {
    const arb = fc.tuple(fc.array(fc.constantFrom('a', ' ', O), { maxLength: 12 }), fc.nat(12), fc.nat(12), fc.constantFrom('', 'x', O))
    fc.assert(fc.property(arb, ([chars, s, e, ins]) => {
      const text = chars.join('')
      const v = normalize({ text, formats: chars.flatMap((c, i) => (c === O ? [{ type: 'image', start: i, end: i + 1, attrs: IMG.attrs }] : [])) })
      const next = dropOrphanObjects(replace(v, Math.min(s, e), Math.max(s, e), marked(ins, [])))
      const objects = next.formats.filter((f) => f.type === 'image')
      expect(objects.every((f) => f.end - f.start === 1 && next.text[f.start] === O)).toBe(true)
      expect(objects.length).toBe(next.text.split(O).length - 1)
    }))
  })

  it('are inserted with the marks around them, and never become typing marks', () => {
    const v = createValue('ab', [{ type: 'link', start: 0, end: 2, attrs: { href: '/x' } }])
    const withImg = insertObject(v, 1, 1, IMG)
    expect(withImg.text).toBe(`a${O}b`)
    expect(withImg.formats).toContainEqual({ type: 'image', start: 1, end: 2, attrs: IMG.attrs })
    expect(withImg.formats).toContainEqual({ type: 'link', start: 0, end: 3, attrs: { href: '/x' } })
    expect(typingMarks(withImg, 1, 2).map((m) => m.type)).toEqual(['link'])
    expect(inheritedMarks(withImg, 2).map((m) => m.type)).toEqual(['link'])
  })

  it('are not applied or removed as formats, so no bare U+FFFC appears', () => {
    const v = createValue(`a${O}`, [{ type: 'image', start: 1, end: 2, attrs: IMG.attrs }])
    expect(applyFormat(createValue('ab'), 0, 2, IMG)).toEqual(createValue('ab'))
    expect(removeFormat(v, 0, 2, 'image')).toEqual(v)
    expect(toggleMark([], IMG)).toEqual([])
  })

  it('change attributes in place and drop orphans', () => {
    const v = createValue(`a${O}b${O}`, [{ type: 'image', start: 1, end: 2, attrs: IMG.attrs }])
    expect(dropOrphanObjects(v).text).toBe(`a${O}b`)
    expect(objectAt(setObjectAttrs(v, 1, { src: '/b.png', alt: 'B' }), 1)?.attrs).toEqual({ src: '/b.png', alt: 'B' })
    expect(setObjectAttrs(v, 0, { src: '/b.png', alt: 'B' })).toBe(v)
  })
})

describe('format attributes', () => {
  it('check each kind', () => {
    expect(checkFormatAttrs('link', { href: ' https://a.example/ ', target: '_blank', onclick: 'x' })).toEqual({ href: 'https://a.example/', target: '_blank' })
    expect(checkFormatAttrs('link', { href: 'javascript:alert(1)' })).toBeNull()
    expect(checkFormatAttrs('link', { href: '/x', target: '_top' })).toEqual({ href: '/x' })
    expect(checkFormatAttrs('color', { color: 'accent-2' })).toEqual({ color: 'accent-2' })
    expect(checkFormatAttrs('color', { color: 'red; background: url(x)' })).toBeNull()
    expect(checkFormatAttrs('highlight', {})).toEqual({})
    expect(checkFormatAttrs('lang', { lang: 'de-AT', dir: 'sideways' })).toEqual({ lang: 'de-AT' })
    expect(checkFormatAttrs('lang', { lang: 'not a tag' })).toBeNull()
    expect(checkFormatAttrs('abbr', { title: 'World Health Organization' })).toEqual({ title: 'World Health Organization' })
    expect(checkFormatAttrs('abbr', { title: 'a\u0007' })).toBeNull()
    expect(checkFormatAttrs('image', { src: '/a.png', alt: '', width: '640', height: '0' })).toEqual({ src: '/a.png', alt: '', width: '640' })
    expect(checkFormatAttrs('image', { src: 'data:image/png;base64,xx', alt: '' })).toBeNull()
    expect(checkFormatAttrs('footnote', { note: 'See page 4.' })).toEqual({ note: 'See page 4.' })
    // Unknown formats keep their string attributes until their type is installed.
    expect(checkFormatAttrs('x-plugin', { a: '1', b: 2 })).toEqual({ a: '1' })
  })

  it('render presets as classes before the other attributes', () => {
    const spec = defaultFormats.get('highlight')!
    expect(formatAttrs(spec, { type: 'highlight', start: 0, end: 1, attrs: { color: 'yellow' } })).toEqual({ class: 'pz-highlight-yellow' })
    expect(formatAttrs(defaultFormats.get('footnote')!, { type: 'footnote', start: 0, end: 1, attrs: { note: 'n' } })).toEqual({ class: 'pz-fn', note: 'n' })
  })

  it('find the range of a format around a caret', () => {
    const v = createValue('a link b', [{ type: 'link', start: 2, end: 6, attrs: { href: '/x' } }])
    expect(formatRangeAt(v, 4, 'link')?.start).toBe(2)
    expect(formatRangeAt(v, 6, 'link')?.end).toBe(6)
    expect(formatRangeAt(v, 2, 'link')?.end).toBe(6)
    expect(formatRangeAt(v, 7, 'link')).toBeNull()
  })
})
