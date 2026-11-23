/**
 * Stage 5 of the import pipeline: inline content to a
 * `RichTextValue`, reading both elements (`<b>`) and styles
 * (`font-weight: 700`), colours mapped to the palette (stage 6). Only formats
 * the registry knows come out; validation checks their attributes again.
 */
import { type LegacyRules, cleanStyle, joinStyle, keepClasses } from '../model/legacy'
import { type FormatRange, type FormatRegistry, type Mark, type RichTextValue, OBJECT_CHAR, attrsKey, normalize } from '../model/richtext'
import { safeUrl } from '../model/url'
import type { ImportSource, Reporter } from './report'
import { type PaletteEntry, boldness, firstFamily, fontElementSizePx, fontSizePx, isDefaultInk, isMonospace, nearestColor, parseColor, parseStyle } from './style'

/** A host class that stands for something in the document (TinyMCE: "host-specific classes"). */
export type ClassMapping =
  | { readonly format: string; readonly attrs?: Readonly<Record<string, string>> }
  | { readonly block: string; readonly attrs?: Readonly<Record<string, unknown>> }
  | 'drop'

/** What one import shares between its stages. */
export interface ImportState {
  readonly source: ImportSource
  readonly formats: FormatRegistry
  readonly palette: readonly PaletteEntry[]
  readonly report: Reporter
  /** Proza's own output: whitespace is exactly the text, nothing to collapse. */
  readonly exact: boolean
  /** The language most of the text is in, lowercased; text in it needs no language span. */
  readonly lang: string
  readonly classes: Readonly<Record<string, ClassMapping>>
  /** The host keeps legacy HTML (decision 0020); null otherwise. */
  readonly legacy: LegacyRules | null
  /** Justified text is kept (the host offers it). */
  readonly justify?: boolean
  /** Characters by font size (px) of the block being read; null for unstyled text. */
  sizes: Map<number | null, number>
  readonly fonts: Set<string>
}

/** What an element passes down to its content. */
export interface Inherit {
  readonly marks: ReadonlyMap<string, Mark>
  readonly px: number | null
  readonly pre: boolean
  /** The language of the text here, lowercased; `base` is the block's, which needs no language span. */
  readonly lang: string
  readonly base: string
}

export const ROOT_INHERIT: Inherit = { marks: new Map(), px: null, pre: false, lang: '', base: '' }

/** Elements whose content is never text: dropped silently. */
export const SILENT_DROP = new Set(['script', 'style', 'template', 'head', 'title', 'meta', 'link', 'base', 'noscript', 'xml'])
/** Elements dropped with their content, which the report names. */
export const REPORTED_DROP = new Set(['svg', 'math', 'object', 'embed', 'applet', 'canvas', 'select', 'textarea', 'button', 'map', 'frame', 'frameset', 'iframe', 'video', 'audio'])

/** Elements that start a new line in flowing text. */
export const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'center', 'details', 'dialog', 'dd', 'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure',
  'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'li', 'main', 'menu', 'nav', 'ol', 'p', 'pre', 'section',
  'summary', 'table', 'tbody', 'thead', 'tfoot', 'tr', 'td', 'th', 'caption', 'ul', 'legend', 'picture', 'body',
])

/** Properties the reader turns into formats (bold, italic, underline, sub- and superscript) or whitespace, never into a kept style. */
const FORMAT_PROPS = new Set(['font-weight', 'font-style', 'text-decoration', 'text-decoration-line', 'vertical-align', 'white-space', 'font'])

/** Properties text inherits from its box, which a span may carry for an unwrapped box. */
const INHERITED = new Set(['color', 'font-size', 'font-family', 'font-variant', 'letter-spacing', 'word-spacing', 'text-transform', 'line-height', 'direction'])

/** `<font size>` as the CSS keywords it stands for. */
const FONT_SIZES = ['x-small', 'small', 'medium', 'large', 'x-large', 'xx-large', 'xxx-large']

/** Office namespaces (`o:p`, `v:shape`, `w:sdt`) carry no text of their own worth keeping, except through their children. */
const OFFICE = /^(?:o|v|w|m|st1):/

/** The note of a footnote reference found by the footnote pass (cleanup.ts). */
export const NOTE_TAG = 'pz-note'
/** A tab between the cells of a table row kept as text (cleanup.ts). */
export const TAB_TAG = 'pz-tab'

interface Char { readonly c: string; readonly marks: ReadonlyMap<string, Mark>; readonly object?: Mark }

export class InlineReader {
  readonly #st: ImportState
  #chars: Char[] = []

  constructor(state: ImportState) { this.#st = state }

  /** Rich text of `nodes`, each read with the inheritance its ancestors gave. */
  read(nodes: Iterable<Node>, inherit: Inherit, preformatted = false): RichTextValue {
    this.#chars = []
    const inh = preformatted ? { ...inherit, pre: true } : inherit
    for (const n of nodes) this.#node(n, inh)
    // Whether the edges are trimmed follows the block (a <pre>), not styles inside it (Google Docs marks every run `white-space: pre`).
    if (preformatted) {
      // Kept exactly.
    } else if (this.#st.exact) {
      // A last <br> shows no line of its own; Proza's renderer doubles it for that reason.
      if (this.#chars.at(-1)?.c === '\n') this.#chars.pop()
    } else {
      // Foreign text: blank lines at the edges of a block are spacing, not content.
      while (this.#chars.at(-1)?.c === ' ' || this.#chars.at(-1)?.c === '\n') this.#chars.pop()
      let lead = 0
      while (this.#chars[lead]?.c === '\n' || this.#chars[lead]?.c === ' ') lead++
      if (lead > 0) this.#chars.splice(0, lead)
    }
    return this.#value()
  }

  #value(): RichTextValue {
    const chars = this.#chars
    let text = ''
    const ranges: FormatRange[] = []
    const open = new Map<string, { mark: Mark; start: number }>()
    const close = (key: string, end: number): void => {
      const r = open.get(key)!
      ranges.push(r.mark.attrs ? { type: r.mark.type, start: r.start, end, attrs: r.mark.attrs } : { type: r.mark.type, start: r.start, end })
      open.delete(key)
    }
    chars.forEach((ch, i) => {
      text += ch.c
      const keys = new Set<string>()
      for (const m of ch.marks.values()) {
        const key = `${m.type}\u0000${attrsKey(m.attrs)}`
        keys.add(key)
        if (!open.has(key)) open.set(key, { mark: m, start: i })
      }
      for (const key of [...open.keys()]) if (!keys.has(key)) close(key, i)
      if (ch.object) ranges.push(ch.object.attrs ? { type: ch.object.type, start: i, end: i + 1, attrs: ch.object.attrs } : { type: ch.object.type, start: i, end: i + 1 })
    })
    for (const key of [...open.keys()]) close(key, chars.length)
    return normalize({ text, formats: ranges }, this.#st.formats)
  }

  #push(c: string, inh: Inherit): void {
    this.#chars.push({ c, marks: inh.marks })
    // Subscripts and superscripts are smaller by nature; their size says nothing about the block's.
    if ((c.trim() !== '' || c === '\u00a0') && !inh.marks.has('subscript') && !inh.marks.has('superscript')) this.#st.sizes.set(inh.px, (this.#st.sizes.get(inh.px) ?? 0) + 1)
  }

  #text(raw: string, inh: Inherit): void {
    // U+FFFC stands for an inline object in a value; in a source's text it is a stray character that nothing would back.
    const data = raw.includes(OBJECT_CHAR) ? raw.replaceAll(OBJECT_CHAR, '') : raw
    // By UTF-16 unit, as format offsets count: an emoji is two.
    if (inh.pre || this.#st.exact) {
      const raw = data.replace(/\r\n?/g, '\n')
      for (let i = 0; i < raw.length; i++) this.#push(raw[i]!, inh)
      return
    }
    const collapsed = data.replace(/[ \t\n\r\f]+/g, ' ')
    for (let i = 0; i < collapsed.length; i++) {
      const c = collapsed[i]!
      if (c === ' ') {
        const last = this.#chars.at(-1)?.c
        if (last === undefined || last === ' ' || last === '\n') continue
      }
      this.#push(c, inh)
    }
  }

  #break(inh: Inherit): void {
    if (!inh.pre && !this.#st.exact) while (this.#chars.at(-1)?.c === ' ') this.#chars.pop()
    this.#push('\n', inh)
  }

  /** A block element inside flowing text starts and ends a line. */
  #boundary(inh: Inherit): void {
    const last = this.#chars.at(-1)?.c
    if (last !== undefined && last !== '\n') this.#break(inh)
  }

  #object(mark: Mark, inh: Inherit): void {
    this.#chars.push({ c: OBJECT_CHAR, marks: inh.marks, object: mark })
  }

  #node(n: Node, inh: Inherit): void {
    if (n.nodeType === 3) { this.#text((n as Text).data, inh); return }
    if (n.nodeType !== 1) return
    const el = n as Element
    const tag = el.localName
    if (SILENT_DROP.has(tag) || (OFFICE.test(tag) && tag !== 'o:p')) return
    if (REPORTED_DROP.has(tag)) { this.#st.report.add('element', tag); return }
    if (this.#mapped(el) === 'drop') return
    switch (tag) {
      case 'br':
        if (el.classList.contains('Apple-interchange-newline')) return
        this.#break(inh)
        return
      case 'wbr': if (this.#st.legacy && this.#st.formats.has('wbr')) this.#object({ type: 'wbr' }, inh); return
      case TAB_TAG: this.#push('\t', inh); return
      case 'input': return
      case 'img': this.#image(el, inh); return
      case 'a': if (this.#anchor(el, inh)) return; break
      case 'i': case 'span': if (this.#icon(el, inh)) return; break
      case NOTE_TAG: {
        const note = el.getAttribute('note') ?? ''
        if (note.trim() !== '' && this.#st.formats.has('footnote')) this.#object({ type: 'footnote', attrs: { note } }, inh)
        return
      }
    }
    const next = this.styled(el, inh)
    const block = BLOCK_TAGS.has(tag)
    if (block) this.#boundary(inh)
    for (const c of el.childNodes) this.#node(c, next)
    if (block) this.#boundary(inh)
  }

  #image(el: Element, inh: Inherit): void {
    const raw = el.getAttribute('src') ?? ''
    const src = /^\s*(?:data|file|blob|cid|webkit-fake-url):/i.test(raw) ? null : safeUrl(raw)
    if (!src || !this.#st.formats.has('image')) { this.#st.report.add('image-dropped', el.getAttribute('alt') ?? raw.slice(0, 40)); return }
    const attrs: Record<string, string> = { src, alt: el.getAttribute('alt') ?? '' }
    for (const k of ['width', 'height'] as const) {
      const v = el.getAttribute(k)
      if (v && /^[1-9]\d{0,4}$/.test(v.trim())) attrs[k] = v.trim()
    }
    const lg = this.#st.legacy
    if (lg) {
      const style = cleanStyle(el.getAttribute('style'), lg.style)
      const cls = this.#hostClasses(el)
      const title = el.getAttribute('title')
      if (style !== '') attrs.style = style
      if (cls !== '') attrs.class = cls
      if (title) attrs.title = title
    }
    this.#object({ type: 'image', attrs }, inh)
  }

  /** Legacy HTML: a link without an address that names a place (`<a name="top">`) is an anchor; its content follows. */
  #anchor(el: Element, inh: Inherit): boolean {
    if (!this.#st.legacy || !this.#st.formats.has('anchor') || (el.getAttribute('href') ?? '').trim() !== '') return false
    const name = el.getAttribute('name') ?? el.getAttribute('id') ?? ''
    if (!/^[A-Za-z][\w:.-]{0,99}$/.test(name)) return false
    this.#object({ type: 'anchor', attrs: { name } }, inh)
    const next = this.styled(el, inh)
    for (const c of el.childNodes) this.#node(c, next)
    return true
  }

  /** Legacy HTML: an empty element with the host's classes is an icon (`<i class="fa fa-file"></i>`). */
  #icon(el: Element, inh: Inherit): boolean {
    if (!this.#st.legacy || el.childNodes.length > 0) return false
    const type = el.localName === 'i' ? 'icon' : 'marker'
    const cls = this.#hostClasses(el)
    if (cls === '' || !this.#st.formats.has(type)) return false
    this.#object({ type, attrs: { class: cls } }, inh)
    return true
  }

  /** The element's classes the legacy policy keeps, without those the host maps to a format or block. */
  #hostClasses(el: Element): string {
    const lg = this.#st.legacy
    if (!lg) return ''
    return keepClasses([...el.classList].filter((c) => this.#st.classes[c] === undefined).join(' '), lg.className)
  }

  #mapped(el: Element): ClassMapping | undefined {
    for (const c of el.classList) {
      const m = this.#st.classes[c]
      if (m) return m
    }
    return undefined
  }

  /**
   * What `el` gives its content: formats from its tag, attributes, classes and styles; size; whitespace; language.
   * `own`: the element is a part that keeps its legacy style itself, so its kept properties do not pass to the text.
   */
  styled(el: Element, inh: Inherit, own = false): Inherit {
    const tag = el.localName
    const st = this.#st
    const lg = st.legacy
    const marks = new Map(inh.marks)
    const add = (type: string, attrs?: Readonly<Record<string, string>>): void => {
      if (!st.formats.has(type)) return
      marks.set(type, attrs && Object.keys(attrs).length > 0 ? { type, attrs } : { type })
    }
    // Legacy HTML: styles and classes of inline elements collect on one span format, inner ones winning.
    const spanStyle = new Map<string, string>()
    const spanClasses: string[] = []
    const keepStyle = (prop: string, value: string): boolean => {
      // A box's own look (its border, its background) is not its text's: only what text inherits passes from a box to a span.
      if (!lg || own || !lg.style(prop) || (BLOCK_TAGS.has(tag) && !INHERITED.has(prop))) return false
      spanStyle.set(prop, value)
      return true
    }
    switch (tag) {
      case 'b': case 'strong': add('bold'); break
      case 'i': case 'em': case 'cite': case 'var': case 'dfn': case 'address': add('italic'); break
      case 'u': add('underline'); break
      case 's': case 'strike': case 'del': add('strikethrough'); break
      case 'sub': add('subscript'); break
      case 'sup': add('superscript'); break
      case 'code': case 'tt': case 'samp': add('code'); break
      case 'kbd': add('kbd'); break
      case 'mark': {
        const preset = [...el.classList].find((c) => c.startsWith('pz-highlight-'))?.slice('pz-highlight-'.length)
        add('highlight', preset ? { color: preset } : undefined)
        break
      }
      case 'abbr': case 'acronym': {
        const title = el.getAttribute('title')
        if (title) add('abbr', { title })
        break
      }
      case 'a': {
        const href = el.getAttribute('href')
        if (href === null || href.trim() === '') break
        const safe = safeUrl(href)
        if (safe === null) { st.report.add('link', href.slice(0, 40)); break }
        const attrs: Record<string, string> = el.getAttribute('target') === '_blank' ? { href: safe, target: '_blank' } : { href: safe }
        if (lg) {
          const title = el.getAttribute('title')
          const cls = this.#hostClasses(el)
          if (title) attrs.title = title
          if (cls !== '') attrs.class = cls
        }
        add('link', attrs)
        break
      }
      case 'font': {
        const color = el.getAttribute('color')
        if (color && !keepStyle('color', color)) this.#color(color, marks)
        const face = el.getAttribute('face')
        if (face && !keepStyle('font-family', face)) this.#family(face, marks)
        const size = el.getAttribute('size')?.trim() ?? ''
        const n = /^[1-7]$/.test(size) ? Number(size) : /^[+-][1-7]$/.test(size) ? Math.max(1, Math.min(7, 3 + Number(size))) : 0
        if (n > 0) keepStyle('font-size', FONT_SIZES[n - 1]!)
        break
      }
      case 'span': {
        const unknown = el.getAttribute('data-pz-format')
        if (unknown && /^[a-z][a-z0-9-]*$/.test(unknown) && !st.formats.has(unknown)) marks.set(unknown, { type: unknown })
        break
      }
    }
    for (const c of el.classList) {
      if (c.startsWith('pz-color-') && tag === 'span') add('color', { color: c.slice('pz-color-'.length) })
      const m = st.classes[c]
      if (m && m !== 'drop' && 'format' in m) add(m.format, m.attrs)
    }
    if (lg && !own && tag !== 'a' && !BLOCK_TAGS.has(tag)) {
      const cls = this.#hostClasses(el)
      if (cls !== '') spanClasses.push(cls)
    }
    const lang = el.getAttribute('lang')?.trim().toLowerCase() ?? ''
    let inLang = inh.lang
    // Proza's own spans are exactly the language formats; foreign ones only where the language changes.
    if (lang !== '' && (st.exact || lang !== (inh.lang || inh.base || st.lang)) && !BLOCK_TAGS.has(tag)) {
      inLang = lang
      if (!st.exact && lang === (inh.base || st.lang)) marks.delete('lang')
      else {
        const dir = el.getAttribute('dir')
        add('lang', dir === 'rtl' || dir === 'ltr' ? { lang: el.getAttribute('lang')!.trim(), dir } : { lang: el.getAttribute('lang')!.trim() })
      }
    }
    let px = inh.px
    let pre = inh.pre || tag === 'pre' || tag === 'xmp' || tag === 'listing' || tag === 'textarea'
    if (tag === 'font') {
      const size = el.getAttribute('size')
      const fpx = size ? fontElementSizePx(size) : null
      if (fpx !== null) px = fpx
    }
    const style = parseStyle(el.getAttribute('style'))
    for (const [prop, value] of style) {
      // A part keeps its own declarations; whitespace still shapes how its text reads.
      if (own && lg?.style(prop) && prop !== 'white-space') continue
      if (lg && !FORMAT_PROPS.has(prop)) {
        // Legacy HTML: a declaration is kept as it is or not at all, never mapped to a palette or a preset.
        if (!keepStyle(prop, value) && !own && !lg.style(prop) && !BLOCK_TAGS.has(tag)) st.report.add('style', prop)
        continue
      }
      switch (prop) {
        case 'font-weight': {
          const b = boldness(value)
          if (b === true) add('bold'); else if (b === false) marks.delete('bold')
          break
        }
        case 'font-style':
          if (/^(?:italic|oblique)/i.test(value)) add('italic'); else if (/^normal/i.test(value)) marks.delete('italic')
          break
        case 'text-decoration': case 'text-decoration-line': {
          const v = value.toLowerCase()
          if (/\bnone\b/.test(v)) { marks.delete('underline'); marks.delete('strikethrough') }
          // A link's underline (and colour, below) is how links look, not a format of the words.
          if (/\bunderline\b/.test(v) && tag !== 'a' && !marks.has('link')) add('underline')
          if (/\bline-through\b/.test(v)) add('strikethrough')
          break
        }
        case 'vertical-align': {
          const v = value.toLowerCase()
          if (v === 'super') { marks.delete('subscript'); add('superscript') } else if (v === 'sub') { marks.delete('superscript'); add('subscript') } else if (v === 'baseline') { marks.delete('subscript'); marks.delete('superscript') }
          break
        }
        case 'color': if (tag !== 'a' && !marks.has('link')) this.#color(value, marks); break
        case 'background-color': case 'background': case 'mso-highlight': this.#background(value, marks); break
        case 'font-family': this.#family(value, marks); break
        case 'font': {
          // The shorthand: `bold 12pt Arial`. Only weight and style are worth reading here.
          if (/\b(?:bold|[6-9]00)\b/i.test(value)) add('bold')
          if (/\bitalic\b/i.test(value)) add('italic')
          break
        }
        case 'font-size': {
          const s = fontSizePx(value, inh.px ?? 16)
          if (s !== null) px = s
          break
        }
        case 'white-space': pre = /^(?:pre|pre-wrap|break-spaces)\b/i.test(value) || (pre && !/^normal|nowrap/i.test(value)); break
        case 'text-transform': if (!/^none/i.test(value)) st.report.add('style', `text-transform: ${value}`); break
        case 'font-variant': if (/small-caps/i.test(value)) st.report.add('style', 'font-variant: small-caps'); break
      }
    }
    if (spanStyle.size > 0 || spanClasses.length > 0) this.#span(marks, spanStyle, spanClasses)
    return { marks, px, pre, lang: inLang, base: inh.base }
  }

  /** The inherited legacy span joined with this element's styles and classes. */
  #span(marks: Map<string, Mark>, style: ReadonlyMap<string, string>, classes: readonly string[]): void {
    const lg = this.#st.legacy
    if (!lg || !this.#st.formats.has('span')) return
    const before = marks.get('span')?.attrs
    const decls = new Map(parseStyle(before?.style ?? null))
    for (const [k, v] of style) { decls.delete(k); decls.set(k, v) }
    const css = cleanStyle(joinStyle(decls), lg.style)
    const cls = [...new Set([...(before?.class ?? '').split(' '), ...classes.flatMap((c) => c.split(' '))].filter((c) => c !== ''))].join(' ')
    const attrs: Record<string, string> = {}
    if (css !== '') attrs.style = css
    if (cls !== '') attrs.class = cls
    if (Object.keys(attrs).length > 0) marks.set('span', { type: 'span', attrs })
    else marks.delete('span')
  }

  #color(value: string, marks: Map<string, Mark>): void {
    const st = this.#st
    if (!st.formats.has('color')) return
    const c = parseColor(value)
    if (c === null) return
    if (c === 'default' || c === 'transparent' || isDefaultInk(c)) { marks.delete('color'); return }
    const name = nearestColor(c, st.palette)
    if (name === null) { st.report.add('color', value); marks.delete('color'); return }
    const exact = st.palette.find((p) => p.name === name)?.color.toLowerCase() === value.trim().toLowerCase()
    if (!exact) st.report.add('color-matched', `${value} → ${name}`)
    marks.set('color', { type: 'color', attrs: { color: name } })
  }

  #background(value: string, marks: Map<string, Mark>): void {
    if (!this.#st.formats.has('highlight')) return
    // `background` may be a shorthand: its first colour-looking word counts.
    const word = words(value).find((w) => parseColor(w) !== null) ?? value
    const c = parseColor(word)
    if (c === null) return
    if (c === 'transparent' || c === 'default') { marks.delete('highlight'); return }
    const [r, g, b] = c
    // White behind text is the page, not a highlight.
    if (r > 245 && g > 245 && b > 245) { marks.delete('highlight'); return }
    if (!marks.has('highlight')) marks.set('highlight', { type: 'highlight' })
  }

  #family(value: string, marks: Map<string, Mark>): void {
    if (isMonospace(value)) {
      if (this.#st.formats.has('code')) marks.set('code', { type: 'code' })
      return
    }
    const name = firstFamily(value)
    if (name === '' || /^(?:inherit|initial|serif|sans-serif|system-ui|unset)$/i.test(name) || this.#st.exact) return
    if (!this.#st.fonts.has(name.toLowerCase())) {
      this.#st.fonts.add(name.toLowerCase())
      this.#st.report.add('font', name)
    }
  }
}

/** Words of a CSS value split at spaces outside parentheses (`url(a b) red` is two words), in one pass. */
export function words(value: string): string[] {
  const out: string[] = []
  let depth = 0, word = ''
  for (const c of value) {
    if (c === '(') depth++
    else if (c === ')') depth = Math.max(0, depth - 1)
    if (depth === 0 && /\s/.test(c)) { if (word !== '') out.push(word); word = '' } else word += c
  }
  if (word !== '') out.push(word)
  return out
}
