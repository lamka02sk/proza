/**
 * What an HTML round trip lost (decision 0020): the words, links, pictures,
 * frames, styles, classes and attributes of the source that the output no
 * longer has. A host keeping legacy HTML runs it over its stored records, the
 * source against `getHTML()` after loading it, to see what a save would change.
 *
 * Equivalent markup counts as kept: `<b>` and `<strong>`, `<font color>` and
 * `style="color: …"`, `align` and `text-align`. Only losses are listed; what the
 * output adds (`loading="lazy"`, `rel="noopener"`) is not. Both strings are
 * parsed into inert documents.
 */
import { parseStyle } from '../model/css'

export interface HtmlLoss {
  /** `text`: words; `element`: an element of meaning; `attribute`, `style`, `class`: on such an element. */
  readonly kind: 'text' | 'element' | 'attribute' | 'style' | 'class'
  /** What is missing: `strong`, `a[title=Report]`, `td{width: 30%}`, `span.note`, or a word. */
  readonly detail: string
  /** How many fewer the output has. */
  readonly count: number
}

/** Tags that are the same thing in output. */
const SAME: Readonly<Record<string, string>> = {
  b: 'strong', i: 'em', strike: 's', del: 's', tt: 'code', font: 'span', thead: 'tbody', tfoot: 'tbody', center: 'div', xmp: 'pre', listing: 'pre',
}

/** Elements whose presence means something on their own. Boxes (`div`, `span`) count when they carry a class or a style. */
const COUNTED = new Set([
  'a', 'img', 'iframe', 'table', 'caption', 'col', 'tr', 'td', 'th', 'ul', 'ol', 'li', 'dl', 'dt', 'dd', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'pre', 'strong', 'em', 'u', 's', 'sub', 'sup', 'code', 'kbd', 'mark', 'abbr', 'hr', 'figure', 'figcaption', 'section',
  'article', 'aside', 'nav', 'details', 'summary', 'form', 'input', 'select', 'textarea', 'button', 'video', 'audio', 'wbr',
])

/** Attributes whose value is content. Presentational ones become styles first. */
const VALUED = new Set(['href', 'src', 'alt', 'title', 'name', 'id', 'target', 'colspan', 'rowspan', 'start', 'type', 'lang', 'dir',
  'width', 'height', 'border', 'cellpadding', 'cellspacing', 'allow', 'allowfullscreen', 'frameborder', 'scope', 'span', 'value', 'action', 'method'])

/** Presentational attributes as the declarations they stand for. */
const AS_STYLE: Readonly<Record<string, (v: string) => [string, string] | null>> = {
  align: (v) => ['text-align', v.toLowerCase()],
  bgcolor: (v) => ['background-color', v],
  valign: (v) => ['vertical-align', v.toLowerCase()],
  color: (v) => ['color', v],
  face: (v) => ['font-family', v],
}

/** Tags whose `width` and `height` are presentational (styles), not the size of a picture or frame. */
const BOX_SIZE = new Set(['table', 'tr', 'td', 'th', 'col'])

const FONT_SIZES = ['x-small', 'small', 'medium', 'large', 'x-large', 'xx-large', 'xxx-large']

/** The element a declaration of a span stands for in output, if it is a format. */
function formatOf(prop: string, value: string): string | null {
  const v = value.trim().toLowerCase()
  if (prop === 'font-weight') return v === 'bold' || v === 'bolder' || Number(v) >= 600 ? 'strong' : null
  if (prop === 'font-style') return /^(?:italic|oblique)/.test(v) ? 'em' : null
  if (prop === 'text-decoration' || prop === 'text-decoration-line') return /\bunderline\b/.test(v) ? 'u' : /\bline-through\b/.test(v) ? 's' : null
  if (prop === 'vertical-align') return v === 'super' ? 'sup' : v === 'sub' ? 'sub' : null
  return null
}

type Bag = Map<string, number>

/** Elements that end a word where they start or stop, whatever the spaces around them. */
const BREAKS = /^(?:p|div|section|article|aside|header|footer|nav|main|h[1-6]|li|dt|dd|ul|ol|dl|table|caption|tr|td|th|tbody|thead|tfoot|figure|figcaption|blockquote|pre|br|hr|details|summary|form|center)$/

/** The text of `root` with a space where a block starts or ends, so neighbouring cells stay two words. */
function visibleText(root: Element): string {
  let out = ''
  const walk = (n: Node): void => {
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) { out += (c as Text).data; continue }
      if (c.nodeType !== 1) continue
      const edge = BREAKS.test((c as Element).localName)
      if (edge) out += ' '
      walk(c)
      if (edge) out += ' '
    }
  }
  walk(root)
  return out
}

function add(bag: Bag, key: string): void {
  bag.set(key, (bag.get(key) ?? 0) + 1)
}

const norm = (v: string): string => v.trim().replace(/\s+/g, ' ')

function features(html: string): { words: Bag; marks: Map<string, { kind: HtmlLoss['kind']; n: number }> } {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const words: Bag = new Map()
  const marks = new Map<string, { kind: HtmlLoss['kind']; n: number }>()
  const mark = (kind: HtmlLoss['kind'], detail: string): void => {
    const m = marks.get(detail)
    if (m) m.n++
    else marks.set(detail, { kind, n: 1 })
  }
  // A frame's content is what a browser without frames shows; nobody reads it.
  for (const s of doc.querySelectorAll('script, style, template, iframe, noscript')) s.replaceChildren()
  for (const w of visibleText(doc.body).split(/[\s\u00a0]+/)) if (w !== '') add(words, w)
  for (const el of doc.body.querySelectorAll('*')) {
    const raw = el.localName
    const icon = raw === 'i' && el.childNodes.length === 0 && el.classList.length > 0
    const tag = icon ? 'i' : SAME[raw] ?? raw
    const decls = new Map(parseStyle(el.getAttribute('style')))
    // A span's bold, italic, underline or shift is the element for it in output.
    if (raw === 'span' || raw === 'font') {
      for (const [k, v] of [...decls]) {
        const as = formatOf(k, v)
        if (as) { mark('element', as); decls.delete(k) }
      }
    }
    for (const [attr, toStyle] of Object.entries(AS_STYLE)) {
      const v = el.getAttribute(attr)
      if (v === null || (attr === 'color' && raw !== 'font') || (attr === 'face' && raw !== 'font')) continue
      const d = toStyle(v.trim())
      if (d && !decls.has(d[0])) decls.set(d[0], d[1])
    }
    if (raw === 'font') {
      const size = el.getAttribute('size')?.trim() ?? ''
      const n = /^[1-7]$/.test(size) ? Number(size) : /^[+-][1-7]$/.test(size) ? Math.max(1, Math.min(7, 3 + Number(size))) : 0
      if (n > 0) decls.set('font-size', FONT_SIZES[n - 1]!)
    }
    if (raw === 'center' && !decls.has('text-align')) decls.set('text-align', 'center')
    if (BOX_SIZE.has(raw)) {
      for (const k of ['width', 'height']) {
        const v = el.getAttribute(k)?.trim()
        if (v && !decls.has(k)) decls.set(k, /^\d+$/.test(v) ? `${v}px` : v)
      }
    }
    const classes = [...el.classList]
    const counted = COUNTED.has(tag) || ((tag === 'div' || tag === 'span' || tag === 'p') && (classes.length > 0 || decls.size > 0))
      || (tag === 'i' && classes.length > 0)
    // A paragraph counts when it holds text: one around a lifted frame or picture is layout.
    const text = tag === 'p' && /[^\s]|\u00a0/.test(el.textContent)
    if (counted || text) mark('element', tag)
    for (const c of classes) mark('class', `${tag}.${c}`)
    for (const [k, v] of decls) mark('style', `${tag}{${k}: ${norm(v).replace(/\s*!important$/i, '')}}`)
    for (const a of el.attributes) {
      const name = a.name.toLowerCase()
      if (!VALUED.has(name) || (BOX_SIZE.has(raw) && (name === 'width' || name === 'height'))) continue
      mark('attribute', `${tag}[${name}=${norm(a.value)}]`)
    }
  }
  return { words, marks }
}

/** What `after` lacks of `before`, most frequent first. Empty when nothing was lost. */
export function htmlLosses(before: string, after: string): HtmlLoss[] {
  const a = features(before), b = features(after)
  const out: HtmlLoss[] = []
  for (const [w, n] of a.words) {
    const lost = n - (b.words.get(w) ?? 0)
    if (lost > 0) out.push({ kind: 'text', detail: w, count: lost })
  }
  for (const [detail, { kind, n }] of a.marks) {
    const lost = n - (b.marks.get(detail)?.n ?? 0)
    if (lost > 0) out.push({ kind, detail, count: lost })
  }
  return out.sort((x, y) => y.count - x.count)
}
