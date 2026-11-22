/**
 * Rich-text values: plain text plus format ranges.
 *
 * Every function here is pure and returns a normalized value. No DOM.
 */
import { safeUrl } from './url'

export type FormatAttrs = Readonly<Record<string, string>>

export interface FormatRange {
  readonly type: string
  /** Offset into text, inclusive. */
  readonly start: number
  /** Offset into text, exclusive. */
  readonly end: number
  readonly attrs?: FormatAttrs
}

export interface RichTextValue {
  /** Plain text. "\n" is a soft line break. */
  readonly text: string
  readonly formats: readonly FormatRange[]
}

/** A format without a position: what a typed character will carry. */
export interface Mark {
  readonly type: string
  readonly attrs?: FormatAttrs
}

/**
 * How a format attribute is checked. A value that fails
 * is dropped; a required attribute that is missing or fails drops the format.
 */
export type FormatAttrRule =
  /** Passes the URL protocol allow-list. */
  | { readonly kind: 'url'; readonly required?: boolean }
  /** Plain text, at most `maxLength` characters (10,000 when not given). */
  | { readonly kind: 'text'; readonly required?: boolean; readonly maxLength?: number }
  /** A named preset from the host theme, rendered as the class `pz-<type>-<value>` (no inline styles). */
  | { readonly kind: 'preset'; readonly required?: boolean }
  /** BCP 47 language tag. */
  | { readonly kind: 'lang'; readonly required?: boolean }
  /** Positive integer, such as an image dimension in CSS pixels. */
  | { readonly kind: 'size'; readonly required?: boolean }
  | { readonly kind: 'enum'; readonly values: readonly string[]; readonly required?: boolean }

export interface FormatSpec {
  readonly type: string
  /** HTML element the format renders to. */
  readonly tag: string
  /** Lower renders further out. Fixes nesting so one value has one HTML string. */
  readonly priority: number
  /** Typing at the end of the range extends it (bold does, a link does not). */
  readonly inclusive: boolean
  /** Attributes in output order. Presets become classes, the rest element attributes. */
  readonly attrs?: Readonly<Record<string, FormatAttrRule>>
  /** Formats removed when this one is applied (subscript excludes superscript). */
  readonly excludes?: readonly string[]
  /**
   * An inline object (image, footnote reference): it is the one character
   * U+FFFC, its range is always one character long, and it has no text of its own.
   */
  readonly object?: boolean
  /** Class the element always has. Tells formats with the same tag apart (footnote and superscript). */
  readonly className?: string
  /**
   * The object renders a link of its own (a footnote reference), so a link
   * never covers it: HTML has no link inside a link, and a parser would tear
   * the outer one apart.
   */
  readonly ownLink?: boolean
}

export type FormatRegistry = ReadonlyMap<string, FormatSpec>

/** The character an inline object occupies. */
export const OBJECT_CHAR = '\uFFFC'

export const LANG_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/
const PRESET_PATTERN = /^[a-z][a-z0-9-]{0,39}$/
const SIZE_PATTERN = /^[1-9]\d{0,4}$/
const TEXT_MAX = 10_000
/** Names of format types: what loaded JSON and the clipboard may carry. */
export const FORMAT_TYPE = /^[a-z][a-z0-9-]{0,63}$/
/**
 * Formats the registry does not know (a plugin not installed yet) are kept for
 * later, within limits: each type nests one element deeper in output and its
 * attributes are copied onto every piece, so both are bounded.
 */
export const MAX_UNKNOWN_TYPES = 16
const UNKNOWN_ATTRS = 16
const ATTR_NAME_MAX = 64

const spec = (s: FormatSpec): [string, FormatSpec] => [s.type, s]

/** The standard inline formats. */
export const defaultFormats: FormatRegistry = new Map([
  spec({ type: 'link', tag: 'a', priority: 10, inclusive: false, attrs: { href: { kind: 'url', required: true }, target: { kind: 'enum', values: ['_blank'] } } }),
  spec({ type: 'lang', tag: 'span', priority: 20, inclusive: false, attrs: { lang: { kind: 'lang', required: true }, dir: { kind: 'enum', values: ['ltr', 'rtl'] } } }),
  spec({ type: 'bold', tag: 'strong', priority: 30, inclusive: true }),
  spec({ type: 'italic', tag: 'em', priority: 31, inclusive: true }),
  spec({ type: 'underline', tag: 'u', priority: 32, inclusive: true }),
  spec({ type: 'strikethrough', tag: 's', priority: 33, inclusive: true }),
  spec({ type: 'subscript', tag: 'sub', priority: 34, inclusive: true, excludes: ['superscript'] }),
  spec({ type: 'superscript', tag: 'sup', priority: 35, inclusive: true, excludes: ['subscript'] }),
  spec({ type: 'color', tag: 'span', priority: 36, inclusive: true, attrs: { color: { kind: 'preset', required: true } } }),
  spec({ type: 'highlight', tag: 'mark', priority: 40, inclusive: true, attrs: { color: { kind: 'preset' } } }),
  spec({ type: 'abbr', tag: 'abbr', priority: 45, inclusive: false, attrs: { title: { kind: 'text', required: true, maxLength: 1_000 } } }),
  spec({ type: 'code', tag: 'code', priority: 50, inclusive: false }),
  spec({ type: 'kbd', tag: 'kbd', priority: 51, inclusive: false }),
  spec({
    type: 'image', tag: 'img', priority: 90, inclusive: false, object: true,
    attrs: { src: { kind: 'url', required: true }, alt: { kind: 'text', required: true }, width: { kind: 'size' }, height: { kind: 'size' } },
  }),
  spec({ type: 'footnote', tag: 'sup', priority: 91, inclusive: false, object: true, ownLink: true, className: 'pz-fn', attrs: { note: { kind: 'text', required: true } } }),
])

/** One attribute value after its rule, or null when it fails. */
export function checkFormatAttr(rule: FormatAttrRule, value: unknown): string | null {
  if (typeof value !== 'string') return null
  switch (rule.kind) {
    case 'url': return value.trim() === '' ? null : safeUrl(value)
    // eslint-disable-next-line no-control-regex -- control characters cannot be shown or round-tripped
    case 'text': return value.length <= (rule.maxLength ?? TEXT_MAX) && !/[\u0000-\u0008\u000B-\u001F\u007F]/.test(value) ? value : null
    case 'preset': return PRESET_PATTERN.test(value) ? value : null
    case 'lang': return value.length <= 35 && LANG_PATTERN.test(value) ? value : null
    case 'size': return SIZE_PATTERN.test(value) ? value : null
    case 'enum': return rule.values.includes(value) ? value : null
  }
}

/**
 * Attributes of a known format after its rules: unknown ones dropped, failing
 * ones dropped, null when a required one is missing. For a format the registry
 * does not know, string attributes pass unchanged so they survive until it is installed;
 * more than 16 of them, a name over 64 characters or a value over 10,000 refuse the format.
 */
export function checkFormatAttrs(type: string, attrs: Readonly<Record<string, unknown>> | undefined, registry: FormatRegistry = defaultFormats): FormatAttrs | null {
  const s = registry.get(type)
  if (!s) {
    const out = Object.entries(attrs ?? {}).filter((e): e is [string, string] => typeof e[1] === 'string')
    if (out.length > UNKNOWN_ATTRS || out.some(([k, v]) => k.length > ATTR_NAME_MAX || v.length > TEXT_MAX)) return null
    return Object.fromEntries(out)
  }
  const out: Record<string, string> = {}
  for (const [name, rule] of Object.entries(s.attrs ?? {})) {
    const v = attrs?.[name] === undefined ? null : checkFormatAttr(rule, attrs[name])
    if (v !== null) out[name] = v
    else if (rule.required) return null
  }
  return out
}

/**
 * Element attributes of a format: the class first (fixed class, then presets
 * as `pz-<type>-<value>`), then the other attributes in spec order. The field's
 * DOM and the renderer both use it, so editor and output match.
 */
export function formatAttrs(spec: FormatSpec, range: FormatRange): Record<string, string> {
  const classes = spec.className ? [spec.className] : []
  const attrs: Record<string, string> = {}
  for (const [name, rule] of Object.entries(spec.attrs ?? {})) {
    const v = range.attrs?.[name]
    if (v === undefined || checkFormatAttr(rule, v) === null) continue
    if (rule.kind === 'preset') classes.push(`pz-${spec.type}-${v}`)
    else attrs[name] = v
  }
  // A page opened in a new window must not reach back through window.opener.
  if (spec.tag === 'a' && attrs.target === '_blank') attrs.rel = 'noopener'
  return classes.length > 0 ? { class: classes.join(' '), ...attrs } : attrs
}

/**
 * A check for the formats of one value: known types pass, others need a valid
 * name and only the first MAX_UNKNOWN_TYPES distinct ones are admitted.
 */
export function formatTypeGate(registry: FormatRegistry = defaultFormats): (type: string) => boolean {
  const unknown = new Set<string>()
  return (type) => {
    if (registry.has(type) || unknown.has(type)) return true
    if (unknown.size >= MAX_UNKNOWN_TYPES || !FORMAT_TYPE.test(type)) return false
    unknown.add(type)
    return true
  }
}

export function isObjectFormat(type: string, registry: FormatRegistry = defaultFormats): boolean {
  return registry.get(type)?.object === true
}

const UNKNOWN_PRIORITY = 1000

export function formatSpec(type: string, registry: FormatRegistry = defaultFormats): FormatSpec | undefined {
  return registry.get(type)
}

function priority(type: string, registry: FormatRegistry): number {
  return registry.get(type)?.priority ?? UNKNOWN_PRIORITY
}

// ---------------------------------------------------------------------------
// Construction and comparison

export const EMPTY: RichTextValue = Object.freeze({ text: '', formats: Object.freeze<FormatRange[]>([]) })

export function createValue(text = '', formats: readonly FormatRange[] = [], registry: FormatRegistry = defaultFormats): RichTextValue {
  return normalize({ text, formats }, registry)
}

/** Stable key for a set of attributes: sorted, so key order never matters. */
export function attrsKey(attrs: FormatAttrs | undefined): string {
  if (!attrs) return ''
  const keys = Object.keys(attrs).sort()
  return keys.length === 0 ? '' : JSON.stringify(keys.map((k) => [k, attrs[k]]))
}

export function marksEqual(a: Mark, b: Mark): boolean {
  return a.type === b.type && attrsKey(a.attrs) === attrsKey(b.attrs)
}

export function valuesEqual(a: RichTextValue, b: RichTextValue): boolean {
  if (a.text !== b.text || a.formats.length !== b.formats.length) return false
  return a.formats.every((f, i) => {
    const g = b.formats[i]!
    return f.start === g.start && f.end === g.end && marksEqual(f, g)
  })
}

// ---------------------------------------------------------------------------
// Normalization

function makeRange(type: string, start: number, end: number, attrs: FormatAttrs | undefined): FormatRange {
  return attrs && Object.keys(attrs).length > 0 ? { type, start, end, attrs: { ...attrs } } : { type, start, end }
}

/**
 * Guarantees the invariants of a rich-text value:
 * - ranges are non-empty, inside the text and sorted;
 * - an object range covers exactly one U+FFFC;
 * - ranges of one type never overlap (a later range wins where two disagree on attributes);
 * - touching or overlapping ranges of the same type and attributes are merged.
 *
 * Sort order: start, then priority, then type, then end. Deterministic for any input order.
 */
export function normalize(value: RichTextValue, registry: FormatRegistry = defaultFormats): RichTextValue {
  const len = value.text.length
  const byType = new Map<string, FormatRange[]>()
  for (const f of value.formats) {
    const start = Math.max(0, Math.min(len, Math.trunc(f.start)))
    const end = Math.max(0, Math.min(len, Math.trunc(f.end)))
    if (!(start < end) || !f.type) continue
    let list = byType.get(f.type)
    if (!list) byType.set(f.type, (list = []))
    list.push(makeRange(f.type, start, end, f.attrs))
  }

  // Characters holding an object that is a link of its own: link ranges leave them out.
  const ownLinks: number[] = []
  for (const f of value.formats) {
    if (registry.get(f.type)?.ownLink && value.text[f.start] === OBJECT_CHAR && f.end - f.start === 1) ownLinks.push(f.start)
  }
  const out: FormatRange[] = []
  for (const [type, ranges] of byType) {
    // Painted over the segments between this type's own boundaries, never over every character:
    // a type costs its ranges, so many types over a long text stay linear.
    const holes = registry.get(type)?.tag === 'a' ? ownLinks : []
    const bounds = new Set<number>()
    for (const r of ranges) { bounds.add(r.start); bounds.add(r.end) }
    for (const at of holes) { bounds.add(at); bounds.add(at + 1) }
    const cuts = [...bounds].sort((a, b) => a - b)
    const index = new Map(cuts.map((c, i) => [c, i]))
    const n = cuts.length - 1
    // Each segment belongs to the last range over it. Painted from the last range back, skipping
    // segments already taken (`next`: the first free one at or after an index, with path halving).
    const owner = new Int32Array(n).fill(-1)
    const next = new Int32Array(n + 1).map((_, i) => i)
    const free = (from: number): number => {
      let i = from
      while (next[i] !== i) { next[i] = next[next[i]!]!; i = next[i]! }
      return i
    }
    for (let k = ranges.length - 1; k >= 0; k--) {
      const r = ranges[k]!, end = index.get(r.end)!
      for (let i = free(index.get(r.start)!); i < end; i = free(i + 1)) { owner[i] = k; next[i] = i + 1 }
    }
    for (const at of holes) owner[index.get(at)!] = -1
    const keys = ranges.map((r) => attrsKey(r.attrs))
    // Two pictures side by side are two objects, so object ranges never merge and sit only on U+FFFC.
    const object = registry.get(type)?.object === true
    // The next U+FFFC at or after the segment: it only moves forward, so the text is scanned once.
    let obj = object ? value.text.indexOf(OBJECT_CHAR) : -1
    for (let i = 0; i < n; i++) {
      const o = owner[i]!
      if (o < 0) continue
      const attrs = ranges[o]!.attrs
      if (object) {
        if (obj >= 0 && obj < cuts[i]!) obj = value.text.indexOf(OBJECT_CHAR, cuts[i])
        for (; obj >= 0 && obj < cuts[i + 1]!; obj = value.text.indexOf(OBJECT_CHAR, obj + 1)) out.push(makeRange(type, obj, obj + 1, attrs))
        continue
      }
      let j = i + 1
      while (j < n && owner[j]! >= 0 && keys[owner[j]!] === keys[o]) j++
      out.push(makeRange(type, cuts[i]!, cuts[j]!, attrs))
      i = j - 1
    }
  }

  out.sort((a, b) => a.start - b.start || priority(a.type, registry) - priority(b.type, registry) || cmp(a.type, b.type) || a.end - b.end)
  return { text: value.text, formats: out }
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

// ---------------------------------------------------------------------------
// Nesting

/** A text run, or one format element wrapping more nodes. Text keeps its "\n". */
export type RichNode = { readonly text: string } | { readonly format: FormatRange; readonly children: readonly RichNode[] }

/**
 * The element tree a normalized value renders to. Both the field's DOM and the
 * published HTML are built from it, so the editor and the output nest alike.
 * Lower priority opens further out; one range is at most one element unless a
 * range of lower priority starts or ends inside it.
 */
export function toTree(value: RichTextValue, registry: FormatRegistry = defaultFormats): RichNode[] {
  const { text, formats } = value
  const cuts = new Set<number>([0, text.length])
  for (const f of formats) { cuts.add(f.start); cuts.add(f.end) }
  const points = [...cuts].sort((a, b) => a - b)

  const root: RichNode[] = []
  // Open elements, each tied to the FormatRange instance it renders (after normalize, identity is the range).
  const stack: { range: FormatRange; children: RichNode[] }[] = []
  const top = (): RichNode[] => stack.at(-1)?.children ?? root
  // A sweep: ranges join the open set where they start and leave where they end, so each
  // segment looks at the few ranges over it (one per type), not at every range in the value.
  const byStart = [...formats].sort((x, y) => x.start - y.start)
  let open: FormatRange[] = []
  let added = 0

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]!, b = points[i + 1]!
    open = open.filter((f) => f.end > a)
    while (added < byStart.length && byStart[added]!.start <= a) { const f = byStart[added++]!; if (f.end > a) open.push(f) }
    const active = open
      .filter((f) => b <= f.end)
      .sort((x, y) => priority(x.type, registry) - priority(y.type, registry) || x.start - y.start || y.end - x.end || cmp(x.type, y.type))
    let keep = 0
    while (keep < stack.length && keep < active.length && stack[keep]!.range === active[keep]) keep++
    stack.length = keep
    for (let k = keep; k < active.length; k++) {
      const children: RichNode[] = []
      top().push({ format: active[k]!, children })
      stack.push({ range: active[k]!, children })
    }
    top().push({ text: text.slice(a, b) })
  }
  return root
}

// ---------------------------------------------------------------------------
// Queries

/** Formats covering the character at `offset`. */
export function formatsAt(value: RichTextValue, offset: number): FormatRange[] {
  return value.formats.filter((f) => f.start <= offset && offset < f.end)
}

export function marksAt(value: RichTextValue, offset: number): Mark[] {
  return formatsAt(value, offset).map(toMark)
}

function toMark(f: FormatRange | Mark): Mark {
  return f.attrs ? { type: f.type, attrs: f.attrs } : { type: f.type }
}

/**
 * Marks a character typed at a collapsed caret receives.
 *
 * - Inside a range: all its formats.
 * - At the end of a range: only inclusive formats (typing after a link is not linked).
 * - At offset 0: inclusive formats of the first character, as in word processors.
 */
export function inheritedMarks(value: RichTextValue, offset: number, registry: FormatRegistry = defaultFormats): Mark[] {
  if (value.text.length === 0) return []
  if (offset <= 0) {
    return formatsAt(value, 0).filter((f) => registry.get(f.type)?.inclusive === true && f.start === 0).map(toMark)
  }
  return formatsAt(value, offset - 1)
    .filter((f) => f.end > offset || registry.get(f.type)?.inclusive === true)
    .map(toMark)
}

/**
 * Marks for text that replaces [start, end): the formats of the first replaced
 * character (autocorrect inside a link stays linked), or at a collapsed caret
 * the inheritance rule. Never an object: typed text is text.
 */
export function typingMarks(value: RichTextValue, start: number, end: number, registry: FormatRegistry = defaultFormats): Mark[] {
  if (start >= end) return inheritedMarks(value, start, registry)
  return marksAt(value, start).filter((m) => registry.get(m.type)?.object !== true)
}

/** The range of `type` around a collapsed caret: one containing it, else one ending or starting at it. */
export function formatRangeAt(value: RichTextValue, offset: number, type: string): FormatRange | null {
  const list = value.formats.filter((f) => f.type === type)
  return list.find((f) => f.start < offset && offset < f.end)
    ?? list.find((f) => f.end === offset)
    ?? list.find((f) => f.start === offset)
    ?? null
}

/** The inline object at character `offset`, if there is one. */
export function objectAt(value: RichTextValue, offset: number, registry: FormatRegistry = defaultFormats): FormatRange | null {
  return value.formats.find((f) => f.start === offset && registry.get(f.type)?.object === true) ?? null
}

/** True when every character in [start, end) carries `type`. Collapsed ranges are never active. */
export function isFormatActive(value: RichTextValue, start: number, end: number, type: string): boolean {
  if (!(start < end)) return false
  let covered = start
  for (const f of value.formats) {
    if (f.type !== type || f.end <= covered || f.start > covered) continue
    covered = f.end
    if (covered >= end) return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Editing

export function slice(value: RichTextValue, start: number, end: number = value.text.length): RichTextValue {
  const s = clamp(start, value.text.length)
  const e = Math.max(s, clamp(end, value.text.length))
  const formats: FormatRange[] = []
  for (const f of value.formats) {
    const a = Math.max(f.start, s)
    const b = Math.min(f.end, e)
    if (a < b) formats.push(makeRange(f.type, a - s, b - s, f.attrs))
  }
  return { text: value.text.slice(s, e), formats }
}

export function concat(values: readonly RichTextValue[], registry: FormatRegistry = defaultFormats): RichTextValue {
  let text = ''
  const formats: FormatRange[] = []
  for (const v of values) {
    const shift = text.length
    for (const f of v.formats) formats.push(makeRange(f.type, f.start + shift, f.end + shift, f.attrs))
    text += v.text
  }
  return normalize({ text, formats }, registry)
}

/** Replace [start, end) with `insert`. The core primitive behind every text edit. */
export function replace(value: RichTextValue, start: number, end: number, insert: RichTextValue, registry: FormatRegistry = defaultFormats): RichTextValue {
  const s = clamp(start, value.text.length)
  const e = Math.max(s, clamp(end, value.text.length))
  return concat([slice(value, 0, s), insert, slice(value, e)], registry)
}

/** A value whose whole text carries `marks`. */
export function marked(text: string, marks: readonly Mark[]): RichTextValue {
  return { text, formats: text.length === 0 ? [] : marks.map((m) => makeRange(m.type, 0, text.length, m.attrs)) }
}

export function insertText(value: RichTextValue, offset: number, text: string, marks?: readonly Mark[], registry: FormatRegistry = defaultFormats): RichTextValue {
  return replace(value, offset, offset, marked(text, marks ?? inheritedMarks(value, offset, registry)), registry)
}

export function deleteRange(value: RichTextValue, start: number, end: number, registry: FormatRegistry = defaultFormats): RichTextValue {
  return replace(value, start, end, EMPTY, registry)
}

export function split(value: RichTextValue, offset: number): [RichTextValue, RichTextValue] {
  return [slice(value, 0, offset), slice(value, offset)]
}

/** Replace [start, end) with one inline object, carrying `around` or the marks typed text there would get. */
export function insertObject(value: RichTextValue, start: number, end: number, mark: Mark, registry: FormatRegistry = defaultFormats, around?: readonly Mark[]): RichTextValue {
  if (registry.get(mark.type)?.object !== true) return value
  const marks = [...(around ?? typingMarks(value, start, end, registry)), toMark(mark)]
  return replace(value, start, end, marked(OBJECT_CHAR, marks), registry)
}

/** Replace the attributes of the object at `offset` (a picture's alternative text, a footnote's text). */
export function setObjectAttrs(value: RichTextValue, offset: number, attrs: FormatAttrs, registry: FormatRegistry = defaultFormats): RichTextValue {
  const target = objectAt(value, offset, registry)
  if (!target) return value
  const formats = value.formats.map((f) => (f === target ? makeRange(f.type, f.start, f.end, attrs) : f))
  return normalize({ text: value.text, formats }, registry)
}

/**
 * Remove U+FFFC characters that carry no object, so offsets and output never
 * hold an invisible character (pasted text, a damaged document, a removed object).
 */
export function dropOrphanObjects(value: RichTextValue, registry: FormatRegistry = defaultFormats): RichTextValue {
  const objects = new Set<number>()
  for (const f of value.formats) if (registry.get(f.type)?.object === true) objects.add(f.start)
  const { text } = value
  // One pass: `map[i]` is where stored offset i lands once the orphans before it are gone.
  const map = new Int32Array(text.length + 1)
  let out = ''
  let from = 0
  for (let i = text.indexOf(OBJECT_CHAR); i >= 0; i = text.indexOf(OBJECT_CHAR, i + 1)) {
    if (objects.has(i)) continue
    for (let k = from; k <= i; k++) map[k] = k - from + out.length
    out += text.slice(from, i)
    from = i + 1
  }
  if (from === 0) return value
  for (let k = from; k <= text.length; k++) map[k] = k - from + out.length
  out += text.slice(from)
  const formats = value.formats.map((f) => makeRange(f.type, map[f.start]!, map[f.end]!, f.attrs))
  return normalize({ text: out, formats }, registry)
}

/** Objects are inserted and deleted as characters (insertObject), not applied over text. */
export function applyFormat(value: RichTextValue, start: number, end: number, mark: Mark, registry: FormatRegistry = defaultFormats): RichTextValue {
  if (!(start < end) || registry.get(mark.type)?.object === true) return value
  const excluded = registry.get(mark.type)?.excludes ?? []
  let v = value
  for (const type of excluded) v = removeFormat(v, start, end, type, registry)
  // Appending last makes it win over existing ranges of the same type (see normalize).
  return normalize({ text: v.text, formats: [...v.formats, makeRange(mark.type, start, end, mark.attrs)] }, registry)
}

/** Objects are not removed this way: that would leave a bare U+FFFC. Delete their character instead. */
export function removeFormat(value: RichTextValue, start: number, end: number, type: string, registry: FormatRegistry = defaultFormats): RichTextValue {
  if (!(start < end) || registry.get(type)?.object === true) return value
  const formats: FormatRange[] = []
  for (const f of value.formats) {
    if (f.type !== type || f.end <= start || f.start >= end) { formats.push(f); continue }
    if (f.start < start) formats.push(makeRange(f.type, f.start, start, f.attrs))
    if (f.end > end) formats.push(makeRange(f.type, end, f.end, f.attrs))
  }
  return normalize({ text: value.text, formats }, registry)
}

export function removeAllFormats(value: RichTextValue, start: number, end: number, registry: FormatRegistry = defaultFormats): RichTextValue {
  const types = new Set(value.formats.map((f) => f.type))
  let v = value
  for (const t of types) v = removeFormat(v, start, end, t, registry)
  return v
}

export function toggleFormat(value: RichTextValue, start: number, end: number, mark: Mark, registry: FormatRegistry = defaultFormats): RichTextValue {
  return isFormatActive(value, start, end, mark.type)
    ? removeFormat(value, start, end, mark.type, registry)
    : applyFormat(value, start, end, mark, registry)
}

/** Toggle a mark in a set of pending marks (collapsed caret). */
export function toggleMark(marks: readonly Mark[], mark: Mark, registry: FormatRegistry = defaultFormats): Mark[] {
  if (registry.get(mark.type)?.object === true) return [...marks]
  if (marks.some((m) => m.type === mark.type)) return marks.filter((m) => m.type !== mark.type)
  const excluded = registry.get(mark.type)?.excludes ?? []
  return [...marks.filter((m) => !excluded.includes(m.type)), toMark(mark)]
}

// ---------------------------------------------------------------------------
// Text diff, used to read back browser edits

export interface TextChange {
  /** First changed offset, same in both texts. */
  readonly start: number
  /** End of the replaced part in the old text. */
  readonly oldEnd: number
  /** End of the inserted part in the new text. */
  readonly newEnd: number
}

/**
 * The smallest single change turning `before` into `after`.
 *
 * `hint` is where the caret ended up in `after`. When the change is ambiguous
 * (typing "a" into "aa" could be at offset 0, 1 or 2), the change is placed so
 * the inserted text ends at the caret, which is what the user did.
 */
export function findChange(before: string, after: string, hint?: number): TextChange | null {
  if (before === after) return null
  const min = Math.min(before.length, after.length)
  let start = 0
  while (start < min && before.charCodeAt(start) === after.charCodeAt(start)) start++
  let suffix = 0
  while (suffix < min - start && before.charCodeAt(before.length - 1 - suffix) === after.charCodeAt(after.length - 1 - suffix)) suffix++
  let oldEnd = before.length - suffix
  let newEnd = after.length - suffix

  // Slide an ambiguous pure insertion or deletion left so it ends at the hint.
  if (hint !== undefined && (oldEnd === start) !== (newEnd === start)) {
    const inserting = newEnd > start
    const len = inserting ? newEnd - start : oldEnd - start
    const longer = inserting ? after : before
    // How far left can it slide while staying equivalent?
    const targetEnd = inserting ? hint : hint + len
    while (start > 0 && (inserting ? newEnd : oldEnd) > targetEnd && longer.charCodeAt(start - 1) === longer.charCodeAt(start - 1 + len)) {
      start--; oldEnd--; newEnd--
    }
  }
  // Never split a surrogate pair.
  if (start > 0 && (isLowSurrogate(after.charCodeAt(start)) || isLowSurrogate(before.charCodeAt(start)))) start--
  if (oldEnd < before.length && isLowSurrogate(before.charCodeAt(oldEnd))) { oldEnd++; newEnd++ }
  return { start, oldEnd, newEnd }
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc00 && code <= 0xdfff
}

function clamp(n: number, len: number): number {
  return Math.max(0, Math.min(len, n))
}
