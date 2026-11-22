/**
 * Utility blocks: page break, table of contents and raw
 * HTML. Schema and rendering only: server-safe, no DOM, no Vue. Their editing
 * joins them in `utility-edit.ts`.
 */
import { EMPTY_HTML, type Html, h } from '../render/html'
import type { OutlineEntry } from '../render/render'
import { defineSchema } from './define'

export const PAGE_BREAK = 'core/page-break'
export const TOC = 'core/toc'
export const RAW_HTML = 'core/html'

/** Where a printed page ends (TinyMCE `pagebreak`). Nothing on screen; print and PDF start a new page after it. */
export const pageBreak = defineSchema({
  name: PAGE_BREAK,
  attrs: {},
  render: (_b, ctx) => h('div', ctx.wrapper({ class: 'pz-page-break', 'aria-hidden': 'true' })),
})

/**
 * A table of contents: the document's headings down to a level, as nested
 * lists of links. Headings without an anchor get one from their text, so the
 * links work without the author naming anchors.
 */
export const toc = defineSchema({
  name: TOC,
  attrs: {
    /** The deepest heading level listed. */
    depth: { type: 'enum', values: [2, 3, 4, 5, 6], default: 3 },
  },
  supports: { anchor: true },
  usesOutline: true,
  render: (b, ctx) => {
    const entries = ctx.outline().filter((e) => e.level <= b.attrs.depth)
    if (entries.length === 0) return EMPTY_HTML
    return h('nav', ctx.wrapper({ class: 'pz-toc', 'aria-label': ctx.labels.contents, 'data-pz-depth': b.attrs.depth }), tocList(entries))
  },
})

/** Nested lists from headings in order: a deeper heading opens a list inside the item before it. */
export function tocTree(entries: readonly OutlineEntry[]): TocNode[] {
  const root: TocNode[] = []
  const stack: { level: number; children: TocNode[] }[] = [{ level: 0, children: root }]
  for (const e of entries) {
    while (stack.length > 1 && stack.at(-1)!.level >= e.level) stack.pop()
    const node: TocNode = { entry: e, children: [] }
    stack.at(-1)!.children.push(node)
    stack.push({ level: e.level, children: node.children })
  }
  return root
}

export interface TocNode { readonly entry: OutlineEntry; readonly children: TocNode[] }

function tocList(entries: readonly OutlineEntry[]): Html {
  const list = (nodes: readonly TocNode[]): Html => h('ol', null, nodes.map((n) =>
    h('li', null, h('a', { href: `#${n.entry.anchor}` }, n.entry.text), n.children.length > 0 ? list(n.children) : null)))
  return list(tocTree(entries))
}

/**
 * Raw HTML (off by default). Stored as text; the
 * page gets it only through the host's sanitiser (`rawHtml` render option).
 * The editor previews it in a sandboxed frame.
 */
export const rawHtml = defineSchema({
  name: RAW_HTML,
  attrs: { html: { type: 'string', maxLength: 100_000 } },
  render: (b, ctx) => {
    const safe = b.attrs.html.trim() === '' ? EMPTY_HTML : ctx.rawHtml(b.attrs.html)
    return safe === EMPTY_HTML ? EMPTY_HTML : h('div', { class: 'pz-html' }, safe)
  },
})

export const utilityBlocks = [pageBreak, toc, rawHtml] as const
