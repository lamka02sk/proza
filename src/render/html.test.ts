import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { RenderError, fragment, h } from './html'
import { Footnotes, richText } from './render'
import { OBJECT_CHAR, normalize, type RichTextValue } from '../model/richtext'

describe('h', () => {
  it('escapes text and attribute values', () => {
    expect(h('p', { title: '"a" <b> & c' }, '<script>alert("x")</script> & ').html)
      .toBe('<p title="&quot;a&quot; &lt;b&gt; &amp; c">&lt;script&gt;alert("x")&lt;/script&gt; &amp; </p>')
  })

  it('writes boolean attributes and skips empty ones', () => {
    expect(h('input', { type: 'checkbox', checked: true, disabled: false, id: null, class: undefined }).html).toBe('<input type="checkbox" checked>')
  })

  it('nests children, arrays and fragments', () => {
    expect(h('ul', null, [h('li', null, 'a'), [h('li', null, 'b'), null, false]], fragment('c', h('br'))).html).toBe('<ul><li>a</li><li>b</li>c<br></ul>')
  })

  it.each([
    ['a disallowed element', () => h('script')],
    ['an inline style', () => h('p', { style: 'color: red' })],
    ['an event handler', () => h('p', { onclick: 'x()' })],
    ['an attribute of another element', () => h('p', { href: '/x' })],
    ['a data attribute outside the pz- prefix', () => h('p', { 'data-x': '1' })],
    ['a text input', () => h('input', { type: 'text' })],
    ['children on a void element', () => h('br', null, 'x')],
    ['an unescaped object posing as Html', () => h('p', null, { html: '<script></script>' })],
  ])('rejects %s', (_name, build) => {
    expect(build).toThrow(RenderError)
  })

  it('drops URLs outside the protocol allow-list', () => {
    expect(h('a', { href: 'javascript:alert(1)' }, 'x').html).toBe('<a>x</a>')
    expect(h('a', { href: ' JavaScript:alert(1)' }, 'x').html).toBe('<a>x</a>')
    expect(h('a', { href: 'data:text/html,x' }, 'x').html).toBe('<a>x</a>')
    expect(h('a', { href: ' https://example.com/?a=1&b="2" ' }, 'x').html).toBe('<a href="https://example.com/?a=1&amp;b=&quot;2&quot;">x</a>')
    for (const ok of ['http://x', 'mailto:a@b.c', 'tel:+421', '#top', '/path', './rel', '../up', 'page.html']) {
      expect(h('a', { href: ok }).html).toBe(`<a href="${ok}"></a>`)
    }
  })

  it('adds noopener to links that open a new window', () => {
    expect(h('a', { href: '/x', target: '_blank' }).html).toBe('<a href="/x" target="_blank" rel="noopener"></a>')
    expect(h('a', { href: '/x', target: '_blank', rel: 'nofollow' }).html).toBe('<a href="/x" target="_blank" rel="nofollow noopener"></a>')
  })
})

describe('richText', () => {
  const v = (text: string, formats: RichTextValue['formats'] = []): RichTextValue => normalize({ text, formats })

  it('nests formats by priority, the same way as the field', () => {
    expect(richText(v('abcd', [{ type: 'italic', start: 0, end: 3 }, { type: 'bold', start: 1, end: 4 }])).html)
      .toBe('<em>a</em><strong><em>bc</em>d</strong>')
    expect(richText(v('ab', [{ type: 'bold', start: 0, end: 2 }, { type: 'link', start: 1, end: 2, attrs: { href: '/x' } }])).html)
      .toBe('<strong>a</strong><a href="/x"><strong>b</strong></a>')
  })

  it('renders line breaks, with a second <br> for a trailing one', () => {
    expect(richText(v('a\nb')).html).toBe('a<br>b')
    expect(richText(v('a\n')).html).toBe('a<br><br>')
    expect(richText(v('a\nb'), undefined, true).html).toBe('a\nb')
  })

  it('renders every standard inline format', () => {
    const one = (type: string, attrs?: Record<string, string>): string => richText(v('ab', [attrs ? { type, start: 0, end: 2, attrs } : { type, start: 0, end: 2 }])).html
    expect(one('underline')).toBe('<u>ab</u>')
    expect(one('strikethrough')).toBe('<s>ab</s>')
    expect(one('subscript')).toBe('<sub>ab</sub>')
    expect(one('superscript')).toBe('<sup>ab</sup>')
    expect(one('code')).toBe('<code>ab</code>')
    expect(one('kbd')).toBe('<kbd>ab</kbd>')
    expect(one('color', { color: 'accent' })).toBe('<span class="pz-color-accent">ab</span>')
    expect(one('highlight')).toBe('<mark>ab</mark>')
    expect(one('highlight', { color: 'green' })).toBe('<mark class="pz-highlight-green">ab</mark>')
    expect(one('lang', { lang: 'de', dir: 'ltr' })).toBe('<span lang="de" dir="ltr">ab</span>')
    expect(one('abbr', { title: 'A & B' })).toBe('<abbr title="A &amp; B">ab</abbr>')
    expect(one('link', { href: '/x', target: '_blank' })).toBe('<a href="/x" target="_blank" rel="noopener">ab</a>')
  })

  it('renders inline pictures as void elements with their text alternative', () => {
    const img = { type: 'image', start: 1, end: 2, attrs: { src: '/a.png', alt: '', width: '20', height: '10' } }
    expect(richText(v(`a${OBJECT_CHAR}b`, [img])).html).toBe('a<img src="/a.png" alt="" width="20" height="10">b')
  })

  it('has no footnote list without footnotes', () => {
    expect(new Footnotes().list({ footnotes: 'Poznámky', backToReference: (n) => `Späť ${n}` })).toBeNull()
  })

  it('renders an unknown format as a marked span', () => {
    expect(richText(v('a', [{ type: 'x-note', start: 0, end: 1 }])).html).toBe('<span data-pz-format="x-note">a</span>')
  })

  // Strip every tag the renderer may write; what is left must be plain escaped text.
  const TAG = /<\/?(?:a|strong|em|u|s|sub|sup|mark|code|kbd|abbr|span|br)(?: [a-z-]+="[^"<>]*")*>/g
  const unescape = (s: string): string => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')

  it('never lets text become markup, and keeps every character', () => {
    const arbText = fc.string({ unit: fc.constantFrom('a', '<', '>', '&', '"', "'", '\n', ' ', '😀', '/'), maxLength: 20 })
    const arbValue = arbText.chain((text) => fc.array(fc.record({
      type: fc.constantFrom('bold', 'italic', 'link', 'code', 'x-y'),
      start: fc.nat(text.length), end: fc.nat(text.length),
      href: fc.constantFrom('/a', 'javascript:x', '"><script>', 'https://a?b&c'),
    }), { maxLength: 5 }).map((fs) => normalize({ text, formats: fs.map(({ href, ...f }) => (f.type === 'link' ? { ...f, attrs: { href } } : f)) })))
    fc.assert(fc.property(arbValue, (value) => {
      const html = richText(value).html
      const rest = html.replace(TAG, '')
      expect(rest).not.toMatch(/[<>]/)
      expect(unescape(rest)).toBe(value.text.replace(/\n/g, ''))
      expect(html).not.toContain('javascript:')
      expect(richText(value).html).toBe(html)
    }))
  })
})
