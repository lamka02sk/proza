/**
 * Stage 2 of the import pipeline: what each source does
 * differently. Each normaliser rewrites the inert document into plain HTML
 * the shared stages read: real lists, no tracked deletions, no comments, no
 * editor bookkeeping. Formatting stays where it is; the inline reader reads it.
 */
import { isEmpty, moveNodes, replaceWithNodes, unwrap } from './cleanup'
import { type MarkerKind, markerKind } from './markers'
import type { ImportSource, Reporter } from './report'
import { parseStyle } from './style'

export function normalizeSource(body: HTMLElement, source: ImportSource, report: Reporter): void {
  switch (source) {
    case 'word-desktop': wordDesktop(body, report); break
    case 'word-web': wordWeb(body, report); break
    case 'google-docs': googleDocs(body); break
    case 'tinymce': tinymce(body); break
    case 'excel': case 'google-sheets': case 'libreoffice-calc': spreadsheet(body); break
    case 'docx': trackedChanges(body, report); break
    default: break
  }
}

// ---------------------------------------------------------------------------
// Word desktop

const MSO_LIST = /mso-list:\s*(l\d+)\s+level(\d+)\s+(lfo\d+)/i

function wordDesktop(body: HTMLElement, report: Reporter): void {
  trackedChanges(body, report)
  comments(body, report, [
    '.MsoCommentReference', '.msocomtxt', '.msocomoff', '.msocomanchor', '[style*="mso-element:comment"]',
    'a[style*="mso-comment-reference"]', '[style*="mso-special-character:comment"]',
  ])
  // Tab runs become one space: a tab has no meaning in flowing text.
  for (const el of body.querySelectorAll('[style*="mso-tab-count"]')) el.replaceWith(' ')
  for (const el of body.querySelectorAll('o\\:p')) el.remove()
  for (const el of [...body.querySelectorAll('*')].filter((e) => /^(?:v|w|m|st1):/.test(e.localName))) el.remove()
  for (const el of body.querySelectorAll('p.MsoTitle')) rename(el, 'h1')
  quotes(body, 'p.MsoQuote, p.MsoIntenseQuote')
  captions(body, 'p.MsoCaption')
  wordLists(body, report)
}

/** Insertions are accepted, deletions dropped. */
function trackedChanges(body: HTMLElement, report: Reporter): void {
  let n = 0
  for (const el of body.querySelectorAll('del, .msoDel, .TrackChangeTextDeletion, .TrackedChange.Deletion')) { el.remove(); n++ }
  for (const el of body.querySelectorAll('ins, .msoIns, .TrackChangeTextInsertion')) { unwrap(el); n++ }
  if (n > 0) report.add('tracked', undefined, n)
}

function comments(body: HTMLElement, report: Reporter, selectors: readonly string[]): void {
  const found = [...body.querySelectorAll(selectors.join(','))]
  // A comment's text is one element; its anchors and references are others. Count the texts when there are any.
  const marked = found.filter((el) => el.classList.contains('msocomtxt') || el.classList.contains('CommentContent'))
  const texts = marked.length > 0 ? marked : found.filter((el) => /mso-element:\s*comment(?![-\w])/.test(el.getAttribute('style') ?? ''))
  for (const el of found) el.remove()
  if (found.length > 0) report.add('comment', undefined, Math.max(1, texts.length))
}

function rename(el: Element, tag: string): Element {
  const out = el.ownerDocument.createElement(tag)
  for (const a of el.attributes) out.setAttribute(a.name, a.value)
  moveNodes(el.childNodes, out)
  el.replaceWith(out)
  return out
}

/** Consecutive quote paragraphs become one quotation. */
function quotes(body: HTMLElement, selector: string): void {
  for (const p of [...body.querySelectorAll(selector)]) {
    if (!p.isConnected) continue
    const quote = p.ownerDocument.createElement('blockquote')
    p.replaceWith(quote)
    quote.append(p)
    let next = nextElement(quote)
    while (next?.matches(selector)) { const after = nextElement(next); quote.append(next); next = after }
  }
}

/** A caption paragraph right after a lone picture is that picture's caption. */
function captions(body: HTMLElement, selector: string): void {
  for (const cap of [...body.querySelectorAll(selector)]) {
    const prev = previousElement(cap)
    const img = prev && prev.localName === 'p' && prev.textContent.trim() === '' ? prev.querySelectorAll('img') : null
    if (!prev || img?.length !== 1) continue
    const doc = cap.ownerDocument
    const figure = doc.createElement('figure')
    const caption = doc.createElement('figcaption')
    moveNodes(cap.childNodes, caption)
    figure.append(img[0]!, caption)
    prev.replaceWith(figure)
    cap.remove()
  }
}

function nextElement(el: Element): Element | null {
  let n = el.nextSibling
  while (n && n.nodeType !== 1) { if ((n.textContent ?? '').trim() !== '') return null; n = n.nextSibling }
  return n as Element | null
}

function previousElement(el: Element): Element | null {
  let n = el.previousSibling
  while (n && n.nodeType !== 1) { if ((n.textContent ?? '').trim() !== '') return null; n = n.previousSibling }
  return n as Element | null
}

/**
 * Word writes a list as paragraphs, each with its list, level and list
 * instance in `mso-list` and its marker as text. Runs of them become nested
 * lists; the marker decides bullet or number, the numbering style and start.
 */
function wordLists(body: HTMLElement, report: Reporter): void {
  const doc = body.ownerDocument
  const info = (el: Element): { level: number; lfo: string } | null => {
    const m = MSO_LIST.exec(el.getAttribute('style') ?? '')
    return m ? { level: Number(m[2]), lfo: m[3]! } : null
  }
  const marker = (el: Element): string => {
    const ignore = el.querySelector('[style*="mso-list:Ignore"], [style*="mso-list: Ignore"]')
    if (!ignore) return ''
    // The marker is the text before Word's spacing span (`font:7.0pt`).
    const spacing = ignore.querySelector('[style*="font:7.0pt"], [style*="font: 7.0pt"]')
    spacing?.remove()
    const text = ignore.textContent
    // The span that held only the marker (a Symbol font run) goes with it.
    let holder: Element = ignore
    while (holder.parentElement && holder.parentElement !== el && holder.parentElement.textContent.trim() === text.trim()) holder = holder.parentElement
    holder.remove()
    return text
  }
  // Headings Word numbers keep their text and lose the number: a heading's level is its structure.
  for (const h of body.querySelectorAll('h1, h2, h3, h4, h5, h6')) if (info(h)) marker(h)
  let runs = 0
  for (const first of [...body.querySelectorAll('p')]) {
    if (!first.isConnected || !info(first) || !first.parentElement) continue
    const anchor = doc.createComment('')
    first.before(anchor)
    const run: Element[] = [first]
    let next = nextElement(first)
    while (next && next.localName === 'p' && (info(next) || /MsoListParagraphCxSp(?:Middle|Last)/.test(next.className))) { run.push(next); next = nextElement(next) }
    type Open = { level: number; list: Element; kind: MarkerKind; lfo: string; last: Element | null }
    const stack: Open[] = []
    const roots: Element[] = []
    for (const p of run) {
      const i = info(p)
      if (!i) {
        // A paragraph of the item above, without its own marker.
        const li = stack.at(-1)?.last
        if (li) li.append(p)
        else roots.push(p)
        continue
      }
      while (stack.length > 0 && stack.at(-1)!.level > i.level) stack.pop()
      let top = stack.at(-1)
      const kind = markerKind(marker(p), top && top.level === i.level ? top.kind : undefined)
      if (top && top.level === i.level && (top.kind.ordered !== kind.ordered || (top.lfo !== i.lfo && i.level === 1))) { stack.pop(); top = stack.at(-1) }
      if (!top || top.level < i.level) {
        const list = doc.createElement(kind.ordered ? 'ol' : 'ul')
        if (kind.ordered && kind.start !== 1) list.setAttribute('start', String(kind.start))
        if (kind.ordered && kind.numbering !== '1') list.setAttribute('type', kind.numbering)
        const host = top?.last
        if (host) host.append(list)
        else roots.push(list)
        stack.push((top = { level: i.level, list, kind, lfo: i.lfo, last: null }))
      }
      top.kind = kind
      const li = doc.createElement('li')
      const align = parseStyle(p.getAttribute('style')).get('text-align')
      if (align) li.setAttribute('style', `text-align: ${align}`)
      moveNodes(p.childNodes, li)
      top.list.append(li)
      top.last = li
      p.remove()
    }
    replaceWithNodes(anchor, roots)
    runs++
  }
  if (runs > 0) report.add('list', undefined, runs)
}

// ---------------------------------------------------------------------------
// Word for the web

function wordWeb(body: HTMLElement, report: Reporter): void {
  trackedChanges(body, report)
  comments(body, report, ['.CommentStart', '.CommentEnd', '.CommentContent', '.CommentAnchor'])
  for (const el of body.querySelectorAll('.CommentHighlightRest, .CommentHighlightPipeRest, .CommentHighlightClicked')) unwrap(el)
  // End-of-paragraph marks and their spaces.
  for (const el of body.querySelectorAll('.EOP, .LineBreakBlob + .EOP')) el.remove()
  // Pictures sit in containers that only position them.
  for (const el of body.querySelectorAll('.WACImageContainer, .WACImageBorder')) unwrap(el)
}

// ---------------------------------------------------------------------------
// Google Docs

function googleDocs(body: HTMLElement): void {
  for (const b of body.querySelectorAll('b[id^="docs-internal-guid"]')) unwrap(b)
  // Links go through Google's redirect; the address the author linked to is its `q`.
  for (const a of body.querySelectorAll('a[href^="https://www.google.com/url?"]')) {
    const q = /[?&]q=([^&]*)/.exec(a.getAttribute('href')!)?.[1]
    if (q) { try { a.setAttribute('href', decodeURIComponent(q)) } catch { /* keep the redirect */ } }
  }
  // A checklist's boxes are pictures of boxes; the state is on the item.
  for (const img of body.querySelectorAll('li img[aria-roledescription="checkbox"]')) img.remove()
  for (const li of body.querySelectorAll('li[role="checkbox"], li[aria-checked]')) {
    const box = li.ownerDocument.createElement('input')
    box.setAttribute('type', 'checkbox')
    if (li.getAttribute('aria-checked') === 'true') box.setAttribute('checked', '')
    li.prepend(box)
  }
}

// ---------------------------------------------------------------------------
// TinyMCE

function tinymce(body: HTMLElement): void {
  for (const el of body.querySelectorAll('[data-mce-bogus="all"]')) el.remove()
  for (const el of body.querySelectorAll('br[data-mce-bogus]')) el.remove()
  for (const el of body.querySelectorAll('[data-mce-bogus], .mce-preview-object, .mce-object-iframe')) unwrap(el)
  // The checklist plugin keeps its state in classes.
  for (const ul of body.querySelectorAll('ul.tox-checklist')) {
    ul.classList.add('pz-checklist')
    for (const li of ul.children) {
      if (li.localName !== 'li') continue
      const box = li.ownerDocument.createElement('input')
      box.setAttribute('type', 'checkbox')
      if (li.classList.contains('tox-checklist--checked')) box.setAttribute('checked', '')
      li.prepend(box)
    }
  }
}

// ---------------------------------------------------------------------------
// Spreadsheets

function spreadsheet(body: HTMLElement): void {
  for (const el of body.querySelectorAll('google-sheets-html-origin')) unwrap(el)
  for (const el of body.querySelectorAll('col, colgroup')) el.remove()
  // Trailing empty columns: a selection in a sheet often reaches past the data.
  for (const table of body.querySelectorAll('table')) {
    const rows = [...table.querySelectorAll('tr')]
    for (;;) {
      const lasts = rows.map((r) => r.lastElementChild).filter((c): c is Element => c !== null)
      if (lasts.length === 0 || !lasts.every((c) => isEmpty(c) && (c.getAttribute('colspan') ?? '1') === '1')) break
      for (const c of lasts) c.remove()
    }
  }
}
