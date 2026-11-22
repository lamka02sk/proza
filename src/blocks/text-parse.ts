/**
 * Parse rules of the core text blocks (`parse`):
 * Proza's own output exactly, so `import(render(doc))` gives the
 * document back, and the shapes other editors write.
 */
import type { ParseContext, ParseRule } from '../import/rules'
import type { RichTextValue } from '../model/richtext'

const EMPTY: RichTextValue = { text: '', formats: [] }

const LIST_STYLE: Readonly<Record<string, string>> = {
  decimal: '1', 'decimal-leading-zero': '1', 'lower-alpha': 'a', 'lower-latin': 'a', 'upper-alpha': 'A', 'upper-latin': 'A',
  'lower-roman': 'i', 'upper-roman': 'I',
}

function listStyleType(el: Element | null | undefined): string | null {
  const m = /(?:^|;)\s*list-style(?:-type)?\s*:\s*([a-z-]+)/i.exec(el?.getAttribute('style') ?? '')
  return m ? LIST_STYLE[m[1]!.toLowerCase()] ?? null : null
}

const checkbox = (li: Element): Element | null =>
  li.querySelector(':scope > input[type="checkbox"], :scope > label > input[type="checkbox"], :scope > p:first-child > input[type="checkbox"]')

/** Nested blocks of a list item that are not its text: lists, and pictures or quotes that must leave the list. */
const TEXT_FLOW = /^(?:p|div|span|label|h[1-6]|section|article|center|address|font|b|i|em|strong|a|dl|dt|dd)$/

export const paragraphParse: readonly ParseRule[] = [
  { selector: 'p', parse: (el, ctx) => ({ attrs: { ...ctx.supports(el), content: ctx.richText(el.childNodes) } }) },
]

export const headingParse: readonly ParseRule[] = [
  {
    selector: 'h1, h2, h3, h4, h5, h6',
    parse: (el, ctx) => ({ attrs: { ...ctx.supports(el), level: Number(el.localName[1]), content: ctx.richText(el.childNodes) } }),
  },
  {
    // Word for the web and other tools that mark a paragraph as a heading: before the paragraph rule.
    selector: '[role="heading"][aria-level]',
    priority: 55,
    parse: (el, ctx) => {
      const level = Number(el.getAttribute('aria-level'))
      return Number.isInteger(level) && level >= 1 && level <= 6 ? { attrs: { ...ctx.supports(el), level, content: ctx.richText(el.childNodes) } } : null
    },
  },
]

export const listParse: readonly ParseRule[] = [
  {
    selector: 'ul, ol, menu',
    parse: (el, ctx) => {
      const items = [...el.children].filter((c) => c.localName === 'li')
      const check = el.classList.contains('pz-checklist') || el.classList.contains('contains-task-list')
        || (items.length > 0 && items.every((li) => checkbox(li) !== null))
      const ordered = el.localName === 'ol'
      const type = el.getAttribute('type')
      const numbering = type && /^[1aAiI]$/.test(type) ? type : listStyleType(el) ?? listStyleType(items[0]) ?? '1'
      const start = Number.parseInt(el.getAttribute('start') ?? '', 10)
      return {
        attrs: {
          ...ctx.supports(el),
          style: check ? 'check' : ordered ? 'number' : 'bullet',
          numbering,
          start: Number.isFinite(start) ? start : 1,
          reversed: el.hasAttribute('reversed'),
        },
        children: el.childNodes,
      }
    },
  },
]

export const listItemParse: readonly ParseRule[] = [
  {
    selector: 'li',
    parse: (el, ctx) => {
      const box = checkbox(el)
      const text: Node[] = []
      const nested: Node[] = []
      for (const c of el.childNodes) {
        if (c.nodeType !== 1) { text.push(c); continue }
        const child = c as Element
        if (child.localName === 'ul' || child.localName === 'ol') nested.push(child)
        else if (child.localName === 'label' && box && child.contains(box)) text.push(...labelText(child, box))
        else if (ctx.blockish(child) && !TEXT_FLOW.test(child.localName)) nested.push(child)
        else text.push(child)
      }
      return { attrs: { ...ctx.supports(el), content: ctx.richText(text), checked: box?.hasAttribute('checked') ?? false }, children: nested }
    },
  },
]

/** Proza's checklist item is `<label><input> text</label>`: the space after the box is not text. */
function labelText(label: Element, box: Element): Node[] {
  const out: Node[] = []
  let after = false
  for (const n of label.childNodes) {
    if (n === box) { after = true; continue }
    if (after && out.length === 0 && n.nodeType === 3) {
      const rest = (n as Text).data.replace(/^ /, '')
      if (rest !== '') out.push(n.ownerDocument!.createTextNode(rest))
      continue
    }
    out.push(n)
  }
  return out
}

export const quoteParse: readonly ParseRule[] = [
  {
    selector: 'figure.pz-quote',
    priority: 100,
    parse: (el, ctx) => {
      const quote = el.querySelector(':scope > blockquote')
      const caption = el.querySelector(':scope > figcaption')
      if (!quote) return null
      return { attrs: { ...ctx.supports(el), citation: caption ? ctx.richText(caption) : EMPTY }, children: quote.childNodes }
    },
  },
  {
    selector: 'blockquote',
    parse: (el, ctx) => {
      // `<blockquote><p>…</p><footer>— Name</footer></blockquote>`: the attribution is the citation.
      const last = el.lastElementChild
      const cite = last && (last.localName === 'footer' || (last.localName === 'cite' && el.children.length > 1)) ? last : null
      return {
        attrs: { ...ctx.supports(el), citation: cite ? citation(ctx, cite) : EMPTY },
        children: [...el.childNodes].filter((n) => n !== cite),
      }
    },
  },
]

function citation(ctx: ParseContext, el: Element): RichTextValue {
  const v = ctx.richText(el)
  const dash = /^[—–-]\s*/.exec(v.text)
  if (!dash) return v
  const n = dash[0].length
  return { text: v.text.slice(n), formats: v.formats.filter((f) => f.end > n).map((f) => ({ ...f, start: Math.max(0, f.start - n), end: f.end - n })) }
}

/** The single `<code>` a `<pre>` holds, if that is all it holds. */
function onlyCode(pre: Element): Element | null {
  const kids = [...pre.childNodes].filter((n) => n.nodeType === 1 || (n.textContent ?? '').trim() !== '')
  return kids.length === 1 && kids[0]!.nodeType === 1 && (kids[0] as Element).localName === 'code' ? kids[0] as Element : null
}

function language(...els: (Element | null)[]): string | null {
  for (const el of els) {
    if (!el) continue
    for (const c of el.classList) {
      const m = /^(?:language|lang)-([a-z0-9][a-z0-9+#.-]*)$/i.exec(c)
      if (m) return m[1]!
    }
    const data = el.getAttribute('data-language') ?? el.getAttribute('data-lang')
    if (data && /^[a-z0-9][a-z0-9+#.-]*$/i.test(data)) return data
  }
  return null
}

export const codeParse: readonly ParseRule[] = [
  {
    // A code block is a `<pre>` holding one `<code>`, or one a highlighter marked with its language (TinyMCE's codesample).
    selector: 'pre',
    priority: 60,
    parse: (el, ctx) => {
      // Proza marks its code blocks; preformatted text that happens to be all code stays preformatted.
      if (ctx.source === 'proza' && !el.classList.contains('pz-code')) return null
      const code = onlyCode(el)
      const lang = language(code, el)
      if (!code && lang === null) return null
      // Code has no formats: highlighting happens when it renders.
      const { text } = ctx.richText(code ?? el, { preformatted: true })
      return { attrs: { ...ctx.supports(el), content: { text, formats: [] }, language: lang ?? '' } }
    },
  },
]

export const preformattedParse: readonly ParseRule[] = [
  { selector: 'pre, xmp, listing', parse: (el, ctx) => ({ attrs: { ...ctx.supports(el), content: ctx.richText(el.childNodes, { preformatted: true }) } }) },
]

export const separatorParse: readonly ParseRule[] = [
  { selector: 'hr', parse: (el, ctx) => ({ attrs: ctx.supports(el) }) },
]

export const textParse: Readonly<Record<string, readonly ParseRule[]>> = {
  'core/paragraph': paragraphParse,
  'core/heading': headingParse,
  'core/list': listParse,
  'core/list-item': listItemParse,
  'core/quote': quoteParse,
  'core/code': codeParse,
  'core/preformatted': preformattedParse,
  'core/separator': separatorParse,
}
