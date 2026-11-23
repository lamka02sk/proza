/**
 * Deterministic conversion between a RichTextValue and the DOM of a field,
 * and mapping between text offsets and DOM points.
 *
 * Offsets count UTF-16 code units of `value.text`. A `<br>` counts as one
 * ("\n"), an inline object element as one (U+FFFC). The padding `<br>` that
 * keeps an empty or trailing line visible counts as zero.
 */
import type { SelectionLike } from './selection'
import {
  OBJECT_CHAR, checkFormatAttrs, defaultFormats, dropOrphanObjects, formatAttrs, normalize, toTree,
  type FormatAttrs, type FormatRange, type FormatRegistry, type FormatSpec, type RichNode, type RichTextValue,
} from '../model/richtext'
import { parseStyle } from '../model/css'
import { safeUrl } from '../model/url'

const PAD = 'data-pz-pad'
const NOTE = 'data-pz-note'
/** A legacy format's `style`, as the model has it: the field sets the declarations through the CSSOM, which a strict CSP allows. */
const STYLE = 'data-pz-style'

// ---------------------------------------------------------------------------
// Value to DOM

/** Accessible names the field DOM carries, in the interface language. */
export interface DomLabels {
  footnote(note: string): string
}

export const DEFAULT_LABELS: DomLabels = { footnote: (note) => `Footnote: ${note}` }

/** Canonical DOM for a value. The same value always produces the same nodes. */
export function toDom(value: RichTextValue, doc: Document, registry: FormatRegistry = defaultFormats, labels: DomLabels = DEFAULT_LABELS): DocumentFragment {
  const frag = doc.createDocumentFragment()
  appendNodes(frag, toTree(value, registry), doc, registry, labels)
  if (value.text.length === 0 || value.text.endsWith('\n')) {
    const pad = doc.createElement('br')
    pad.setAttribute(PAD, '')
    frag.appendChild(pad)
  }
  return frag
}

function appendNodes(parent: Node, nodes: readonly RichNode[], doc: Document, registry: FormatRegistry, labels: DomLabels): void {
  for (const node of nodes) {
    if ('text' in node) { appendText(parent, node.text, doc); continue }
    const el = createFormatElement(node.format, doc, registry, labels)
    if (registry.get(node.format.type)?.object !== true) appendNodes(el, node.children, doc, registry, labels)
    parent.appendChild(el)
  }
}

function appendText(parent: Node, text: string, doc: Document): void {
  const lines = text.split('\n')
  lines.forEach((line, i) => {
    if (i > 0) parent.appendChild(doc.createElement('br'))
    if (line) parent.appendChild(doc.createTextNode(line))
  })
}

function createFormatElement(range: FormatRange, doc: Document, registry: FormatRegistry, labels: DomLabels): Element {
  const spec = registry.get(range.type)
  if (!spec) {
    const span = doc.createElement('span')
    span.setAttribute('data-pz-format', range.type)
    return span
  }
  const el = doc.createElement(spec.tag)
  if (spec.type === 'footnote') {
    // The number is document-wide, so the field shows it with a CSS counter (richtext.css);
    // the published output numbers it in the renderer.
    el.className = spec.className ?? 'pz-fn'
    el.contentEditable = 'false'
    const note = range.attrs?.note ?? ''
    el.setAttribute(NOTE, note)
    el.setAttribute('title', note)
    // The counted number is CSS generated content, which no engine exposes inside the textbox.
    el.setAttribute('role', 'img')
    el.setAttribute('aria-label', labels.footnote(note))
    return el
  }
  for (const [name, v] of Object.entries(formatAttrs(spec, range))) {
    if (name !== 'style') { el.setAttribute(name, v); continue }
    el.setAttribute(STYLE, v)
    if (el instanceof HTMLElement) for (const [prop, value] of parseStyle(v)) el.style.setProperty(prop, value)
  }
  // An object without content of its own (a named anchor, an icon) is one character the caret passes over.
  if (spec.object && spec.tag !== 'img') el.setAttribute('contenteditable', 'false')
  if (spec.object && spec.type !== 'image') {
    el.setAttribute('data-pz-object', spec.type)
    // Markers of legacy markup (a named anchor, an icon) have no text on the page either.
    el.setAttribute('aria-hidden', 'true')
    if (spec.type === 'anchor') el.setAttribute('title', `#${range.attrs?.name ?? ''}`)
  }
  return el
}

/** URL protocol allow-list. Anything else renders as "#". */
export function safeHref(href: string): string {
  return safeUrl(href) ?? '#'
}

// ---------------------------------------------------------------------------
// DOM to value

/** Markup browsers and other editors produce for the same formats. Read back for tolerance only. */
const ALIASES: Record<string, string> = { B: 'bold', I: 'italic', INS: 'underline', STRIKE: 'strikethrough', DEL: 'strikethrough' }

const BLOCK_TAGS = new Set(['DIV', 'P', 'LI', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE'])

/**
 * An element that stands for one character: an image, or anything the
 * browser cannot edit inside (a footnote marker, an extension's widget).
 */
function isObjectElement(el: Element): boolean {
  return el.tagName === 'IMG' || el.getAttribute('contenteditable') === 'false'
}

/**
 * Read a field's DOM back into a value. Tolerates what browsers and
 * extensions leave behind: unknown wrappers are transparent, nested block
 * elements become line breaks, the trailing padding `<br>` is ignored.
 */
export function fromDom(root: Node, registry: FormatRegistry = defaultFormats): RichTextValue {
  let text = ''
  const formats: FormatRange[] = []
  const last = lastLeaf(root)

  const walk = (node: Node): void => {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === TEXT) { text += (child as Text).data; continue }
      if (child.nodeType !== ELEMENT) continue
      const el = child as Element
      if (el.tagName === 'BR') { if (el !== last) text += '\n'; continue }
      if (BLOCK_TAGS.has(el.tagName) && text.length > 0 && !text.endsWith('\n')) text += '\n'
      const format = formatOf(el, registry)
      const start = text.length
      if (isObjectElement(el)) text += OBJECT_CHAR
      else walk(el)
      if (format) formats.push(format.attrs ? { type: format.type, start, end: text.length, attrs: format.attrs } : { type: format.type, start, end: text.length })
    }
  }
  walk(root)
  return dropOrphanObjects(normalize({ text, formats }, registry), registry)
}

/** Only the text of a field, the cheap path used on every input event. */
export function textFromDom(root: Node): string {
  let text = ''
  const last = lastLeaf(root)
  const walk = (node: Node): void => {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === TEXT) text += (child as Text).data
      else if (child.nodeType === ELEMENT) {
        const el = child as Element
        if (el.tagName === 'BR') { if (el !== last) text += '\n' }
        else if (isObjectElement(el)) text += OBJECT_CHAR
        else {
          if (BLOCK_TAGS.has(el.tagName) && text.length > 0 && !text.endsWith('\n')) text += '\n'
          walk(el)
        }
      }
    }
  }
  walk(root)
  return text
}

const specOrder = new WeakMap<FormatRegistry, FormatSpec[]>()

/** Specs to try against an element: those with a fixed class first, then those with more required attributes. */
function specsByPrecision(registry: FormatRegistry): FormatSpec[] {
  let list = specOrder.get(registry)
  if (!list) {
    const required = (s: FormatSpec): number => Object.values(s.attrs ?? {}).filter((r) => r.required).length
    list = [...registry.values()].sort((a, b) => Number(!!b.className) - Number(!!a.className) || required(b) - required(a))
    specOrder.set(registry, list)
  }
  return list
}

function formatOf(el: Element, registry: FormatRegistry): { type: string; attrs?: FormatAttrs } | null {
  const custom = el.getAttribute('data-pz-format')
  if (custom) return { type: custom }
  const tag = el.tagName.toLowerCase()
  for (const spec of specsByPrecision(registry)) {
    if (spec.tag !== tag || (spec.className && !el.classList.contains(spec.className))) continue
    const raw: Record<string, string> = {}
    for (const [name, rule] of Object.entries(spec.attrs ?? {})) {
      const prefix = `pz-${spec.type}-`
      const v = spec.type === 'footnote' && name === 'note' ? el.getAttribute(NOTE)
        : rule.kind === 'preset' ? [...el.classList].find((c) => c.startsWith(prefix))?.slice(prefix.length) ?? null
          : rule.kind === 'style' ? el.getAttribute(STYLE)
            : rule.kind === 'classes' ? [...el.classList].filter((c) => !c.startsWith('pz-')).join(' ') || null
              : el.getAttribute(name)
      if (v !== null) raw[name] = v
    }
    const attrs = checkFormatAttrs(spec.type, raw, registry)
    if (attrs) return Object.keys(attrs).length > 0 ? { type: spec.type, attrs } : { type: spec.type }
  }
  const alias = ALIASES[el.tagName]
  return alias && registry.has(alias) ? { type: alias } : null
}

const TEXT = 3
const ELEMENT = 1

// ---------------------------------------------------------------------------
// Leaves and offsets

/** The last leaf (non-empty text node, `<br>` or object) in document order, or null. */
function lastLeaf(root: Node): Node | null {
  let last: Node | null = null
  const walk = (node: Node): void => {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === TEXT) { if ((child as Text).data.length > 0) last = child; continue }
      if (child.nodeType !== ELEMENT) continue
      const el = child as Element
      if (el.tagName === 'BR' || isObjectElement(el)) last = el
      else walk(el)
    }
  }
  walk(root)
  return last
}

interface Leaf { node: Node; length: number; start: number }

/** Leaves with their text length and start offset. Block elements add a virtual "\n" like fromDom. */
function leaves(root: Node): Leaf[] {
  const out: Leaf[] = []
  const last = lastLeaf(root)
  let offset = 0
  let endsWithBreak = true
  const walk = (node: Node): void => {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === TEXT) {
        const len = (child as Text).data.length
        out.push({ node: child, length: len, start: offset })
        offset += len
        if (len > 0) endsWithBreak = (child as Text).data.endsWith('\n')
      } else if (child.nodeType === ELEMENT) {
        const el = child as Element
        if (el.tagName === 'BR') {
          const len = el === last ? 0 : 1
          out.push({ node: el, length: len, start: offset })
          offset += len
          if (len) endsWithBreak = true
        } else if (isObjectElement(el)) {
          out.push({ node: el, length: 1, start: offset })
          offset += 1
          endsWithBreak = false
        } else {
          if (BLOCK_TAGS.has(el.tagName) && offset > 0 && !endsWithBreak) { offset += 1; endsWithBreak = true }
          walk(el)
        }
      }
    }
  }
  walk(root)
  return out
}

/** Text offset of a DOM point inside `root`, or null when the point is outside. */
export function domPointToOffset(root: Node, node: Node, offset: number): number | null {
  if (node !== root && !root.contains(node)) return null
  const doc = root.ownerDocument ?? (root as Document)
  const point = doc.createRange()
  try { point.setStart(node, offset) } catch { return null }
  let result = 0
  for (const leaf of leaves(root)) {
    if (leaf.node === node) return leaf.start + Math.min(offset, leaf.length)
    // (leaf, 0) before the point means the whole leaf is before it,
    // because the point is not inside this leaf.
    if (point.comparePoint(leaf.node, 0) < 0) result = leaf.start + leaf.length
    else return leaf.start
  }
  return result
}

export interface DomPoint { node: Node; offset: number }

/**
 * Which side of a format boundary a caret sits on. Formats are decided by the
 * model either way; the side only decides which element the browser types
 * into, and so whether the DOM must be corrected while the author types.
 */
export type Affinity = 'backward' | 'forward'

/**
 * DOM point for a text offset. At a boundary between two leaves the earlier
 * one is chosen (`backward`) or the later one (`forward`); at the end of a
 * formatted run with nothing after it, `forward` is just outside the
 * outermost element, so typed text lands outside a link or code.
 */
export function offsetToDomPoint(root: Node, offset: number, affinity: Affinity = 'backward'): DomPoint {
  const all = leaves(root)
  for (let i = 0; i < all.length; i++) {
    const leaf = all[i]!
    if (leaf.node.nodeType === TEXT) {
      if (offset > leaf.start + leaf.length) continue
      if (affinity === 'forward' && offset === leaf.start + leaf.length && leaf.length > 0) {
        const next = all.slice(i + 1).find((l) => l.length > 0 || l.node.nodeType !== TEXT)
        if (next && next.start === offset) return next.node.nodeType === TEXT ? { node: next.node, offset: 0 } : before(next.node)
        if (!next) return after(outermost(root, leaf.node))
      }
      return { node: leaf.node, offset: Math.max(0, offset - leaf.start) }
    } else if (leaf.length > 0 && offset <= leaf.start) {
      return before(leaf.node)
    } else if (leaf.length === 0) {
      return before(leaf.node) // padding <br>: the caret sits before it
    }
  }
  return { node: root, offset: root.childNodes.length }
}

function after(node: Node): DomPoint {
  const p = before(node)
  return { node: p.node, offset: p.offset + 1 }
}

/** The ancestor of `node` (or `node`) that is a child of `root`. */
function outermost(root: Node, node: Node): Node {
  let n = node
  while (n.parentNode && n.parentNode !== root) n = n.parentNode
  return n
}

function before(node: Node): DomPoint {
  const parent = node.parentNode!
  return { node: parent, offset: Array.from(parent.childNodes).indexOf(node as ChildNode) }
}

// ---------------------------------------------------------------------------
// Selection

export interface TextSelection {
  readonly anchor: number
  readonly focus: number
}

export function selectionStart(s: TextSelection): number { return Math.min(s.anchor, s.focus) }
export function selectionEnd(s: TextSelection): number { return Math.max(s.anchor, s.focus) }
export function isCollapsed(s: TextSelection): boolean { return s.anchor === s.focus }

/**
 * Where the browser's selection is, in text offsets of `root`.
 * Inside a shadow root, pass a source from selectionSourceFor().
 */
export function readSelection(root: Node, sel: SelectionLike | null): TextSelection | null {
  if (!sel || sel.rangeCount === 0 || !sel.anchorNode || !sel.focusNode) return null
  const anchor = domPointToOffset(root, sel.anchorNode, sel.anchorOffset)
  const focus = domPointToOffset(root, sel.focusNode, sel.focusOffset)
  if (anchor === null || focus === null) return null
  return { anchor, focus }
}

export function writeSelection(root: Node, sel: SelectionLike | null, s: TextSelection, affinity: Affinity = 'backward'): void {
  if (!sel) return
  const a = offsetToDomPoint(root, s.anchor, s.anchor === s.focus ? affinity : 'backward')
  const f = s.anchor === s.focus ? a : offsetToDomPoint(root, s.focus)
  if (sel.anchorNode === a.node && sel.anchorOffset === a.offset && sel.focusNode === f.node && sel.focusOffset === f.offset) return
  sel.setBaseAndExtent(a.node, a.offset, f.node, f.offset)
}
