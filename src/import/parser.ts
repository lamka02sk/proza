/**
 * Stage 4 of the import pipeline: walk the cleaned tree
 * and apply each block's parse rules by priority. Inline content between
 * blocks becomes paragraphs; elements no rule takes are unwrapped and lend
 * their styles to what they held; pictures and players inside text move out
 * to blocks of their own, splitting the text around them.
 */
import { type FormatRange, type RichTextValue, normalize } from '../model/richtext'
import { type BlockSchema, attrSpecs } from '../model/schema'
import { safeUrl } from '../model/url'
import { BLOCK_TAGS, type ImportState, type Inherit, InlineReader, REPORTED_DROP, ROOT_INHERIT, SILENT_DROP } from './inline'
import type { RawBlock } from './raw'
import type { ImportBlock, ParseContext, ParseRule } from './rules'
import { parseLength, parseStyle, widthPreset } from './style'

/** A picture whose bytes must be uploaded, or found by the author. */
export interface PendingFile {
  readonly file: File | null
  /** What the source called it, for the report and the placeholder. */
  readonly name: string
}

interface Scope {
  readonly inline: Inherit
  readonly textAlign: string
  readonly lang: string
  readonly dir: string
}

const ROOT_SCOPE: Scope = { inline: ROOT_INHERIT, textAlign: '', lang: '', dir: '' }

/** Pictures, players and frames are blocks even when foreign HTML puts them inside text. */
const LIFT = new Set(['img', 'video', 'audio', 'iframe'])
const BLOCKISH = [...BLOCK_TAGS, ...LIFT].join(',')
// Below the schema's MAX_DEPTH (128): blocks nest no deeper than elements, so an import always loads.
const MAX_DEPTH = 120
const RASTER = /^data:(image\/(?:png|jpeg|jpg|gif|webp|avif|bmp));base64,([a-z0-9+/=\s]+)$/i

interface Bound { readonly rule: ParseRule; readonly type: string; readonly order: number }

export class BlockParser {
  readonly #st: ImportState
  readonly #schemas: ReadonlyMap<string, BlockSchema>
  readonly #rules: readonly Bound[]
  readonly #reader: InlineReader
  readonly #consumed = new Set<Element>()
  readonly #referenced: ReadonlySet<string>
  readonly #anchors = new Set<string>()
  /** Pending uploads; a block's `media` is an index here. */
  readonly pending: PendingFile[] = []
  #media: number | undefined

  constructor(state: ImportState, blocks: readonly ImportBlock[], referenced: ReadonlySet<string>) {
    this.#st = state
    this.#schemas = new Map(blocks.map((b) => [b.name, b]))
    let order = 0
    this.#rules = blocks.flatMap((b) => (b.parse ?? []).map((rule) => ({ rule, type: b.name, order: order++ })))
      .sort((a, b) => (b.rule.priority ?? 50) - (a.rule.priority ?? 50) || a.order - b.order)
    this.#reader = new InlineReader(state)
    this.#referenced = referenced
  }

  parse(body: Element): RawBlock[] {
    return this.#blocks([...body.childNodes], ROOT_SCOPE, 0)
  }

  // -------------------------------------------------------------------------

  #small(img: Element): boolean {
    const style = parseStyle(img.getAttribute('style'))
    const size = (k: 'width' | 'height'): number | null => {
      const raw = style.get(k) ?? img.getAttribute(k)
      const len = raw ? parseLength(raw) : null
      return len && 'px' in len ? len.px : null
    }
    const w = size('width'), h = size('height')
    return w !== null && h !== null && w <= 48 && h <= 48
  }

  #liftable(el: Element): boolean {
    if (!LIFT.has(el.localName)) return false
    return el.localName !== 'img' || (!this.#st.exact && !this.#small(el))
  }

  #blockish(n: Node): boolean {
    if (n.nodeType !== 1) return false
    const el = n as Element
    if (BLOCK_TAGS.has(el.localName) || this.#liftable(el) || this.#mappedBlock(el)) return true
    if (this.#rules.some((b) => b.rule.block === true && el.matches(b.rule.selector))) return true
    if (SILENT_DROP.has(el.localName)) return false
    for (const d of el.querySelectorAll(BLOCKISH)) if (BLOCK_TAGS.has(d.localName) || this.#liftable(d)) return true
    return false
  }

  #mappedBlock(el: Element): { block: string; attrs?: Readonly<Record<string, unknown>> } | null {
    for (const c of el.classList) {
      const m = this.#st.classes[c]
      if (m && m !== 'drop' && 'block' in m && this.#schemas.has(m.block)) return m
    }
    return null
  }

  #blocks(nodes: readonly Node[], scope: Scope, depth: number): RawBlock[] {
    const out: RawBlock[] = []
    let run: Node[] = []
    const flush = (): void => {
      if (run.length > 0) for (const b of this.#loose(run, scope)) out.push(b)
      run = []
    }
    for (const n of nodes) {
      if (n.nodeType === 3) { run.push(n); continue }
      if (n.nodeType !== 1) continue
      const el = n as Element
      if (this.#consumed.has(el)) continue
      if (!this.#blockish(el)) { run.push(el); continue }
      flush()
      // Pushed one by one throughout: spreading a long list into push() passes the engine's argument limit (Chromium).
      for (const b of this.#element(el, scope, depth)) out.push(b)
    }
    flush()
    return out
  }

  /** Inline content between blocks: one paragraph. */
  #loose(run: readonly Node[], scope: Scope): RawBlock[] {
    // Whitespace between blocks is layout of the source, never text.
    if (run.every((n) => n.nodeType === 3 && (n as Text).data.trim() === '')) return []
    this.#st.sizes = new Map()
    const content = this.#reader.read(run, this.#inherit(scope.inline, scope.lang))
    if (content.text === '') return []
    const attrs: Record<string, unknown> = { content, ...this.#scopeSupports(scope) }
    return this.#finish({ type: 'core/paragraph', attrs }, this.#schemas.get('core/paragraph'))
  }

  #inherit(base: Inherit, lang: string): Inherit {
    const l = (lang || this.#st.lang).toLowerCase()
    return { ...base, lang: l, base: l }
  }

  #element(el: Element, scope: Scope, depth: number): RawBlock[] {
    const tag = el.localName
    if (SILENT_DROP.has(tag)) return []
    if (el.classList.length > 0 && [...el.classList].some((c) => this.#st.classes[c] === 'drop')) return []
    if (depth > MAX_DEPTH) {
      this.#st.report.add('truncated')
      this.#st.sizes = new Map()
      const content = this.#reader.read([el], this.#inherit(scope.inline, scope.lang))
      return content.text === '' ? [] : this.#finish({ type: 'core/paragraph', attrs: { content } }, this.#schemas.get('core/paragraph'))
    }
    const mapped = this.#mappedBlock(el)
    if (mapped) {
      this.#st.sizes = new Map()
      const content = this.#reader.read(el.childNodes, this.#inherit(this.#reader.styled(el, scope.inline), scope.lang))
      return this.#finish({ type: mapped.block, attrs: { ...this.#supports(el, scope), content, ...mapped.attrs } }, this.#schemas.get(mapped.block))
    }
    for (const bound of this.#rules) {
      if (!el.matches(bound.rule.selector)) continue
      const schema = this.#schemas.get(bound.type)!
      const container = schema.children !== undefined && schema.children !== false
      const text = !container && attrSpecs(schema).content?.type === 'richtext'
      if (text && [...el.childNodes].some((c) => this.#blockish(c))) return this.#split(el, bound, scope, depth)
      const block = this.#apply(el, bound, scope, depth)
      if (block) return block
    }
    if (REPORTED_DROP.has(tag)) { this.#st.report.add('element', tag); return [] }
    if (tag === 'details' || tag === 'fieldset' || tag === 'form') this.#st.report.add('structure', tag)
    return this.#blocks([...el.childNodes], this.#scope(el, scope), depth + 1)
  }

  /** Text with blocks inside (a picture in a paragraph): the text before, the block, the text after, each its own part. */
  #split(el: Element, bound: Bound, scope: Scope, depth: number): RawBlock[] {
    const out: RawBlock[] = []
    const inner = this.#scope(el, scope, false)
    let run: Node[] = []
    const flush = (): void => {
      if (run.length === 0) return
      const part = el.cloneNode(false) as Element
      part.removeAttribute('id')
      for (const n of run) part.append(n.cloneNode(true))
      run = []
      if (part.textContent.trim() === '' && !part.querySelector('img, br')) return
      for (const b of this.#apply(part, bound, scope, depth) ?? []) out.push(b)
    }
    for (const c of [...el.childNodes]) {
      if (this.#blockish(c)) { flush(); for (const b of this.#blocks([c], inner, depth + 1)) out.push(b) } else run.push(c)
    }
    flush()
    // The first part keeps the element's anchor, so links to it still land.
    if (el.id && out[0]) {
      const anchor = this.#anchor(el)
      if (anchor) out[0] = { ...out[0], attrs: { ...out[0].attrs, anchor } }
    }
    return out
  }

  #apply(el: Element, bound: Bound, scope: Scope, depth: number): RawBlock[] | null {
    const schema = this.#schemas.get(bound.type)!
    this.#st.sizes = new Map()
    this.#media = undefined
    const ctx = this.#context(el, scope)
    const match = bound.rule.parse(el, ctx)
    if (!match) return null
    // Set by ctx.picture while the rule ran.
    const media = this.#media as number | undefined
    const sizes = this.#st.sizes
    // A container that carries the language itself does not hand it to its children again.
    let children: RawBlock[] | undefined
    if (match.children) {
      const inner = this.#scope(el, scope, false)
      children = this.#blocks([...match.children], schema.supports?.language ? { ...inner, lang: '', dir: '' } : inner, depth + 1)
      // An empty table cell still needs a paragraph to keep its column and accept a caret.
      if (bound.type === 'core/table-cell' && children.length === 0) children.push({ type: 'core/paragraph', attrs: {} })
    }
    const raw: RawBlock = { type: bound.type, attrs: match.attrs, ...(children ? { children } : {}), ...(media !== undefined ? { media } : {}) }
    return this.#finish(raw, schema, sizes)
  }

  /** Attributes kept to the schema, a uniform colour lifted to the block, empty text dropped, font size noted. */
  #finish(raw: RawBlock, schema: BlockSchema | undefined, sizes = this.#st.sizes): RawBlock[] {
    if (!schema) return []
    const specs = attrSpecs(schema)
    let attrs: Record<string, unknown> = Object.fromEntries(Object.entries(raw.attrs).filter(([k, v]) => k in specs && v !== undefined))
    const content = attrs.content as RichTextValue | undefined
    const container = schema.children !== undefined && schema.children !== false
    // A player or file without an address shows nothing; only a picture waiting for its upload keeps its place.
    const address = (['src', 'url'] as const).find((k) => specs[k]?.type === 'url') ?? (!specs.content && specs.href?.type === 'url' ? 'href' : null)
    if (address && attrs[address] === '' && raw.media === undefined) {
      this.#st.report.add('element', schema.name.replace(/^core\//, ''))
      return []
    }
    if (content && specs.content?.type === 'richtext' && !container && !this.#st.exact && content.text.trim() === '' && !content.text.includes('￼')) {
      this.#st.report.add('empty')
      return []
    }
    if (content && schema.supports?.color && !attrs.color && !this.#st.exact) {
      const whole = content.formats.filter((f) => f.type === 'color' && f.start === 0 && f.end === content.text.length)
      if (whole.length === 1 && content.text !== '') {
        attrs = { ...attrs, color: whole[0]!.attrs?.color ?? '', content: normalize({ text: content.text, formats: content.formats.filter((f: FormatRange) => f !== whole[0]) }, this.#st.formats) }
      }
    }
    let fontPx: number | undefined, chars = 0
    const styled = [...sizes].filter(([px]) => px !== null)
    for (const [, n] of sizes) chars += n
    if (styled.length === 1 && !sizes.has(null)) fontPx = styled[0]![0]!
    else if (styled.length > 1 || (styled.length === 1 && sizes.has(null))) {
      // Sizes that change inside one block cannot become a preset.
      if (!this.#st.exact) this.#st.report.add('size')
    }
    return [{ ...raw, attrs, ...(fontPx !== undefined ? { fontPx } : {}), chars }]
  }

  /** What an unwrapped element passes on: its inline styles, alignment, language and direction. */
  #scope(el: Element, scope: Scope, report = true): Scope {
    const style = parseStyle(el.getAttribute('style'))
    const dir = el.getAttribute('dir') ?? scope.dir
    const align = style.get('text-align') ?? el.getAttribute('align') ?? (el.localName === 'center' ? 'center' : null)
    const lang = BLOCK_TAGS.has(el.localName) ? el.getAttribute('lang')?.trim() ?? scope.lang : scope.lang
    return {
      inline: this.#reader.styled(el, scope.inline),
      textAlign: align === null ? scope.textAlign : this.#textAlign(align, dir, report),
      lang,
      dir,
    }
  }

  #textAlign(value: string, dir: string, report = true): string {
    switch (value.trim().toLowerCase()) {
      case 'center': case 'middle': return 'center'
      case 'left': return dir === 'rtl' ? 'end' : ''
      case 'right': return dir === 'rtl' ? '' : 'end'
      case 'end': return 'end'
      case 'start': return ''
      case 'justify':
        // Off by default because it harms readability; a host may offer it.
        if (this.#st.justify === true) return 'justify'
        if (report) this.#st.report.add('justify')
        return ''
      default: return ''
    }
  }

  #scopeSupports(scope: Scope): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    if (scope.textAlign) out.textAlign = scope.textAlign
    const lang = scope.lang.toLowerCase()
    if (lang && lang !== this.#st.lang) out.lang = scope.lang
    if (scope.dir === 'rtl') out.dir = 'rtl'
    return out
  }

  #anchor(el: Element): string {
    const id = el.id || (el.localName === 'a' ? el.getAttribute('name') ?? '' : '')
    if (!/^[A-Za-z][\w-]{0,99}$/.test(id) || this.#anchors.has(id)) return ''
    if (!this.#st.exact && !this.#referenced.has(id)) return ''
    this.#anchors.add(id)
    return id
  }

  #supports(el: Element, scope: Scope): Record<string, unknown> {
    const st = this.#st
    const out: Record<string, unknown> = {}
    const classes = [...el.classList]
    const cls = (prefix: string): string | undefined => classes.find((c) => c.startsWith(prefix))?.slice(prefix.length)
    let anchor = this.#anchor(el)
    if (anchor === '' && !st.exact) {
      // TinyMCE's anchor plugin puts an empty named link at the start of the text.
      const a = el.querySelector(':scope > a[id]:empty, :scope > a[name]:empty')
      if (a) anchor = this.#anchor(a)
    }
    if (anchor) out.anchor = anchor
    const style = parseStyle(el.getAttribute('style'))
    const dir = el.getAttribute('dir') ?? scope.dir
    const textClass = cls('pz-text-')
    if (textClass) out.textAlign = textClass
    else {
      const align = style.get('text-align') ?? el.getAttribute('align')
      const value = align === null ? scope.textAlign : this.#textAlign(align, dir)
      if (value) out.textAlign = value
    }
    const lang = el.getAttribute('lang')?.trim() ?? (st.exact ? '' : scope.lang)
    if (lang && (st.exact || lang.toLowerCase() !== st.lang)) out.lang = lang
    const elDir = el.getAttribute('dir')
    if (st.exact ? elDir === 'rtl' || elDir === 'ltr' : dir === 'rtl') out.dir = st.exact ? elDir : 'rtl'
    for (const [key, prefix] of [['align', 'pz-align-'], ['size', 'pz-size-'], ['color', 'pz-color-'], ['bleed', 'pz-bleed-'], ['variant', 'pz-style-']] as const) {
      const v = cls(prefix)
      if (v) out[key] = v
    }
    if (!st.exact && !/^(?:li|ul|ol|menu)$/.test(el.localName)) {
      for (const prop of ['margin-left', 'padding-left', 'text-indent', 'margin-inline-start', 'padding-inline-start']) {
        const len = style.get(prop) ? parseLength(style.get(prop)!) : null
        if (len && 'px' in len && len.px >= 20) { st.report.add('indent'); break }
      }
    }
    return out
  }

  #context(el: Element, scope: Scope): ParseContext {
    const st = this.#st
    const lang = el.getAttribute('lang')?.trim() || scope.lang
    const styled = this.#reader.styled(el, scope.inline)
    // A block on an inline element (a button's link): its language is the block's (`supports`), not a span in its text.
    const own = !BLOCK_TAGS.has(el.localName) && el.hasAttribute('lang')
    const inherit = this.#inherit(own ? { ...styled, marks: new Map([...styled.marks].filter(([k]) => k !== 'lang')) } : styled, lang)
    return {
      source: st.source,
      richText: (nodes, options) => {
        const list = 'nodeType' in nodes ? [nodes] : [...nodes]
        return this.#reader.read(list, inherit, options?.preformatted ?? false)
      },
      supports: (target) => this.#supports(target, scope),
      url: (raw) => {
        if (raw === null || raw === undefined || raw.trim() === '') return ''
        const safe = safeUrl(raw)
        if (safe === null) { st.report.add('link', raw.slice(0, 40)); return '' }
        return safe
      },
      picture: (raw) => this.#picture(raw ?? ''),
      imageLayout: (img) => this.#imageLayout(img, scope),
      blockish: (node) => this.#blockish(node),
      takeNext: (target, selector) => {
        let n = target.nextSibling
        while (n && n.nodeType !== 1) { if ((n.textContent ?? '').trim() !== '') return null; n = n.nextSibling }
        const next = n as Element | null
        if (!next || this.#consumed.has(next) || !next.matches(selector)) return null
        this.#consumed.add(next)
        return next
      },
      report: (code, detail) => { st.report.add(code, detail) },
    }
  }

  #picture(raw: string): string {
    const st = this.#st
    const s = raw.trim()
    if (s === '') return ''
    const data = RASTER.exec(s)
    if (data) {
      const type = data[1]!.toLowerCase().replace('jpg', 'jpeg')
      try {
        const bin = atob(data[2]!.replace(/\s+/g, ''))
        const bytes = new Uint8Array(bin.length)
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
        const name = `picture-${this.pending.length + 1}.${type.split('/')[1]!.replace('jpeg', 'jpg')}`
        this.pending.push({ file: new File([bytes], name, { type }), name })
        this.#media = this.pending.length - 1
      } catch {
        st.report.add('image-dropped', 'data:')
      }
      return ''
    }
    if (/^(?:file|blob|cid|webkit-fake-url|ms-appx):/i.test(s) || /^[a-z]:\\/i.test(s)) {
      this.pending.push({ file: null, name: decodeName(s) })
      this.#media = this.pending.length - 1
      return ''
    }
    const safe = safeUrl(s)
    if (safe === null || /^data:/i.test(s)) { st.report.add('image-dropped', s.slice(0, 40)); return '' }
    if ((st.source === 'google-docs' || st.source === 'word-web') && /^https?:/i.test(safe)) st.report.add('image-remote', hostOf(safe))
    return safe
  }

  #imageLayout(img: Element, scope: Scope): { width?: 's' | 'm' | 'l'; align?: 'start' | 'center' | 'end' } {
    const out: { width?: 's' | 'm' | 'l'; align?: 'start' | 'center' | 'end' } = {}
    const style = parseStyle(img.getAttribute('style'))
    const rawWidth = style.get('width') ?? img.getAttribute('width')
    const width = rawWidth ? parseLength(rawWidth) : null
    if (width && ('percent' in width || width.px > 0)) out.width = widthPreset(width)
    const holder = img.parentElement?.localName === 'a' ? img.parentElement : img
    const wrapStyle = holder !== img ? parseStyle(holder.getAttribute('style')) : new Map<string, string>()
    const float = (style.get('float') ?? wrapStyle.get('float') ?? img.getAttribute('align') ?? '').toLowerCase()
    const classes = [...img.classList, ...(holder !== img ? holder.classList : [])].join(' ')
    if (float === 'left' || /\balign-?left\b|\bimage-left\b|\bfloat-?left\b/.test(classes)) out.align = scope.dir === 'rtl' ? 'end' : 'start'
    else if (float === 'right' || /\balign-?right\b|\bimage-right\b|\bfloat-?right\b/.test(classes)) out.align = scope.dir === 'rtl' ? 'start' : 'end'
    else if (float === 'center' || float === 'middle' || /\balign-?center\b|\bcenter\b/.test(classes)
      || (style.get('margin-left') === 'auto' && style.get('margin-right') === 'auto') || /^(?:\S+\s+)?auto\b/.test(style.get('margin') ?? '')
      || scope.textAlign === 'center') out.align = 'center'
    return out
  }
}

function decodeName(path: string): string {
  const last = path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
  try { return decodeURIComponent(last) } catch { return last }
}

function hostOf(url: string): string {
  return /^https?:\/\/([^/?#]+)/i.exec(url)?.[1] ?? url
}
