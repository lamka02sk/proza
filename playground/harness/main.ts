/**
 * Property tests that need a real DOM, so they run in each browser engine
 * through Playwright (tests/e2e/dom-properties.spec.ts), not in Node.
 */
import '../../src/richtext/richtext.css'
import fc from 'fast-check'
import { OBJECT_CHAR, normalize, valuesEqual, type FormatRange, type RichTextValue } from '../../src/model/richtext'
import { domPointToOffset, fromDom, offsetToDomPoint, textFromDom, toDom } from '../../src/richtext/dom'
import { richText } from '../../src/render/render'

const O = OBJECT_CHAR
const TYPES = ['bold', 'italic', 'underline', 'code', 'kbd', 'link', 'superscript', 'highlight', 'color', 'lang', 'abbr'] as const
const ATTRS: Partial<Record<(typeof TYPES)[number], fc.Arbitrary<Record<string, string>>>> = {
  link: fc.constantFrom({ href: 'https://a.example/' }, { href: '/b' }, { href: '#c', target: '_blank' }),
  highlight: fc.constantFrom({}, { color: 'yellow' }),
  color: fc.constantFrom({ color: 'accent' }, { color: 'muted-2' }),
  lang: fc.constantFrom({ lang: 'de' }, { lang: 'he', dir: 'rtl' }),
  abbr: fc.constantFrom({ title: 'Hypertext <Markup> & "Language"' }),
}
const OBJECTS = [
  { type: 'image', attrs: { src: '/a.png', alt: 'A' } },
  { type: 'image', attrs: { src: '/b.png', alt: '', width: '16', height: '16' } },
  { type: 'footnote', attrs: { note: 'A note & more' } },
] as const
const arbText = fc.string({ unit: fc.constantFrom('a', 'b', ' ', '  ', '\n', 'é', '😀', '<', '&', O), maxLength: 30 })
const arbValue: fc.Arbitrary<RichTextValue> = arbText.chain((text) =>
  fc.tuple(
    fc.array(
      fc.record({ type: fc.constantFrom(...TYPES), start: fc.nat(text.length), end: fc.nat(text.length) }).chain(({ type, start, end }) => {
        const attrs = ATTRS[type]
        return attrs ? attrs.map((a): FormatRange => ({ type, start, end, attrs: a })) : fc.constant<FormatRange>({ type, start, end })
      }),
      { maxLength: 6 },
    ),
    // Every U+FFFC gets an object, so the value is what validation would produce.
    fc.array(fc.constantFrom(...OBJECTS), { minLength: text.length, maxLength: text.length }),
  ).map(([formats, objects]) => normalize({
    text,
    formats: [...formats, ...objects.flatMap((o, i) => (text[i] === O ? [{ type: o.type, start: i, end: i + 1, attrs: o.attrs }] : []))],
  })),
)

const root = document.querySelector<HTMLElement>('#root')!

function render(v: RichTextValue): void {
  root.replaceChildren(toDom(v, document))
}

function run(name: string, prop: fc.IPropertyWithHooks<[RichTextValue]> | fc.IProperty<[RichTextValue]>, runs: number): string | null {
  const r = fc.check(prop, { numRuns: runs })
  return r.failed ? `${name}: ${fc.defaultReportMessage(r) ?? 'failed'}` : null
}

const harness = {
  /** Each check returns null or a failure message. */
  check(runs = 300): string[] {
    const failures = [
      run('fromDom(toDom(v)) equals v', fc.property(arbValue, (v) => {
        render(v)
        return valuesEqual(fromDom(root), v) && textFromDom(root) === v.text
      }), runs),
      run('toDom is deterministic', fc.property(arbValue, (v) => {
        render(v)
        const a = root.innerHTML
        render(normalize({ text: v.text, formats: [...v.formats].reverse() }))
        return a === root.innerHTML
      }), runs),
      // Footnotes differ by design: the field shows a CSS-counted marker, the output a numbered link.
      run('published HTML is the field DOM without its padding', fc.property(arbValue, (v) => {
        if (v.formats.some((f) => f.type === 'footnote')) return true
        render(v)
        // The field pads an empty value; the output pads only a trailing line break, as a plain <br>.
        const field = root.innerHTML.replace('<br data-pz-pad="">', v.text === '' ? '' : '<br>')
        return field === richText(v).html
      }), runs),
      run('offset to DOM point and back is the identity', fc.property(arbValue, (v) => {
        render(v)
        for (let o = 0; o <= v.text.length; o++) {
          const p = offsetToDomPoint(root, o)
          if (domPointToOffset(root, p.node, p.offset) !== o) return false
        }
        return true
      }), runs),
      run('every DOM point maps inside the text', fc.property(arbValue, (v) => {
        render(v)
        const walker = document.createTreeWalker(root)
        for (let n: Node | null = root; n; n = walker.nextNode()) {
          const max = n.nodeType === 3 ? (n as Text).data.length : n.childNodes.length
          for (let i = 0; i <= max; i++) {
            const o = domPointToOffset(root, n, i)
            if (o === null || o < 0 || o > v.text.length) return false
          }
        }
        return true
      }), runs),
    ]
    return failures.filter((f): f is string => f !== null)
  },
}

declare global { interface Window { __harness?: typeof harness } }
window.__harness = harness
