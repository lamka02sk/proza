/**
 * JSON to HTML. Pure: no DOM, safe on a server.
 * The same document always renders to the same bytes.
 */
import { type FormatRange, type FormatRegistry, type RichNode, type RichTextValue, defaultFormats, formatAttrs, toTree } from '../model/richtext'
import { type AttrSpecs, type AttrsOf, type BlockSchema, UNSUPPORTED, type ValidateOptions, validateDoc } from '../model/schema'
import type { Block } from '../model/tree'
import { type Child, EMPTY_HTML, type Html, type HtmlAttrs, RenderError, cx, fragment, h, hostHtml } from './html'
import type { Token } from './highlight'

/** A block as its renderer sees it: attributes typed from its schema. */
export interface RenderBlock<A extends AttrSpecs> {
  readonly id: string
  readonly type: string
  readonly attrs: AttrsOf<A>
  readonly children?: readonly Block[]
}

/**
 * How much of the text column a block spans (`sizes` from
 * the column context): `wide` where its containers sit side by side, `narrow`
 * on a phone, where columns stack.
 */
export interface Share {
  readonly wide: number
  readonly narrow: number
}

export const WHOLE: Share = { wide: 1, narrow: 1 }

export interface RenderContext {
  /** The containing block, or null at the root. */
  readonly parent: Block | null
  /** Every containing block, outermost first (a table cell's table is `ancestors.at(-2)`). */
  readonly ancestors: readonly Block[]
  /** This block's share of the text column. */
  readonly share: Share
  /** Widths in CSS pixels of the text column and of a wide part (`bleed: 'wide'`), for `sizes`. */
  readonly measure: Measure
  /** Rich text as inline HTML. `preformatted` keeps "\n" as a newline instead of `<br>` (for `<pre>`). */
  richText(value: RichTextValue, options?: { preformatted?: boolean }): Html
  /** The rendered child blocks. */
  children(): Html
  /** Root element attributes from the block's supports (anchor, alignment, language), merged with `extra`. */
  wrapper(extra?: HtmlAttrs): HtmlAttrs
  /** Accessible names and words in the output, in the language of the content. */
  readonly labels: RenderLabels
  /** Code as HTML, with highlighting tokens as `pz-tok-*` spans when the host passed a highlighter. */
  code(text: string, language: string): Html
  /** A raw HTML block's markup through the host's sanitiser, or nothing when the host passed none. */
  rawHtml(html: string): Html
  /** The headings of the document in reading order, with the anchors they render with (a table of contents). */
  outline(): readonly OutlineEntry[]
}

/** A heading as a table of contents lists it. */
export interface OutlineEntry {
  readonly level: number
  readonly text: string
  readonly anchor: string
}

export interface RenderableBlock<A extends AttrSpecs = AttrSpecs> extends BlockSchema {
  readonly attrs: A
  render(block: RenderBlock<A>, ctx: RenderContext): Html
  /** A heading: its level and text for a table of contents. */
  heading?(block: RenderBlock<A>): { readonly level: number; readonly text: string } | null
  /** It lists the headings (a table of contents): headings without an anchor get one generated. */
  readonly usesOutline?: boolean
  /** A container's child at `index` spans this share of the container (a column of a 2:1 layout: two thirds). Default all of it. */
  childShare?(block: RenderBlock<A>, index: number, parent: Block | null): Share
}

export interface Measure {
  readonly column: number
  readonly wide: number
}

export type RenderRegistry = ReadonlyMap<string, RenderableBlock>

export interface RenderOptions {
  readonly formats?: FormatRegistry
  /** Prefix of footnote ids, so several documents on one page do not collide. Default `pz`. */
  readonly idPrefix?: string
  /** Accessible names in the output, in the language of the content. English by default. */
  readonly labels?: Partial<RenderLabels>
  /**
   * The page's text column and wide parts in CSS pixels (content.css `--pz-measure`,
   * `--pz-wide`), for pictures' `sizes`. Default 720 and 1200.
   */
  readonly measure?: Partial<Measure>
  /** Code highlighting (`tokenize` from `@lamka02sk/proza/render`): code blocks with a language get `pz-tok-*` spans. */
  readonly highlight?: (code: string, language: string) => readonly Token[]
  /**
   * The raw HTML block's markup: the host's sanitiser, which returns what may be
   * published. Without it the block renders nothing. Its result goes into the page unchanged.
   */
  readonly rawHtml?: (html: string) => string | null
}

export interface RenderLabels {
  readonly footnotes: string
  readonly table: string
  backToReference(n: number): string
  /** Summary of the transcript under a video or audio. */
  readonly transcript: string
  /** Name of a video's captions track in the player's menu. */
  readonly captions: string
  /** Summary of an embed that loads only when opened (the privacy facade). */
  loadEmbed(provider: string, title: string): string
  /** Type and size after a file's name: "PDF, 1.2 MB". */
  fileMeta(type: string, bytes: number): string
  /** Name of a table of contents. */
  readonly contents: string
}

/** "1.2 MB": decimal units, one decimal under 10. */
export function formatBytes(bytes: number): string {
  const units = ['B', 'kB', 'MB', 'GB']
  let v = bytes, u = 0
  while (v >= 1000 && u < units.length - 1) { v /= 1000; u++ }
  return `${u === 0 || v >= 10 ? Math.round(v) : Math.round(v * 10) / 10} ${units[u]!}`
}

const LABELS: RenderLabels = {
  footnotes: 'Footnotes',
  table: 'Table',
  backToReference: (n) => `Back to reference ${n}`,
  transcript: 'Transcript',
  captions: 'Captions',
  loadEmbed: (provider, title) => `Play “${title}” from ${provider}`,
  fileMeta: (type, bytes) => [type, bytes > 0 ? formatBytes(bytes) : ''].filter(Boolean).join(', '),
  contents: 'Contents',
}

/** The output's words by content language (BCP 47 primary tag). Others fall back to English; pass `labels` for them. */
export const RENDER_LABELS: Readonly<Record<string, RenderLabels>> = {
  en: LABELS,
  sk: {
    footnotes: 'Poznámky pod čiarou',
    table: 'Tabuľka',
    backToReference: (n) => `Späť na odkaz ${n}`,
    transcript: 'Prepis',
    captions: 'Titulky',
    loadEmbed: (provider, title) => `Prehrať „${title}“ z ${provider}`,
    fileMeta: (type, bytes) => [type, bytes > 0 ? formatBytes(bytes).replace('.', ',') : ''].filter(Boolean).join(', '),
    contents: 'Obsah',
  },
}

/** The output's words for a content language: `sk-SK` takes `sk`, an unknown one English. */
export function renderLabels(lang: string): RenderLabels {
  return RENDER_LABELS[lang.toLowerCase().split('-')[0] ?? ''] ?? LABELS
}

/**
 * Validate and render a stored document. This is the call for untrusted JSON,
 * for example on a server re-rendering what a client saved.
 */
export function render(input: unknown, registry: RenderRegistry, options: RenderOptions & ValidateOptions = {}): string {
  const { doc } = validateDoc(input, registry, options)
  return renderBlocks(doc.blocks, registry, options)
}

/**
 * Render blocks that are already valid. Top-level blocks are separated by a
 * newline; footnotes, numbered in reading order, follow as one list.
 */
export function renderBlocks(blocks: readonly Block[], registry: RenderRegistry, options: RenderOptions = {}): string {
  const formats = options.formats ?? defaultFormats
  const notes = new Footnotes(options.idPrefix ?? 'pz')
  const labels: RenderLabels = { ...LABELS, ...options.labels }
  const env: Env = {
    registry, formats, notes, labels, measure: { column: 720, wide: 1200, ...options.measure },
    ...(options.highlight ? { highlight: options.highlight } : {}),
    ...(options.rawHtml ? { rawHtml: options.rawHtml } : {}),
    outline: outlineOf(blocks, registry),
  }
  const out = blocks.map((b) => renderBlock(b, [], WHOLE, env).html).filter((s) => s !== '')
  const list = notes.list(labels)
  if (list) out.push(list.html)
  return out.join('\n')
}

/** Collects footnote texts while a document renders and numbers their references. */
export class Footnotes {
  readonly #prefix: string
  readonly #notes: string[] = []

  constructor(prefix = 'pz') { this.#prefix = prefix }

  reference(note: string): Html {
    this.#notes.push(note)
    const n = this.#notes.length
    return h('sup', { class: 'pz-fn', id: `${this.#prefix}-fnref-${n}` },
      h('a', { href: `#${this.#prefix}-fn-${n}`, role: 'doc-noteref' }, String(n)))
  }

  /** The list of notes (DPUB-ARIA endnotes), or null when there are none. */
  list(labels: Pick<RenderLabels, 'footnotes' | 'backToReference'>): Html | null {
    if (this.#notes.length === 0) return null
    const p = this.#prefix
    return h('section', { class: 'pz-footnotes', role: 'doc-endnotes', 'aria-label': labels.footnotes },
      h('ol', null, this.#notes.map((note, i) => h('li', { id: `${p}-fn-${i + 1}` },
        note, ' ', h('a', { href: `#${p}-fnref-${i + 1}`, role: 'doc-backlink', 'aria-label': labels.backToReference(i + 1) }, '↩')))))
  }
}

interface Env {
  readonly registry: RenderRegistry
  readonly formats: FormatRegistry
  readonly notes: Footnotes
  readonly labels: RenderLabels
  readonly measure: Measure
  readonly highlight?: (code: string, language: string) => readonly Token[]
  readonly rawHtml?: (html: string) => string | null
  /** Headings in reading order with their anchors; generated ones only when something lists them. */
  readonly outline: { readonly entries: readonly OutlineEntry[]; readonly anchors: ReadonlyMap<string, string> }
}

/** Lower case, letters and digits joined by `-`, without diacritics: "Čo je nové?" is `co-je-nove`. */
export function slug(text: string): string {
  const s = text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 60)
  return /^[a-z]/.test(s) ? s : `h-${s || 'section'}`
}

/**
 * The document's headings and their anchors. A heading keeps its own anchor;
 * when a block lists the headings, the others get one from their text, unique
 * in the document. Same document, same anchors: output stays stable.
 */
function outlineOf(blocks: readonly Block[], registry: RenderRegistry): Env['outline'] {
  const found: { block: Block; level: number; text: string }[] = []
  const taken = new Set<string>()
  const seen = { listed: false }
  const walk = (list: readonly Block[]): void => {
    for (const b of list) {
      const def = registry.get(b.type)
      if (def?.usesOutline) seen.listed = true
      if (typeof b.attrs.anchor === 'string' && b.attrs.anchor !== '') taken.add(b.attrs.anchor)
      const head = def?.heading?.(b as RenderBlock<AttrSpecs>)
      if (head && head.text.trim() !== '') found.push({ block: b, ...head })
      if (b.children) walk(b.children)
    }
  }
  walk(blocks)
  const anchors = new Map<string, string>()
  if (!seen.listed) return { entries: [], anchors }
  // The next number to try for each slug, so many headings with one text are not counted up from 2 each time.
  const counters = new Map<string, number>()
  const entries = found.map(({ block, level, text }) => {
    let anchor = typeof block.attrs.anchor === 'string' ? block.attrs.anchor : ''
    if (anchor === '') {
      const base = slug(text)
      anchor = base
      let n = counters.get(base) ?? 2
      while (taken.has(anchor)) anchor = `${base}-${n++}`
      counters.set(base, n)
      taken.add(anchor)
      anchors.set(block.id, anchor)
    }
    return { level, text: text.trim(), anchor }
  })
  return { entries, anchors }
}

function renderBlock(block: Block, ancestors: readonly Block[], share: Share, env: Env): Html {
  const parent = ancestors.at(-1) ?? null
  // Placeholders keep content the editor cannot show; publishing it unchecked would bypass the schema.
  if (block.type === UNSUPPORTED) return EMPTY_HTML
  const def = env.registry.get(block.type)
  if (!def) throw new RenderError(`No renderer for block type ${block.type}`)
  const typed = block as RenderBlock<AttrSpecs>
  const inside = [...ancestors, block]
  const ctx: RenderContext = {
    parent,
    ancestors,
    share,
    measure: env.measure,
    richText: (value, opts) => richText(value, env.formats, opts?.preformatted ?? false, env.notes),
    children: () => fragment((block.children ?? []).map((c, i) => {
      const own = def.childShare?.(typed, i, parent) ?? WHOLE
      return renderBlock(c, inside, { wide: share.wide * own.wide, narrow: share.narrow * own.narrow }, env)
    })),
    wrapper: (extra = {}) => wrapper(block, parent, extra, env.outline.anchors.get(block.id)),
    labels: env.labels,
    code: (text, language) => code(text, language, env),
    rawHtml: (html) => {
      const safe = env.rawHtml?.(html)
      return typeof safe === 'string' ? hostHtml(safe) : EMPTY_HTML
    },
    outline: () => env.outline.entries,
  }
  return def.render(typed, ctx)
}

/** The classes a block's supports give it. The canvas shows the same ones, so editing matches the page. */
export function supportClasses(attrs: Readonly<Record<string, unknown>>, topLevel: boolean): string[] {
  const out: string[] = []
  for (const [attr, prefix] of [['textAlign', 'pz-text-'], ['align', 'pz-align-'], ['size', 'pz-size-'], ['color', 'pz-color-'], ['bleed', 'pz-bleed-'], ['variant', 'pz-style-']] as const) {
    const v = attrs[attr]
    // Only a part of the page itself can be wider than the column it would sit in.
    if (typeof v === 'string' && v !== '' && (attr !== 'bleed' || topLevel)) out.push(prefix + v)
  }
  return out
}

function wrapper(block: Block, parent: Block | null, extra: HtmlAttrs, generated?: string): HtmlAttrs {
  const str = (k: string): string | null => {
    const v = block.attrs[k]
    return typeof v === 'string' && v !== '' ? v : null
  }
  const extraClass = typeof extra.class === 'string' ? extra.class : null
  return {
    id: str('anchor') ?? generated ?? null, ...extra,
    class: cx(extraClass, ...supportClasses(block.attrs, parent === null)),
    lang: str('lang'), dir: str('dir'),
  }
}

/** Code with highlighting spans, or plain when there is no highlighter or the language is unknown. */
function code(text: string, language: string, env: Env): Html {
  const tokens = language !== '' && env.highlight ? env.highlight(text, language) : []
  if (tokens.length === 0) return fragment(text)
  const out: Child[] = []
  let at = 0
  for (const t of tokens) {
    if (t.start > at) out.push(text.slice(at, t.start))
    out.push(h('span', { class: `pz-tok-${t.type}` }, text.slice(t.start, t.end)))
    at = t.end
  }
  out.push(text.slice(at))
  return fragment(out)
}

// ---------------------------------------------------------------------------
// Rich text

/**
 * Rich text as inline HTML. Footnote references are numbered by `notes`; pass
 * the document's collector, or get a local numbering from 1.
 */
export function richText(value: RichTextValue, formats: FormatRegistry = defaultFormats, preformatted = false, notes: Footnotes = new Footnotes()): Html {
  const out: Child[] = nodes(toTree(value, formats), formats, preformatted, notes)
  // A trailing line break needs a second <br> to show its empty line, as in the field.
  if (!preformatted && value.text.endsWith('\n')) out.push(h('br'))
  return fragment(out)
}

function nodes(list: readonly RichNode[], formats: FormatRegistry, pre: boolean, notes: Footnotes): Child[] {
  return list.map((n) => ('text' in n ? text(n.text, pre) : element(n.format, () => nodes(n.children, formats, pre, notes), formats, notes)))
}

function text(s: string, pre: boolean): Child {
  if (pre) return s
  return s.split('\n').flatMap((line, i) => (i === 0 ? [line] : [h('br'), line]))
}

function element(range: FormatRange, children: () => Child[], formats: FormatRegistry, notes: Footnotes): Html {
  const spec = formats.get(range.type)
  if (!spec) return h('span', { 'data-pz-format': range.type }, children())
  if (spec.type === 'footnote') return notes.reference(range.attrs?.note ?? '')
  return h(spec.tag, formatAttrs(spec, range), spec.object ? null : children())
}
