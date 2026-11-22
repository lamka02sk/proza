/**
 * The escaping HTML builder.
 *
 * Block renderers produce markup only through `h`. Text is escaped, URLs pass
 * the protocol allow-list, and tags and attributes come from an allow-list a
 * server can reuse to sanitise. There is no way to pass a raw string: an `Html`
 * value exists only if this module made it.
 */
import { isPlayerUrl } from '../model/embeds'
import { safeSrcset, safeUrl } from '../model/url'

export interface Html {
  readonly html: string
}

export type Child = Html | string | null | undefined | false | readonly Child[]
export type AttrValue = string | number | boolean | null | undefined
export type HtmlAttrs = Readonly<Record<string, AttrValue>>

const made = new WeakSet<Html>()

function make(html: string): Html {
  const value = Object.freeze({ html })
  made.add(value)
  return value
}

export const EMPTY_HTML: Html = make('')

/**
 * Markup a host has sanitised itself: the raw HTML block's content, through
 * the host's own `rawHtml` render option. The renderer
 * is its only caller; block renderers reach it through `ctx.rawHtml`, which
 * gives nothing unless the host passed a sanitiser.
 */
export function hostHtml(html: string): Html {
  return make(html)
}

/** Attributes allowed on every element. `aria-*` and `data-pz-*` are allowed too. */
export const GLOBAL_ATTRS: ReadonlySet<string> = new Set(['id', 'class', 'lang', 'dir', 'title', 'role', 'hidden', 'tabindex'])

/** Elements published content may contain, with their own attributes. Exported for server-side sanitising. */
export const ALLOWED: ReadonlyMap<string, ReadonlySet<string>> = new Map(Object.entries({
  p: [], h1: [], h2: [], h3: [], h4: [], h5: [], h6: [], div: [], span: [], hr: [], br: [], wbr: [],
  ul: [], ol: ['start', 'reversed', 'type'], li: ['value'], dl: [], dt: [], dd: [],
  blockquote: ['cite'], q: ['cite'], figure: [], figcaption: [], cite: [], pre: [], code: [], kbd: [], samp: [],
  strong: [], em: [], u: [], s: [], sub: [], sup: [], mark: [], small: [], abbr: [], bdi: [], bdo: [],
  del: ['cite', 'datetime'], ins: ['cite', 'datetime'], time: ['datetime'],
  a: ['href', 'target', 'rel', 'hreflang', 'download'],
  label: [], input: ['type', 'checked', 'disabled'],
  details: ['open'], summary: [], section: [], aside: [], nav: [],
  table: [], caption: [], tbody: [], tr: [], td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan', 'scope'],
  img: ['src', 'alt', 'width', 'height', 'loading', 'decoding', 'srcset', 'sizes'],
  video: ['src', 'poster', 'controls', 'preload', 'width', 'height', 'playsinline'],
  audio: ['src', 'controls', 'preload'],
  track: ['kind', 'src', 'srclang', 'label', 'default'],
  // Only player addresses of the embed providers (src/model/embeds.ts); h() refuses any other.
  iframe: ['src', 'title', 'sandbox', 'allow', 'allowfullscreen', 'referrerpolicy', 'loading', 'width', 'height'],
}).map(([tag, attrs]) => [tag, new Set(attrs)]))

const VOID = new Set(['br', 'hr', 'wbr', 'input', 'img', 'source', 'track', 'col'])
/** Attributes whose value is an address: they pass the protocol allow-list. */
export const URL_ATTRS: ReadonlySet<string> = new Set(['href', 'src', 'cite', 'poster'])
export const INPUT_TYPES: ReadonlySet<string> = new Set(['checkbox'])
/** Attribute names allowed on every element besides GLOBAL_ATTRS. */
export const ATTR_PATTERN = /^(?:aria-[a-z]+|data-pz-[a-z][a-z0-9-]*)$/

export class RenderError extends Error {
  override name = 'RenderError'
}

/** Build one element. Throws on a tag or attribute outside the allow-list: that is a bug in a renderer. */
export function h(tag: string, attrs: HtmlAttrs | null = null, ...children: Child[]): Html {
  const allowed = ALLOWED.get(tag)
  if (!allowed) throw new RenderError(`Element <${tag}> is not allowed`)
  let out = `<${tag}`
  const a: Record<string, AttrValue> = { ...attrs }
  if (tag === 'a' && a.target === '_blank') a.rel = withNoopener(a.rel)
  if (tag === 'input' && !INPUT_TYPES.has(String(a.type))) throw new RenderError('Only checkbox inputs are allowed')
  if (tag === 'iframe' && !(typeof a.src === 'string' && isPlayerUrl(a.src))) throw new RenderError('An iframe needs the player address of an allowed embed provider')
  for (const [name, value] of Object.entries(a)) {
    if (!allowed.has(name) && !GLOBAL_ATTRS.has(name) && !ATTR_PATTERN.test(name)) {
      throw new RenderError(`Attribute ${name} is not allowed on <${tag}>`)
    }
    if (value === null || value === undefined || value === false) continue
    if (value === true) { out += ` ${name}`; continue }
    let text = String(value)
    if (URL_ATTRS.has(name)) {
      const safe = safeUrl(text)
      if (safe === null) continue
      text = safe
    }
    if (name === 'srcset') {
      const safe = safeSrcset(text)
      if (safe === null) continue
      text = safe
    }
    out += ` ${name}="${escapeAttr(text)}"`
  }
  out += '>'
  if (VOID.has(tag)) {
    if (flatten(children) !== '') throw new RenderError(`<${tag}> cannot have children`)
    return make(out)
  }
  return make(`${out}${flatten(children)}</${tag}>`)
}

/** Several children as one value, without a wrapping element. */
export function fragment(...children: Child[]): Html {
  return make(flatten(children))
}

/** Class list from parts; falsy parts are skipped. */
export function cx(...parts: (string | false | null | undefined)[]): string | null {
  const list = parts.filter((p): p is string => typeof p === 'string' && p !== '')
  return list.length > 0 ? list.join(' ') : null
}

function flatten(children: readonly Child[]): string {
  let out = ''
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue
    if (typeof c === 'string') out += escapeText(c)
    else if (Array.isArray(c)) out += flatten(c as readonly Child[])
    else if (made.has(c as Html)) out += (c as Html).html
    else throw new RenderError('Child is not escaped Html; build it with h()')
  }
  return out
}

function withNoopener(rel: AttrValue): string {
  const parts = typeof rel === 'string' ? rel.split(/\s+/).filter(Boolean) : []
  return parts.includes('noopener') ? parts.join(' ') : [...parts, 'noopener'].join(' ')
}

export function escapeText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, '&quot;')
}
