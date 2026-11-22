/**
 * Stage 3 of the import pipeline, and the passes every
 * source shares: comments and non-content elements out, lists that browsers
 * and Google Docs nest oddly put right, lists flattened into levels rebuilt,
 * footnotes found by their two-way links, and a text fallback for tables.
 * Works on the inert document only.
 */
import { NOTE_TAG, SILENT_DROP, TAB_TAG } from './inline'
import type { Reporter } from './report'
import { parseStyle } from './style'

/**
 * Nodes moved one at a time throughout the import: spreading a long child list into
 * append() or replaceWith() passes the engine's argument limit (Chromium, about 120,000).
 */
export function moveNodes(nodes: Iterable<Node> | ArrayLike<Node>, into: ParentNode): void {
  for (const n of Array.from(nodes)) into.append(n)
}

/** `el` replaced by `nodes`, as replaceWith(...nodes) without the argument limit. */
export function replaceWithNodes(el: ChildNode, nodes: Iterable<Node> | ArrayLike<Node>): void {
  const fragment = (el.ownerDocument ?? document).createDocumentFragment()
  moveNodes(nodes, fragment)
  el.replaceWith(fragment)
}

export function unwrap(el: Element): void {
  replaceWithNodes(el, el.childNodes)
}

const SHOW_TEXT = 4 // NodeFilter.SHOW_TEXT

/** Text and inline objects aside, an element with nothing in it (Word's footnote list keeps a rule and a break). */
export function isEmpty(el: Element): boolean {
  // Up to the first visible character, not the whole text: asked of every ancestor as notes leave a long list.
  const walker = el.ownerDocument.createTreeWalker(el, SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) if (/[^\s\u200b]/.test(n.nodeValue ?? '')) return false
  return el.querySelector(`img, video, audio, iframe, input, ${NOTE_TAG}`) === null
}

export function removeWithEmptyAncestors(el: Element, stop: Element): void {
  let parent = el.parentElement
  el.remove()
  while (parent && parent !== stop && isEmpty(parent)) {
    const next = parent.parentElement
    parent.remove()
    parent = next
  }
}

/** Declarations worth carrying from a class rule onto its elements: what the inline reader reads. */
const CLASS_PROPS = new Set(['font-weight', 'font-style', 'text-decoration', 'text-decoration-line', 'color', 'background', 'background-color',
  'vertical-align', 'font-family', 'font-size', 'text-align', 'white-space'])

/**
 * Class rules of the source's own stylesheet onto the elements, before
 * stylesheets go: Excel keeps all its formatting there (`.xl65 {font-weight:700}`),
 * Word and LibreOffice some. Only simple class selectors (`.x`, `td.x`); inline styles still win.
 */
export function inlineClassStyles(doc: Document): void {
  // Scanned, not matched with a regex: the stylesheet is foreign text, and a regex over it can backtrack.
  // Rules merge per selector (`td.x`, `.x`) first, each property ranked as the cascade ranks it: a tag
  // and class beat a class, then a later rule beats an earlier one. Each element is then styled once.
  const merged = new Map<string, Map<string, { value: string; rank: number }>>()
  let count = 0
  for (const style of doc.querySelectorAll('style')) {
    for (const [selectors, body] of cssRules(withoutComments(style.textContent.replace(/<!--|-->/g, '')))) {
      const decls = [...parseStyle(body)].filter(([k]) => CLASS_PROPS.has(k))
      if (decls.length === 0) continue
      for (const sel of selectors.split(',')) {
        const simple = /^\s*([a-z0-9]*)\.([\w-]+)\s*$/i.exec(sel)
        if (!simple) continue
        const tag = simple[1]!.toLowerCase()
        const key = `${tag}.${simple[2]!}`
        const rank = (tag === '' ? 0 : 1_000_000) + count++
        let props = merged.get(key)
        if (!props) merged.set(key, (props = new Map<string, { value: string; rank: number }>()))
        for (const [k, value] of decls) props.set(k, { value, rank })
      }
    }
  }
  if (count === 0 || count > 2000) return
  for (const el of doc.body.querySelectorAll('[class]')) {
    const props = new Map<string, { value: string; rank: number }>()
    for (const cls of el.classList) {
      for (const key of [`.${cls}`, `${el.localName}.${cls}`]) {
        for (const [k, d] of merged.get(key) ?? []) if ((props.get(k)?.rank ?? -1) < d.rank) props.set(k, d)
      }
    }
    if (props.size === 0) continue
    const decls = [...props].map(([k, d]) => `${k}:${d.value}`).join(';')
    const own = el.getAttribute('style')
    el.setAttribute('style', own ? `${decls};${own}` : decls)
  }
}

/** CSS without its comments; an unclosed comment runs to the end, as in a browser. */
export function withoutComments(css: string): string {
  let out = ''
  let i = 0
  for (;;) {
    const open = css.indexOf('/*', i)
    if (open < 0) return out + css.slice(i)
    out += css.slice(i, open)
    const close = css.indexOf('*/', open + 2)
    if (close < 0) return out
    i = close + 2
  }
}

/**
 * `selector { declarations }` pairs with no brace inside the declarations, in one pass: rules inside
 * `@media { }` count, the at-rule itself does not (what `/([^{}@]+)\{([^{}]*)\}/g` finds, without its backtracking).
 */
export function cssRules(css: string): [string, string][] {
  const out: [string, string][] = []
  // `after`: just past the last brace. `selector`: the text before the last `{`, while its body has no brace yet.
  let after = 0, selector: string | null = null, body = 0
  for (let i = 0; i < css.length; i++) {
    const c = css[i]
    if (c === '{') {
      selector = css.slice(after, i)
      body = i + 1
      after = i + 1
    } else if (c === '}') {
      if (selector !== null && after === body) {
        // As the regex reads an at-rule's prelude: only the text after its last `@`.
        const sel = selector.slice(selector.lastIndexOf('@') + 1)
        if (sel !== '') out.push([sel, css.slice(body, i)])
      }
      selector = null
      after = i + 1
    }
  }
  return out
}

export function cleanup(body: HTMLElement): void {
  const doc = body.ownerDocument
  // Comments: conditional comments and Word's VML go; TinyMCE's page break becomes an element the page break part reads.
  const walker = doc.createTreeWalker(body, 128 /* NodeFilter.SHOW_COMMENT */)
  const comments: Node[] = []
  for (let n = walker.nextNode(); n; n = walker.nextNode()) comments.push(n)
  for (const c of comments) {
    if (/^\s*pagebreak\s*$/i.test((c as Comment).data)) {
      const el = doc.createElement('div')
      el.className = 'pz-page-break'
      c.parentNode?.replaceChild(el, c)
      continue
    }
    c.parentNode?.removeChild(c)
  }
  for (const el of body.querySelectorAll([...SILENT_DROP].join(','))) el.remove()
  for (const el of body.querySelectorAll('br.Apple-interchange-newline')) el.remove()
  fixNestedLists(body)
  rebuildLeveledLists(body)
}

/** `<ul><li>a</li><ul>…</ul></ul>`: a list right inside a list belongs to the item before it. */
function fixNestedLists(body: Element): void {
  for (const inner of [...body.querySelectorAll(':is(ul, ol) > :is(ul, ol)')]) {
    const prev = inner.previousElementSibling
    if (prev?.localName === 'li') prev.append(inner)
    else {
      const li = inner.ownerDocument.createElement('li')
      inner.replaceWith(li)
      li.append(inner)
    }
  }
}

const levelOf = (li: Element): number | null => {
  const raw = li.getAttribute('data-aria-level') ?? li.getAttribute('aria-level')
  const n = raw === null ? NaN : Number(raw)
  return Number.isInteger(n) && n >= 1 && n <= 9 ? n : null
}

/** The list itself, for a list or a wrapper that holds only one (Word for the web's `ListContainerWrapper`). */
function leveledList(el: Element): Element | null {
  let list: Element | null = el
  if (el.localName === 'div') {
    const kids = [...el.children]
    list = kids.length === 1 && (kids[0]!.localName === 'ul' || kids[0]!.localName === 'ol') ? kids[0]! : null
  }
  if (!list || (list.localName !== 'ul' && list.localName !== 'ol')) return null
  const items = [...list.children]
  return items.length > 0 && items.every((li) => li.localName === 'li' && levelOf(li) !== null) ? list : null
}

/**
 * Lists written as a run of flat lists whose items carry their level
 * (`aria-level`, `data-aria-level`), as Word for the web and Google Docs do,
 * rebuilt into one nested list per run. Items of another list id or kind at
 * the same level start a new list.
 */
export function rebuildLeveledLists(root: Element): void {
  const doc = root.ownerDocument
  const parents = new Set<Element>()
  for (const li of root.querySelectorAll('li[data-aria-level], li[aria-level]')) {
    const list = li.parentElement
    const holder = list?.parentElement?.localName === 'div' && list.parentElement.children.length === 1 ? list.parentElement : list
    if (holder?.parentElement) parents.add(holder.parentElement)
  }
  for (const parent of parents) {
    let run: Element[] = []
    const flush = (): void => {
      if (run.length > 0 && (run.length > 1 || run.some((el) => [...leveledList(el)!.children].some((li) => levelOf(li)! > 1)))) build(run)
      run = []
    }
    let id = ''
    for (const child of [...parent.children]) {
      const list = leveledList(child)
      if (!list) { flush(); continue }
      // A list that starts again at the top level is a list of its own, unless it carries the same list id (Word for the web).
      const first = list.firstElementChild!
      const own = first.getAttribute('data-listid') ?? ''
      if (run.length > 0 && levelOf(first) === 1 && (own === '' || own !== id)) flush()
      id = own
      run.push(child)
    }
    flush()
  }

  function build(run: Element[]): void {
    type Open = { level: number; list: Element; ordered: boolean; id: string }
    const roots: Element[] = []
    const stack: Open[] = []
    for (const holder of run) {
      const list = leveledList(holder)!
      const ordered = list.localName === 'ol'
      for (const li of [...list.children]) {
        const level = levelOf(li)!
        const id = li.getAttribute('data-listid') ?? ''
        while (stack.length > 0 && stack.at(-1)!.level > level) stack.pop()
        let top = stack.at(-1)
        if (top && top.level === level && (top.ordered !== ordered || top.id !== id)) { stack.pop(); top = stack.at(-1) }
        if (!top || top.level < level) {
          const fresh = doc.createElement(ordered ? 'ol' : 'ul')
          for (const a of ['start', 'type', 'style']) { const v = list.getAttribute(a); if (v !== null) fresh.setAttribute(a, v) }
          const host = top?.list.lastElementChild
          if (host) host.append(fresh)
          else roots.push(fresh)
          stack.push((top = { level, list: fresh, ordered, id }))
        }
        top.list.append(li)
      }
    }
    replaceWithNodes(run[0]!, roots)
    for (const el of run.slice(1)) el.remove()
  }
}

/**
 * What a footnote reference reads: a number, a Roman numeral, a letter or a mark, perhaps in brackets
 * ("1", "[12]", "(iv)", "*", "[note 3]"). Never a word: a contents entry links to its section and back too.
 */
const REF_TEXT = /^[[(]?(?:note |n )?(?:\d{1,4}|(?=[ivx])x{0,3}(?:ix|iv|v?i{0,3})|[a-z]|[*†‡§¶#]{1,3})[\])]?$/i
const HEADINGS = 'h1, h2, h3, h4, h5, h6'
const SPACED = /^(?:p|div|li|br|h[1-6]|blockquote|dd|dt|tr|td|th|section|ul|ol|table)$/

/** Text with a space where blocks and line breaks meet, so a note's paragraphs do not run together. */
function spacedText(el: Element): string {
  let out = ''
  const walk = (node: Node): void => {
    for (let c = node.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 3) { out += c.nodeValue ?? ''; continue }
      if (c.nodeType !== 1) continue
      const block = SPACED.test((c as Element).localName)
      if (block) out += ' '
      walk(c)
      if (block) out += ' '
    }
  }
  walk(el)
  return out
}

/**
 * Footnotes from any source, found by their two-way link: a reference points
 * at the note, and the note points back at the reference (Word, Google Docs,
 * LibreOffice, mammoth and Proza's own output all do this). The reference
 * becomes a note marker the inline reader turns into a footnote; the note leaves the text.
 */
export function footnotes(body: HTMLElement, report: Reporter, exact = false): void {
  const ids = new Map<string, Element>()
  for (const el of body.querySelectorAll('[id]')) if (!ids.has(el.id)) ids.set(el.id, el)
  for (const el of body.querySelectorAll('a[name]')) { const n = el.getAttribute('name')!; if (!ids.has(n)) ids.set(n, el) }
  const target = (a: Element): string => {
    const href = a.getAttribute('href') ?? ''
    if (!href.startsWith('#')) return ''
    try { return decodeURIComponent(href.slice(1)) } catch { return href.slice(1) }
  }
  // Links inside each note container, gathered once: a container that is not a note is asked again for every reference.
  const linksIn = new Map<Element, Element[]>()
  let count = 0
  for (const ref of [...body.querySelectorAll('a[href^="#"]')]) {
    if (!body.contains(ref) || !REF_TEXT.test(ref.textContent.trim())) continue
    const note = ids.get(target(ref))
    if (!note || !body.contains(note) || note === ref || note.contains(ref) || ref.contains(note)) continue
    const own = new Set([ref.id, ref.getAttribute('name') ?? '', ref.parentElement?.id ?? '', ref.parentElement?.parentElement?.id ?? ''].filter((k) => k !== ''))
    const container = note.localName === 'a' ? note.closest('p, li, div, dd, section, td') ?? note : note
    // A note is a few lines of text: a heading in it means a section that links back to the contents.
    if (!body.contains(container) || container.contains(ref) || container.matches(HEADINGS) || container.querySelector(HEADINGS)) continue
    let links = linksIn.get(container)
    if (!links) linksIn.set(container, (links = [...container.querySelectorAll('a[href^="#"]')]))
    const back = own.has(target(note)) ? note : links.find((a) => own.has(target(a)))
    if (!back) continue
    back.remove()
    linksIn.delete(container)
    const text = spacedText(container).replace(/[\s\u00a0]+/g, ' ').replace(/\s*[\u21a9\u2191\u23ce]\s*$/, '').trim()
    const marker = body.ownerDocument.createElement(NOTE_TAG)
    marker.setAttribute('note', text)
    const sup = ref.parentElement
    const outer = sup && (sup.localName === 'sup' || sup.classList.contains('MsoFootnoteReference')) && sup.textContent.trim() === ref.textContent.trim() ? sup : ref
    outer.replaceWith(marker)
    removeWithEmptyAncestors(container, body)
    count++
  }
  if (count === 0) return
  report.add('footnote', undefined, count)
  // The rule that separated the notes from the text has nothing left to separate (Proza's own output has none).
  if (exact) return
  const last = body.lastElementChild
  if (last?.localName === 'hr' || (last && isEmpty(last) && last.querySelector('hr'))) last.remove()
}

/**
 * One line per row with tab-separated cells when the schema cannot keep a table.
 */
export function tablesToText(body: HTMLElement, report: Reporter, selector = 'table'): void {
  const doc = body.ownerDocument
  // Innermost first, so a table in a cell is text before its row is.
  for (const table of [...body.querySelectorAll(selector)].reverse()) {
    const out: Element[] = []
    const caption = table.querySelector(':scope > caption')
    if (caption) { const p = doc.createElement('p'); moveNodes(caption.childNodes, p); out.push(p) }
    for (const row of table.querySelectorAll(':scope > tr, :scope > :is(thead, tbody, tfoot) > tr')) {
      const cells = [...row.children].filter((c) => c.localName === 'td' || c.localName === 'th')
      if (cells.every((c) => isEmpty(c))) continue
      const p = doc.createElement('p')
      cells.forEach((cell, i) => {
        if (i > 0) p.append(doc.createElement(TAB_TAG))
        const holder = cell.localName === 'th' ? doc.createElement('b') : doc.createElement('span')
        // The cell's formatting (Excel's bold header row) stays with its text.
        const style = cell.getAttribute('style')
        if (style) holder.setAttribute('style', style)
        // Word puts a paragraph in every cell: its lines stay lines of the cell, not paragraphs of their own.
        const kids = [...cell.childNodes]
        kids.forEach((k, j) => {
          const text = k.nodeType === 1 && /^(?:p|div|h[1-6])$/.test((k as Element).localName)
          if (text) moveNodes(k.childNodes, holder)
          else holder.append(k)
          if (text && kids.slice(j + 1).some((n) => n.nodeType === 1 || (n.textContent ?? '').trim() !== '')) holder.append(doc.createElement('br'))
        })
        p.append(holder)
      })
      out.push(p)
    }
    replaceWithNodes(table, out)
    report.add('table')
  }
}
