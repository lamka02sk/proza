import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { detectSource } from './detect'
import { markerKind, romanValue } from './markers'
import { textToBlocks } from './plain-text'
import type { RawBlock } from './raw'

const texts = (bs: readonly RawBlock[]): string[] => bs.flatMap((b) => [
  ...Object.values(b.attrs).filter((v): v is { text: string } => typeof v === 'object' && v !== null && 'text' in v).map((v) => v.text),
  ...texts(b.children ?? []),
])

describe('plain text', () => {
  it('blank lines split paragraphs, single breaks stay', () => {
    const out = textToBlocks('One\ntwo\n\n\nThree')
    expect(texts(out)).toEqual(['One\ntwo', 'Three'])
  })
  it('lists nest by indentation and keep their start', () => {
    const out = textToBlocks('- a\n  - b\n- c\n\n3. x\n4. y')
    expect(out.map((b) => [b.type, b.attrs.style, b.attrs.start])).toEqual([['core/list', 'bullet', 1], ['core/list', 'number', 3]])
    expect(out[0]!.children![0]!.children![0]!.children!.length).toBe(1)
    expect(texts(out)).toEqual(['a', 'b', 'c', 'x', 'y'])
  })
  it('links addresses', () => {
    const [p] = textToBlocks('See https://a.example/x now')
    expect((p!.attrs.content as { formats: unknown[] }).formats).toEqual([{ type: 'link', start: 4, end: 23, attrs: { href: 'https://a.example/x' } }])
  })
  it('loses no word and keeps no control character', () => {
    const unit = fc.constantFrom('a', 'b', ' ', '\n', '\n\n', '- ', '1. ', '\t', '\u0007', '\r\n', '\uFFFC', 'ž')
    fc.assert(fc.property(fc.string({ unit, maxLength: 60 }), (t) => {
      const words = (s: string): string[] => s.match(/[abž]+/g) ?? []
      const out = texts(textToBlocks(t)).join(' ')
      // eslint-disable-next-line no-control-regex
      return words(out).join(' ') === words(t.replace(/[\u0007\uFFFC]/g, '')).join(' ') && !/[\u0000-\u0008\uFFFC]/.test(out)
    }))
  })
})

describe('list markers', () => {
  it('bullets, numbers, letters and roman numerals', () => {
    expect(markerKind('·')).toMatchObject({ ordered: false })
    expect(markerKind('o')).toMatchObject({ ordered: false })
    expect(markerKind('3.')).toEqual({ ordered: true, numbering: '1', start: 3 })
    expect(markerKind('1.2.')).toEqual({ ordered: true, numbering: '1', start: 2 })
    expect(markerKind('b)')).toEqual({ ordered: true, numbering: 'a', start: 2 })
    expect(markerKind('iv.')).toEqual({ ordered: true, numbering: 'i', start: 4 })
    expect(markerKind('i.')).toEqual({ ordered: true, numbering: 'i', start: 1 })
    expect(markerKind('i.', { ordered: true, numbering: 'a', start: 8 })).toEqual({ ordered: true, numbering: 'a', start: 9 })
    expect(markerKind('C.')).toEqual({ ordered: true, numbering: 'A', start: 3 })
    expect(romanValue('xiv')).toBe(14)
    expect(romanValue('iix')).toBeNull()
  })
})

describe('source detection', () => {
  it.each([
    ['<html xmlns:w="urn:schemas-microsoft-com:office:word"><p class=MsoNormal>a</p>', 'word-desktop'],
    ['<p class="Paragraph SCXW1 BCX0" paraeid="{1}">a</p>', 'word-web'],
    ['<b id="docs-internal-guid-1234">a</b>', 'google-docs'],
    ['<google-sheets-html-origin><table>', 'google-sheets'],
    ['<html xmlns:x="urn:schemas-microsoft-com:office:excel"><table>', 'excel'],
    ['<td sdval="3" sdnum="1051;">3</td>', 'libreoffice-calc'],
    ['<td data-sheets-value="x">Text</td><td sdval="3">3</td>', 'libreoffice-calc'],
    ['<meta name="generator" content="LibreOffice 24.2"/><td data-sheets-value="x">Text</td>', 'libreoffice-calc'],
    ['<meta name="generator" content="LibreOffice 7.6"/><p>a</p>', 'libreoffice-writer'],
    ['<p data-mce-style="x">a</p>', 'tinymce'],
    ['<div data-pz-clip="{}"><p>a</p></div>', 'proza'],
    ['<p>plain</p>', 'html'],
  ])('%s', (html, source) => { expect(detectSource(html)).toBe(source) })
})
