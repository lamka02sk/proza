/**
 * Generators for the import properties:
 * documents of the core blocks in their canonical form (what `import(render(doc))`
 * can give back exactly), and arbitrary foreign HTML.
 */
import fc from 'fast-check'
import { OBJECT_CHAR, type FormatRange, type RichTextValue, normalize } from '../../../src/model/richtext'

const O = OBJECT_CHAR

export interface GenBlock { type: string; attrs: Record<string, unknown>; children?: GenBlock[] }

const unit = fc.constantFrom('a', 'b', 'Ž', ' ', '  ', '\n', 'é', '😀', '<', '&', '"', '\u00a0', O)
const plainUnit = fc.constantFrom('a', 'b', 'Ž', ' ', 'é', '<', '&')

const FORMATS = ['bold', 'italic', 'underline', 'strikethrough', 'subscript', 'superscript', 'code', 'kbd', 'link', 'highlight', 'color', 'lang', 'abbr'] as const
const ATTRS: Partial<Record<(typeof FORMATS)[number], fc.Arbitrary<Record<string, string>>>> = {
  link: fc.constantFrom({ href: 'https://a.example/' }, { href: '/b?c=1&d=2' }, { href: '#top', target: '_blank' }, { href: 'mailto:x@a.example' }),
  highlight: fc.constantFrom({}, { color: 'yellow' }),
  color: fc.constantFrom({ color: 'grey' }, { color: 'blue' }),
  lang: fc.constantFrom({ lang: 'de' }, { lang: 'he', dir: 'rtl' }, { lang: 'sk' }),
  abbr: fc.constantFrom({ title: 'Hypertext <Markup> & "Language"' }),
}
const OBJECTS = [
  { type: 'image', attrs: { src: '/a.png', alt: 'A' } },
  { type: 'image', attrs: { src: '/b.png', alt: '', width: '16', height: '16' } },
  { type: 'footnote', attrs: { note: 'A note & more' } },
  { type: 'footnote', attrs: { note: 'Second <note>' } },
] as const

function richText(text: fc.Arbitrary<string>, formats = true): fc.Arbitrary<RichTextValue> {
  return text.chain((t) => {
    if (!formats) return fc.constant(normalize({ text: t.replaceAll(O, ''), formats: [] }))
    return fc.tuple(
      fc.array(fc.record({ type: fc.constantFrom(...FORMATS), start: fc.nat(t.length), end: fc.nat(t.length) }).chain(({ type, start, end }) => {
        const attrs = ATTRS[type]
        return attrs ? attrs.map((a): FormatRange => ({ type, start, end, attrs: a })) : fc.constant<FormatRange>({ type, start, end })
      }), { maxLength: 5 }),
      fc.array(fc.constantFrom(...OBJECTS), { minLength: t.length, maxLength: t.length }),
    ).map(([fs, objects]) => normalize({
      text: t,
      formats: [...fs, ...objects.flatMap((o, i) => (t[i] === O ? [{ type: o.type, start: i, end: i + 1, attrs: o.attrs }] : []))],
    }))
  })
}

const text = fc.string({ unit, maxLength: 24 })
const rt = richText(text)
const plainRt = richText(fc.string({ unit: plainUnit, maxLength: 12 }), false)
const anchor = fc.constantFrom('', '', '', 'intro', 'part-2')
const lang = fc.constantFrom('', '', 'de', 'sk')
const dir = fc.constantFrom('', '', 'rtl', 'ltr')
const textAlign = fc.constantFrom('', '', 'start', 'center', 'end')
const size = fc.constantFrom('', '', 's', 'l')
const color = fc.constantFrom('', '', 'grey', 'blue')

const paragraph = fc.record({ content: rt, anchor, textAlign, lang, dir, size, color })
  .map((attrs): GenBlock => ({ type: 'core/paragraph', attrs }))
const heading = fc.record({ content: rt, level: fc.constantFrom(1, 2, 3, 4, 5, 6), anchor, textAlign, lang, dir, color })
  .map((attrs): GenBlock => ({ type: 'core/heading', attrs }))
const code = fc.record({ content: richText(fc.string({ unit: fc.constantFrom('a', ' ', '\n', '<', '{', '}'), maxLength: 20 }), false), language: fc.constantFrom('', 'js', 'c++') })
  .map((attrs): GenBlock => ({ type: 'core/code', attrs }))
const preformatted = fc.record({ content: rt, lang, dir }).map((attrs): GenBlock => ({ type: 'core/preformatted', attrs }))
const separator = fc.constant<GenBlock>({ type: 'core/separator', attrs: {} })

const { list } = fc.letrec<{ list: GenBlock; item: GenBlock }>((tie) => ({
  list: fc.record({
    style: fc.constantFrom('bullet', 'number', 'check'),
    numbering: fc.constantFrom('1', 'a', 'I'),
    start: fc.constantFrom(1, 3),
    reversed: fc.boolean(),
    lang, color, size,
    items: fc.array(tie('item'), { minLength: 1, maxLength: 3 }),
  }).map(({ items, ...a }): GenBlock => {
    const numbered = a.style === 'number'
    const attrs = { ...a, numbering: numbered ? a.numbering : '1', start: numbered ? a.start : 1, reversed: numbered && a.reversed }
    // A checked box shows only in a checklist.
    const children = items.map((i) => (a.style === 'check' ? i : { ...i, attrs: { ...i.attrs, checked: false } }))
    return { type: 'core/list', attrs, children }
  }),
  item: fc.record({
    content: rt, checked: fc.boolean(), lang,
    nested: fc.oneof({ depthSize: 'small' }, fc.constant([] as GenBlock[]), fc.array(tie('list'), { maxLength: 1 })),
  }).map(({ nested, ...attrs }): GenBlock => ({ type: 'core/list-item', attrs, children: nested })),
}))

const quote = fc.record({ citation: rt, anchor, lang, color, children: fc.array(fc.oneof(paragraph, heading, list), { minLength: 1, maxLength: 2 }) })
  .map(({ children, ...attrs }): GenBlock => ({ type: 'core/quote', attrs, children }))

const src = fc.constantFrom('/media/a.jpg', 'https://cdn.a.example/b.png', 'c.webp')
const imageAttrs = fc.record({
  src, alt: fc.constantFrom('', 'A red bicycle', 'Fish & <chips>'), decorative: fc.boolean(),
  width: fc.constantFrom('l', 'm', 's'), dims: fc.constantFrom([0, 0], [800, 600]),
  srcset: fc.constantFrom('', '/a-480.jpg 480w, /a.jpg 960w'), href: fc.constantFrom('', 'https://a.example/'),
  caption: rt, anchor: fc.constantFrom('', 'pic'), align: fc.constantFrom('', 'start', 'center', 'end'),
}).map(({ dims, ...a }) => ({ ...a, alt: a.decorative ? '' : a.alt, naturalWidth: dims[0], naturalHeight: dims[1] }))
const image = imageAttrs.map((attrs): GenBlock => ({ type: 'core/image', attrs }))
const gallery = fc.record({ columns: fc.constantFrom(2, 3, 4), caption: rt, images: fc.array(imageAttrs, { minLength: 1, maxLength: 3 }) })
  .map(({ images, ...attrs }): GenBlock => ({
    type: 'core/gallery', attrs,
    children: images.map((i) => ({ type: 'core/image', attrs: { ...i, width: 'l', anchor: '' } })),
  }))
const video = fc.record({
  src: fc.constantFrom('/v.mp4'), poster: fc.constantFrom('', '/p.jpg'), track: fc.constantFrom(['', ''], ['/c.vtt', ''], ['/c.vtt', 'en']),
  dims: fc.constantFrom([0, 0], [1280, 720]), caption: rt, transcript: rt, anchor,
}).map(({ track, dims, ...a }): GenBlock => ({ type: 'core/video', attrs: { ...a, captions: track[0], captionsLang: track[1], naturalWidth: dims[0], naturalHeight: dims[1] } }))
const audio = fc.record({ src: fc.constantFrom('/a.mp3'), caption: rt, transcript: rt, anchor }).map((attrs): GenBlock => ({ type: 'core/audio', attrs }))
const embed = fc.oneof(
  fc.record({
    url: fc.constantFrom('https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://vimeo.com/76979871'),
    title: fc.constantFrom('', 'A song'), ratio: fc.constantFrom('16-9', '4-3', '1-1', '9-16'), facade: fc.boolean(), caption: rt, anchor,
  }),
  fc.record({ url: fc.constantFrom('https://maps.a.example/x'), title: fc.constantFrom('', 'A map'), anchor }),
).map((attrs): GenBlock => ({ type: 'core/embed', attrs }))
const file = fc.record({ href: fc.constantFrom('/files/prices%202026.pdf', 'https://a.example/b.zip'), name: fc.constantFrom('', 'Prices'), bytes: fc.constantFrom(0, 5, 48000, 1200000), anchor })
  .map((attrs): GenBlock => ({ type: 'core/file', attrs }))

// Layout and tables.
const bleed = fc.constantFrom('', '', 'wide', 'full')
const inner = fc.array(fc.oneof(paragraph, heading, list, image), { minLength: 1, maxLength: 2 })
const RATIO_COUNT = { '1-1': 2, '1-1-1': 3, '2-1': 2, '1-2': 2, '1-1-1-1': 4 } as const
const columns = fc.record({ ratio: fc.constantFrom(...(Object.keys(RATIO_COUNT) as (keyof typeof RATIO_COUNT)[])), anchor, bleed })
  .chain((attrs) => fc.array(inner, { minLength: RATIO_COUNT[attrs.ratio], maxLength: RATIO_COUNT[attrs.ratio] })
    .map((cols): GenBlock => ({ type: 'core/columns', attrs, children: cols.map((children) => ({ type: 'core/column', attrs: {}, children })) })))
const group = fc.record({ look: fc.constantFrom('', 'panel', 'line'), tag: fc.constantFrom('div', 'section', 'aside'), anchor, lang, bleed, children: inner })
  .map(({ children, ...attrs }): GenBlock => ({ type: 'core/group', attrs, children }))
const details = fc.record({ summary: plainRt.filter((v) => v.text.trim() !== ''), open: fc.boolean(), anchor, lang, children: fc.array(fc.oneof(paragraph, list), { minLength: 1, maxLength: 2 }) })
  .map(({ children, ...attrs }): GenBlock => ({ type: 'core/details', attrs, children }))
const button = fc.record({
  text: plainRt.filter((v) => v.text.trim() !== '' && v.text.trim() === v.text), href: fc.constantFrom('/book', 'https://a.example/x?y=1&z=2'),
  look: fc.constantFrom('fill', 'line'), newWindow: fc.boolean(), lang,
}).map((attrs): GenBlock => ({ type: 'core/button', attrs }))
const buttons = fc.record({ textAlign, anchor, children: fc.array(button, { minLength: 1, maxLength: 3 }) })
  .map(({ children, ...attrs }): GenBlock => ({ type: 'core/buttons', attrs, children }))
const spacer = fc.constantFrom('s', 'm', 'l', 'xl').map((height): GenBlock => ({ type: 'core/spacer', attrs: { height } }))
const table = fc.record({
  caption: plainRt, mode: fc.constantFrom('scroll', 'stack'), anchor, header: fc.boolean(),
  size: fc.tuple(fc.integer({ min: 1, max: 3 }), fc.integer({ min: 1, max: 3 })), align: textAlign,
}).chain(({ size: [rows, cols], header, align, ...attrs }) => fc.array(fc.array(plainRt, { minLength: cols, maxLength: cols }), { minLength: rows, maxLength: rows })
  .map((grid): GenBlock => ({
    type: 'core/table', attrs,
    children: grid.map((cells, r) => ({ type: 'core/table-row', attrs: {}, children: cells.map((content) => ({
      type: 'core/table-cell', attrs: { header: header && r === 0, scope: header && r === 0 ? 'col' : '', textAlign: r === 0 ? '' : align },
      // A cell of only spaces shows nothing, and comes back empty.
      children: [{ type: 'core/paragraph', attrs: { content: content.text.trim() === '' ? { text: '', formats: [] } : content } }],
    })) })),
  })))

export const arbBlocks: fc.Arbitrary<GenBlock[]> = fc.array(
  fc.oneof(
    paragraph, heading, list, quote, code, preformatted, separator, image, gallery, video, audio, embed, file, plainRt.map((content): GenBlock => ({ type: 'core/paragraph', attrs: { content } })),
    columns, group, details, buttons, spacer, table, fc.tuple(imageAttrs, bleed).map(([attrs, b]): GenBlock => ({ type: 'core/image', attrs: { ...attrs, bleed: b, width: b === '' ? attrs.width : 'l' } })),
  ),
  { minLength: 1, maxLength: 6 },
)

/** Only distinct anchors are a valid document; later repeats are cleared, as the editor does on paste. */
export function uniqueAnchors(blocks: GenBlock[]): GenBlock[] {
  const seen = new Set<string>()
  const walk = (list: GenBlock[]): GenBlock[] => list.map((b) => {
    const a = b.attrs.anchor
    const attrs = typeof a === 'string' && a !== '' ? (seen.has(a) ? { ...b.attrs, anchor: '' } : (seen.add(a), b.attrs)) : b.attrs
    return b.children ? { ...b, attrs, children: walk(b.children) } : { ...b, attrs }
  })
  return walk(blocks)
}

// ---------------------------------------------------------------------------
// Foreign HTML: anything a paste could hold.

const TAGS = ['p', 'div', 'span', 'b', 'i', 'u', 'em', 'strong', 'a', 'ul', 'ol', 'li', 'h1', 'h3', 'h7', 'table', 'tr', 'td', 'th', 'img', 'br',
  'blockquote', 'pre', 'code', 'font', 'o:p', 'sup', 'sub', 'figure', 'figcaption', 'iframe', 'video', 'script', 'style', 'svg', 'details',
  'summary', 'hr', 'mark', 'center', 'label', 'input', 'select', 'del', 'ins', 'section', 'x-custom', 'v:shape', 'picture', 'source', 'dl', 'dt', 'dd']
const STYLES = ['font-weight:700', 'font-weight:normal', 'font-style:italic', 'color:#ff0000', 'color:rgb(0, 0, 0)', 'background-color:yellow',
  'font-size:24pt', 'font-size:8px', 'text-align:center', 'text-align:justify', 'mso-list:l0 level2 lfo1', 'float:left', 'width:50%',
  'font-family:"Courier New"', 'vertical-align:super', 'text-decoration:underline line-through', 'white-space:pre', 'margin-left:40px', 'color:', ';;', 'x:"']
const ATTR_VALUES: fc.Arbitrary<[string, string]> = fc.oneof(
  fc.constantFrom(...STYLES).map((s): [string, string] => ['style', s]),
  fc.constantFrom('MsoNormal', 'MsoListParagraph', 'pz-image', 'pz-color-grey', 'mce-item', 'tox-checklist', 'language-js', 'x').map((c): [string, string] => ['class', c]),
  fc.constantFrom('https://a.example/', 'javascript:alert(1)', '#ftn1', '#_ftnref1', 'data:text/html,x', '//youtube.com/embed/dQw4w9WgXcQ').map((h): [string, string] => ['href', h]),
  fc.constantFrom('/a.png', 'file:///C:/x.png', 'data:image/png;base64,iVBORw0KGgo=', 'https://www.youtube.com/embed/dQw4w9WgXcQ', 'javascript:x').map((s): [string, string] => ['src', s]),
  fc.constantFrom('ftn1', '_ftnref1', 'top', '1bad').map((v): [string, string] => ['id', v]),
  fc.constantFrom('en', 'de', 'EN-US', '???').map((v): [string, string] => ['lang', v]),
  fc.constantFrom('true', 'false').map((v): [string, string] => ['aria-checked', v]),
  fc.constantFrom('1', '2', '9').map((v): [string, string] => ['aria-level', v]),
  fc.constantFrom('3', 'x').map((v): [string, string] => ['start', v]),
)
const escape = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;')

const { node } = fc.letrec<{ node: string; nodes: string }>((tie) => ({
  node: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    fc.string({ unit: fc.constantFrom('a', ' ', '\n', '\t', '\u00a0', 'Ž', '<', '&', '\uFFFC', '\u0000', '\r', '[1]'), maxLength: 8 }).map(escape),
    fc.constantFrom('<!-- c -->', '<![if !supportLists]>·<![endif]>', '&nbsp;', '<br>', '<p>&nbsp;</p>', '<!--[if gte mso 9]><xml></xml><![endif]-->'),
    fc.record({ tag: fc.constantFrom(...TAGS), attrs: fc.array(ATTR_VALUES, { maxLength: 3 }), inner: tie('nodes') })
      .map(({ tag, attrs, inner }) => `<${tag}${attrs.map(([k, v]) => ` ${k}="${escape(v)}"`).join('')}>${inner}</${tag}>`),
  ),
  nodes: fc.array(tie('node'), { maxLength: 4 }).map((l) => l.join('')),
}))

export const arbHtml: fc.Arbitrary<string> = fc.array(node, { maxLength: 6 }).map((l) => l.join(''))
