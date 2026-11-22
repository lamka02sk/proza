/**
 * The RichText field: one contenteditable element holding inline content.
 *
 * Input strategy:
 * - The browser owns text. Typing, composition, autocorrect, spell-check and
 *   dictation change the DOM; the field reads the text back and diffs it.
 * - The model owns formats. Inserted text gets its formats from the model's
 *   inheritance rule or from pending formats, never from whatever element the
 *   browser happened to type into. So formatting is the same in every engine.
 * - Discrete intents (Enter, Shift+Enter, formatting, undo, paste, cut,
 *   deletion at a boundary or next to an inline object) are cancelled in
 *   `beforeinput` and applied to the model.
 * - After every change the DOM is reconciled to the canonical DOM of the
 *   value, touching only the differing top-level nodes, never during composition.
 */
import {
  OBJECT_CHAR, applyFormat, checkFormatAttrs, defaultFormats, deleteRange, dropOrphanObjects, formatRangeAt, formatTypeGate, inheritedMarks,
  insertObject as insertObjectValue, isFormatActive, marked, marksAt, marksEqual, findChange, normalize, objectAt,
  removeAllFormats, removeFormat, replace, setObjectAttrs, slice, split, toggleFormat as toggleFormatValue, toggleMark,
  typingMarks, type FormatAttrs, type FormatRange, type FormatRegistry, type Mark, type RichTextValue,
} from '../model/richtext'
import {
  linkify, matchAutolink, matchBlockRuleOnEnter, matchBlockRuleOnSpace, matchInlineRule, type BlockRuleMatch,
} from '../model/input-rules'
import { safeUrl } from '../model/url'
import {
  domPointToOffset, isCollapsed, offsetToDomPoint, readSelection, selectionEnd, selectionStart, textFromDom, toDom, writeSelection,
  fromDom, type Affinity, type DomLabels, type TextSelection,
} from './dom'
import { clearHighlights, setHighlightRanges } from './highlights'
import { isMac, matchesKeys } from './keys'
import { hasFocusWithin, selectionSourceFor, type SelectionSource } from './selection'

export type ChangeOrigin = 'typing' | 'composition' | 'format' | 'paste' | 'cut' | 'drop' | 'command' | 'inputRule' | 'external'

export interface FieldCallbacks {
  /** The value changed through the field. */
  onChange?(value: RichTextValue, selection: TextSelection, origin: ChangeOrigin): void
  onSelectionChange?(selection: TextSelection | null): void
  /** Enter. The block decides what a split means. */
  onSplit?(before: RichTextValue, after: RichTextValue): void
  /** Backspace at offset 0. */
  onMergeBackward?(): void
  /** Delete at the end. */
  onMergeForward?(): void
  onUndo?(): void
  onRedo?(): void
  /**
   * A block input rule was typed (`# `, `- `, `1. `, `> `, three backticks, `---`).
   * Return true when the block applied it; otherwise the typed text stays as it is.
   */
  onBlockRule?(match: BlockRuleMatch): boolean
  /** Mod+K: the interface opens its link dialog. */
  onRequestLink?(): void
  /**
   * Before the field pastes: return true when the editor took the data (blocks
   * from the internal format). Otherwise the field pastes inline content.
   */
  onPaste?(data: DataTransfer, selection: TextSelection): boolean
  /** A drop on the field. Return true when the editor handled it (a move from another field, blocks). */
  onDrop?(drop: FieldDrop): boolean
  /** The arrow keys stepped into (`entered`) or out of (`left`) a link, code or other non-inclusive format. */
  onBoundaryChange?(change: { readonly entered: readonly Mark[]; readonly left: readonly Mark[] }): void
  /** Called for every keydown the field does not handle itself. Return true when handled. */
  onKeyDown?(event: KeyboardEvent): boolean
  /** Every raw input-related event, for the diagnostics log of the spike. */
  onTrace?(event: Event): void
}

export interface FieldOptions extends FieldCallbacks {
  value?: RichTextValue
  formats?: FormatRegistry
  /** Format types this field accepts; omitted accepts every registered format. A code block passes []. */
  allowedFormats?: readonly string[]
  /** Markdown-like input rules. On by default. */
  inputRules?: boolean
  /** Accessible name, e.g. "Paragraph". */
  label?: string
  /** BCP 47 language of the content, for spell-check and screen readers. */
  lang?: string
  /** Base direction. `auto` (default) follows the first strong character. */
  dir?: 'ltr' | 'rtl' | 'auto'
  /** Accessible names inside the field, in the interface language (Slovak, for example). */
  labels?: DomLabels
  /** Replaces FIELD_SHORTCUTS, so a host can remap or remove them (WCAG 2.1.4). */
  shortcuts?: readonly FieldShortcut[]
  /** Where to read the selection. Defaults to selectionSourceFor(element), which handles shadow roots. */
  getSelection?: SelectionSource
  /** False shows the text read-only: it can be read, selected and copied, never changed. Default true. */
  editable?: boolean
}

/** What was dropped on a field and where. */
export interface FieldDrop {
  readonly data: DataTransfer
  /** Text offset under the pointer. */
  readonly offset: number
  /** The text being dragged, when the drag started in a field of this page. */
  readonly source: DragSource | null
  /** The author asked for a copy (Ctrl, or Option on a Mac); otherwise a drag inside the page moves. */
  readonly copy: boolean
}

export interface DragSource {
  readonly field: RichTextField
  readonly start: number
  readonly end: number
}

/** The drag in progress, if it started in a field. One per page: there is one pointer. */
let dragging: DragSource | null = null

/**
 * The fields of each document that may hold the selection (focused, or still
 * holding a selection), with their handlers. One selectionchange listener per
 * document serves them: a listener per field costs every keystroke a call into
 * each of 2,000 fields that has nothing to do.
 */
const selectionWatchers = new WeakMap<Document, Map<object, () => void>>()

function watchSelection(doc: Document, field: object, handler: () => void): void {
  let watching = selectionWatchers.get(doc)
  if (!watching) {
    const map = new Map<object, () => void>()
    watching = map
    selectionWatchers.set(doc, map)
    doc.addEventListener('selectionchange', () => { for (const fn of [...map.values()]) fn() })
  }
  watching.set(field, handler)
}

function unwatchSelection(doc: Document, field: object): void {
  selectionWatchers.get(doc)?.delete(field)
}

export type FieldCommand = { readonly format: string } | 'clearFormatting' | 'link' | 'undo' | 'redo'

export interface FieldShortcut {
  /** `Mod` is Ctrl, or Cmd on Apple platforms. Example: `Mod+Shift+X`. */
  readonly keys: string
  readonly command: FieldCommand
  /** Limit to Apple platforms (true) or the others (false). */
  readonly mac?: boolean
}

/** The field's keyboard shortcuts. Keyboard help reads this table, so it is never out of date. */
export const FIELD_SHORTCUTS: readonly FieldShortcut[] = [
  { keys: 'Mod+B', command: { format: 'bold' } },
  { keys: 'Mod+I', command: { format: 'italic' } },
  { keys: 'Mod+U', command: { format: 'underline' } },
  { keys: 'Mod+Shift+X', command: { format: 'strikethrough' } },
  { keys: 'Mod+E', command: { format: 'code' } },
  { keys: 'Mod+.', command: { format: 'superscript' } },
  { keys: 'Mod+,', command: { format: 'subscript' } },
  { keys: 'Mod+\\', command: 'clearFormatting' },
  { keys: 'Mod+K', command: 'link' },
  { keys: 'Mod+Z', command: 'undo' },
  { keys: 'Mod+Shift+Z', command: 'redo' },
  { keys: 'Mod+Y', command: 'redo', mac: false },
]

/** Highlight name of the link or code the caret is in (styled in richtext.css). */
export const BOUNDARY_HIGHLIGHT = 'pz-boundary'

export const PROZA_MIME = 'application/x-proza+json'
/** Attribute carrying the internal JSON inside clipboard HTML, for Firefox, which drops custom types. */
export const CLIP_ATTR = 'data-pz-clip'

/** The internal JSON carried in clipboard HTML. Parsed inert: never touches the live DOM. */
export function clipFromHtml(html: string): string {
  if (!html.includes(CLIP_ATTR)) return ''
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  return parsed.querySelector(`[${CLIP_ATTR}]`)?.getAttribute(CLIP_ATTR) ?? ''
}

/**
 * Validate clipboard JSON. The clipboard is a trust boundary:
 * any page can put anything there. Attributes go through the format rules
 * when the value is inserted (#sanitize).
 */
export function parseClipboard(json: string): RichTextValue | null {
  if (!json) return null
  let data: unknown
  try { data = JSON.parse(json) } catch { return null }
  if (!isRecord(data) || data.version !== 1 || !isRecord(data.inline)) return null
  const { text, formats } = data.inline
  if (typeof text !== 'string' || !Array.isArray(formats) || formats.length > 10_000) return null
  const out: FormatRange[] = []
  for (const f of formats as unknown[]) {
    if (!isRecord(f) || typeof f.type !== 'string' || !Number.isInteger(f.start) || !Number.isInteger(f.end)) return null
    const range = { type: f.type, start: f.start as number, end: f.end as number }
    if (f.attrs === undefined) { out.push(range); continue }
    if (!isRecord(f.attrs) || !Object.values(f.attrs).every((v) => typeof v === 'string')) return null
    out.push({ ...range, attrs: f.attrs as Record<string, string> })
  }
  return { text, formats: out }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function matchesShortcut(s: FieldShortcut, e: KeyboardEvent, mac: boolean): boolean {
  return (s.mac === undefined || s.mac === mac) && matchesKeys(s.keys, e, mac)
}

type Win = Window & typeof globalThis

export class RichTextField {
  readonly element: HTMLElement
  #value: RichTextValue
  #selection: TextSelection | null = null
  #pending: Mark[] | null = null
  #composing = false
  #formats: FormatRegistry
  #opts: FieldOptions
  #getSelection: SelectionSource
  #abort = new AbortController()
  /** An arrow key the browser is moving the caret for, and the marks the caret had before. */
  #arrow: { forward: boolean; marks: Mark[] } | null = null
  #highlights = new Map<string, readonly { start: number; end: number }[]>()
  #editable = true

  constructor(element: HTMLElement, options: FieldOptions = {}) {
    this.element = element
    this.#opts = options
    this.#formats = options.formats ?? defaultFormats
    this.#value = this.#sanitize(options.value ?? { text: '', formats: [] })
    // Resolved lazily: the element may be attached to a shadow root after construction.
    this.#getSelection = options.getSelection ?? (() => selectionSourceFor(element)())

    element.classList.add('pz-richtext')
    this.setEditable(options.editable ?? true)
    // Correctness depends on this, so it does not rely on a stylesheet: without
    // pre-wrap, engines insert U+00A0 for spaces and collapse trailing ones.
    // CSSOM writes are allowed under a strict CSP.
    element.style.setProperty('white-space', 'pre-wrap', 'important')
    element.setAttribute('role', 'textbox')
    element.setAttribute('aria-multiline', 'true')
    if (options.label) element.setAttribute('aria-label', options.label)
    element.dir = options.dir ?? 'auto'
    if (options.lang) element.lang = options.lang
    element.spellcheck = true
    this.#render()

    const on = <K extends keyof HTMLElementEventMap>(type: K, fn: (e: HTMLElementEventMap[K]) => void): void => {
      element.addEventListener(type, (e) => { this.#opts.onTrace?.(e); fn(e) }, { signal: this.#abort.signal })
    }
    on('beforeinput', (e) => { if (this.#editable) this.#onBeforeInput(e); else e.preventDefault() })
    on('input', (e) => { if (this.#editable) this.#onInput(e) })
    on('compositionstart', () => { this.#onCompositionStart() })
    on('compositionend', () => { this.#onCompositionEnd() })
    on('keydown', (e) => { this.#onKeyDown(e) })
    on('copy', (e) => { this.#onCopy(e, false) })
    on('cut', (e) => { this.#onCopy(e, this.#editable) })
    on('paste', (e) => { if (this.#editable) this.#onPaste(e); else e.preventDefault() })
    on('dragstart', (e) => { this.#onDragStart(e) })
    on('dragover', (e) => { this.#onDragOver(e) })
    on('drop', (e) => { if (this.#editable) this.#onDrop(e); else e.preventDefault() })
    on('dragend', () => { if (dragging?.field === this) dragging = null })
    // selectionchange reaches this field only while it may hold the selection (watchSelection).
    element.addEventListener('focus', () => { this.#watch() }, { signal: this.#abort.signal })
    // Chromium under-reports selectionchange for selections inside a shadow root.
    element.addEventListener('keyup', () => { this.#onSelectionChange() }, { signal: this.#abort.signal })
    element.addEventListener('pointerup', () => { this.#onSelectionChange(true) }, { signal: this.#abort.signal })
    element.addEventListener('blur', () => { this.#paintHighlights() }, { signal: this.#abort.signal })
  }

  destroy(): void {
    this.#abort.abort()
    unwatchSelection(this.element.ownerDocument, this)
    clearHighlights(this.#win, this)
    this.element.removeAttribute('contenteditable')
  }

  // -------------------------------------------------------------------------
  // Public state

  get value(): RichTextValue { return this.#value }
  /** Read fresh while focused: selectionchange is async, and Chromium skips it for shadow trees. */
  get selection(): TextSelection | null {
    if (!this.#composing && hasFocusWithin(this.element)) this.#syncSelectionFromDom()
    return this.#selection
  }
  get composing(): boolean { return this.#composing }
  get editable(): boolean { return this.#editable }

  /**
   * Read-only text stays focusable (its tab stop is the canvas's) and selectable, so it
   * can be read by keyboard and copied; `aria-readonly` tells screen readers it is not for typing.
   */
  setEditable(on: boolean): void {
    this.#editable = on
    this.element.contentEditable = on ? 'true' : 'false'
    if (on) this.element.removeAttribute('aria-readonly')
    else this.element.setAttribute('aria-readonly', 'true')
  }

  /** Replace the value from outside (undo, a command). Does not call onChange. */
  setValue(value: RichTextValue, selection?: TextSelection): void {
    if (this.#composing) this.#composing = false
    this.#value = this.#sanitize(value)
    this.#pending = null
    this.#reconcile()
    if (selection) this.setSelection(selection)
  }

  setSelection(selection: TextSelection): void {
    const len = this.#value.text.length
    const s = { anchor: clamp(selection.anchor, len), focus: clamp(selection.focus, len) }
    const before = this.#selection
    // Moving the caret drops pending formats, as a click does.
    if (!before || before.anchor !== s.anchor || before.focus !== s.focus) this.#pending = null
    this.#selection = s
    this.#watch()
    if (!hasFocusWithin(this.element)) this.element.focus({ preventScroll: true })
    writeSelection(this.element, this.#getSelection(), s, this.#affinity())
    this.#paintHighlights()
  }

  focus(at: number | 'start' | 'end' = 'end'): void {
    const offset = at === 'start' ? 0 : at === 'end' ? this.#value.text.length : at
    this.setSelection({ anchor: offset, focus: offset })
  }

  /** Marks the next typed character will carry, or the formats the whole selection has. */
  activeMarks(): Mark[] {
    const s = this.#selection
    if (!s) return []
    if (this.#pending) return this.#pending
    if (isCollapsed(s)) return inheritedMarks(this.#value, s.focus, this.#formats)
    const a = selectionStart(s), b = selectionEnd(s)
    return [...this.#formats.values()]
      .filter((spec) => spec.object !== true && isFormatActive(this.#value, a, b, spec.type))
      .map((spec) => marksAt(this.#value, a).find((m) => m.type === spec.type) ?? { type: spec.type })
  }

  /** Marks for the next typed text, e.g. carried into a new block after Enter. */
  setPendingMarks(marks: readonly Mark[]): void {
    this.#pending = marks.filter((m) => this.#allowed(m.type))
    this.#paintHighlights()
  }

  /** Whether this field takes a format at all (a code block takes none). */
  allows(type: string): boolean {
    return this.#allowed(type)
  }

  isFormatActive(type: string): boolean {
    return this.activeMarks().some((m) => m.type === type)
  }

  /** The format of `type` at the selection, with its attributes (a link's address, for the link dialog). */
  formatAt(type: string): Mark | null {
    const s = this.#selection
    if (!s) return null
    if (!isCollapsed(s)) return this.activeMarks().find((m) => m.type === type) ?? null
    const r = formatRangeAt(this.#value, s.focus, type)
    return r ? (r.attrs ? { type, attrs: r.attrs } : { type }) : null
  }

  /** The inline object at a character offset (to edit a picture's alternative text or a footnote). */
  objectAt(offset: number): FormatRange | null {
    return objectAt(this.#value, offset, this.#formats)
  }

  /** Paint named ranges through the CSS Custom Highlight API (find results, checker markers). Empty clears. */
  setHighlight(name: string, ranges: readonly { start: number; end: number }[]): void {
    if (ranges.length === 0) {
      // Painting walks the names still set; a cleared one must leave the registry itself.
      this.#highlights.delete(name)
      setHighlightRanges(this.#win, this, name, [])
      return
    }
    this.#highlights.set(name, ranges)
    this.#paintHighlights()
  }

  // -------------------------------------------------------------------------
  // Commands

  toggleFormat(mark: Mark): void {
    this.#flush()
    const s = this.#selection
    if (!s || !this.#allowed(mark.type) || this.#formats.get(mark.type)?.object) return
    if (isCollapsed(s)) {
      this.#pending = toggleMark(this.activeMarks(), mark, this.#formats)
      this.#opts.onSelectionChange?.(s)
      this.#paintHighlights()
      return
    }
    this.#commit(toggleFormatValue(this.#value, selectionStart(s), selectionEnd(s), mark, this.#formats), s, 'format')
  }

  /**
   * Apply a format with attributes (a colour preset, a language, an
   * abbreviation's expansion). With a collapsed caret inside a range of the
   * same type, that whole range changes; otherwise it becomes pending.
   */
  setFormat(input: Mark): void {
    this.#flush()
    const s = this.#selection
    const mark = this.#checked(input)
    if (!s || !mark || this.#formats.get(mark.type)?.object) return
    const range = this.#commandRange(mark.type)
    if (!range) {
      this.#pending = [...this.activeMarks().filter((m) => m.type !== mark.type), mark]
      this.#paintHighlights()
      return
    }
    this.#commit(applyFormat(this.#value, range[0], range[1], mark, this.#formats), s, 'format')
  }

  /** Remove a format from the selection, or from the whole range around a collapsed caret. */
  removeFormat(type: string): void {
    this.#flush()
    const s = this.#selection
    if (!s) return
    const range = this.#commandRange(type)
    if (!range) {
      if (this.#pending) this.#pending = this.#pending.filter((m) => m.type !== type)
      this.#paintHighlights()
      return
    }
    this.#commit(removeFormat(this.#value, range[0], range[1], type, this.#formats), s, 'format')
  }

  /**
   * Set (`href`) or remove (null) a link over the selection. With a collapsed
   * caret in a link, the whole link changes. Unsafe addresses are refused.
   */
  setLink(href: string | null, options: { newWindow?: boolean } = {}): void {
    if (href === null) { this.removeFormat('link'); return }
    const safe = safeUrl(href)
    if (safe === null || safe === '') return
    this.setFormat({ type: 'link', attrs: options.newWindow ? { href: safe, target: '_blank' } : { href: safe } })
  }

  clearFormatting(): void {
    this.#flush()
    const s = this.#selection
    if (!s) return
    if (isCollapsed(s)) { this.#pending = []; this.#paintHighlights(); return }
    this.#commit(removeAllFormats(this.#value, selectionStart(s), selectionEnd(s), this.#formats), s, 'format')
  }

  /** Replace the selection with text (soft line breaks allowed). */
  insertText(text: string, origin: ChangeOrigin = 'command'): void {
    this.#flush()
    const s = this.#selection ?? { anchor: this.#value.text.length, focus: this.#value.text.length }
    this.#replaceSelection(s, marked(text.replaceAll(OBJECT_CHAR, ''), this.#marksForInsert(s)), origin)
  }

  /** Replace the selection with an inline object (picture, footnote). The caret goes after it. */
  insertObject(input: Mark): void {
    this.#flush()
    const mark = this.#checked(input)
    if (!mark || this.#formats.get(mark.type)?.object !== true) return
    const s = this.#selection ?? { anchor: this.#value.text.length, focus: this.#value.text.length }
    const a = selectionStart(s)
    const around = this.#marksForInsert(s).filter((m) => !this.#formats.get(m.type)?.object)
    const next = insertObjectValue(this.#value, a, selectionEnd(s), mark, this.#formats, around)
    if (next === this.#value) return
    this.#commit(next, { anchor: a + 1, focus: a + 1 }, 'command')
    this.#pending = around
    this.#paintHighlights()
  }

  /** Change the attributes of the object at `offset`. */
  updateObject(offset: number, attrs: FormatAttrs): void {
    this.#flush()
    const target = this.objectAt(offset)
    const clean = target && checkFormatAttrs(target.type, attrs, this.#formats)
    if (!clean) return
    const next = setObjectAttrs(this.#value, offset, clean, this.#formats)
    if (next === this.#value) return
    this.#commit(next, this.#selection ?? { anchor: offset + 1, focus: offset + 1 }, 'command')
  }

  // -------------------------------------------------------------------------
  // Caret geometry for moving between blocks

  /** Viewport x of the caret, for the goal column when moving up and down. */
  caretX(): number | null {
    const s = this.#selection
    return s ? this.#caretRect(s.focus)?.left ?? null : null
  }

  isCaretOnFirstLine(): boolean { return this.#caretOnEdgeLine('first') }
  isCaretOnLastLine(): boolean { return this.#caretOnEdgeLine('last') }

  /** Viewport rectangles of the selected text, one per line box (the bubble sits above the first). */
  selectionRects(): DOMRect[] {
    const s = this.#selection
    if (!s || isCollapsed(s)) return []
    const a = offsetToDomPoint(this.element, selectionStart(s))
    const b = offsetToDomPoint(this.element, selectionEnd(s))
    const range = this.element.ownerDocument.createRange()
    range.setStart(a.node, a.offset)
    range.setEnd(b.node, b.offset)
    return [...range.getClientRects()].filter((r) => r.width > 0 || r.height > 0)
  }

  /** Put the caret on the first or last visual line, nearest to viewport x. */
  placeCaretAtX(x: number, line: 'first' | 'last'): void {
    const len = this.#value.text.length
    const edge = line === 'first' ? 0 : len
    const edgeRect = this.#caretRect(edge)
    if (!edgeRect) { this.focus(edge); return }
    const [lo, hi] = line === 'first' ? [0, this.#lineEnd(0, edgeRect)] : [this.#lineStart(len, edgeRect), len]
    this.focus(this.#nearestX(lo, hi, x))
  }

  /** The text offset nearest to a viewport point (where a drop lands). */
  offsetAtPoint(x: number, y: number): number {
    const native = this.#nativeOffsetAtPoint(x, y)
    if (native !== null) return native
    // Lines run top to bottom as offsets grow: find the first offset on a line that reaches y.
    let lo = 0, hi = this.#value.text.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if ((this.#caretRect(mid)?.bottom ?? y) < y) lo = mid + 1
      else hi = mid
    }
    const rect = this.#caretRect(lo)
    return rect ? this.#nearestX(this.#lineStart(lo, rect), this.#lineEnd(lo, rect), x) : lo
  }

  #nativeOffsetAtPoint(x: number, y: number): number | null {
    const doc = this.element.ownerDocument
    if (typeof doc.caretPositionFromPoint !== 'function') return null
    const root = this.element.getRootNode()
    const p = doc.caretPositionFromPoint(x, y, { shadowRoots: root instanceof ShadowRoot ? [root] : [] })
    // Engines without the shadowRoots option answer with the host: measure instead.
    if (!p || !this.element.contains(p.offsetNode)) return null
    return domPointToOffset(this.element, p.offsetNode, p.offset)
  }

  /** The last offset on the visual line of `rect`, from `from` on. Binary search: line order follows offsets. */
  #lineEnd(from: number, rect: DOMRect): number {
    let lo = from, hi = this.#value.text.length
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      const r = this.#caretRect(mid)
      if (r && sameLine(r, rect)) lo = mid
      else hi = mid - 1
    }
    return lo
  }

  #lineStart(to: number, rect: DOMRect): number {
    let lo = 0, hi = to
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      const r = this.#caretRect(mid)
      if (r && sameLine(r, rect)) hi = mid
      else lo = mid + 1
    }
    return lo
  }

  /** The offset in [lo, hi], one visual line, whose caret is nearest to x. Linear: bidi text is not monotonic in x. */
  #nearestX(lo: number, hi: number, x: number): number {
    let best = lo, bestDist = Infinity
    for (let i = lo; i <= hi; i++) {
      const r = this.#caretRect(i)
      if (!r) continue
      const d = Math.abs(r.left - x)
      if (d < bestDist) { best = i; bestDist = d }
    }
    return best
  }

  #caretOnEdgeLine(line: 'first' | 'last'): boolean {
    const s = this.#selection
    if (!s) return false
    const caret = this.#caretRect(s.focus)
    const edge = this.#caretRect(line === 'first' ? 0 : this.#value.text.length)
    return !caret || !edge || sameLine(caret, edge)
  }

  #caretRect(offset: number): DOMRect | null {
    const doc = this.element.ownerDocument
    const p = offsetToDomPoint(this.element, offset)
    const range = doc.createRange()
    range.setStart(p.node, p.offset)
    range.collapse(true)
    const rect = range.getClientRects()[0]
    if (rect && (rect.height > 0 || rect.width > 0)) return rect
    // Collapsed ranges have no rect in some positions (empty line, before <br>): measure a neighbour.
    const len = this.#value.text.length
    if (offset < len && this.#value.text[offset] !== '\n') {
      const q = offsetToDomPoint(this.element, offset + 1)
      range.setEnd(q.node, q.offset)
      const r = range.getClientRects()[0]
      if (r) return new DOMRect(r.left, r.top, 0, r.height)
    }
    if (p.node.nodeType === 1) {
      const next = p.node.childNodes[p.offset]
      if (next instanceof Element) {
        const r = next.getBoundingClientRect()
        if (r.height > 0) return new DOMRect(r.left, r.top, 0, r.height)
      }
    }
    const r = this.element.getBoundingClientRect()
    const lh = parseFloat(getComputedStyle(this.element).lineHeight) || 16
    return offset === 0 ? new DOMRect(r.left, r.top, 0, lh) : new DOMRect(r.left, r.bottom - lh, 0, lh)
  }

  // -------------------------------------------------------------------------
  // Events

  #onBeforeInput(e: InputEvent): void {
    // Selection may lag behind in some engines; take it fresh.
    if (!this.#composing) this.#syncSelectionFromDom()
    const s = this.#selection
    switch (e.inputType) {
      case 'insertParagraph': {
        e.preventDefault()
        this.#flush()
        if (this.#rulesOn() && this.#enterRules()) return
        const sel = this.#selection ?? s
        if (!sel) return
        const without = deleteRange(this.#value, selectionStart(sel), selectionEnd(sel), this.#formats)
        const [before, after] = split(without, selectionStart(sel))
        this.#opts.onSplit?.(before, after)
        return
      }
      case 'insertLineBreak':
        e.preventDefault()
        this.#flush()
        if (this.#rulesOn()) this.#autolinkBeforeCaret()
        this.insertText('\n', 'typing')
        return
      case 'formatBold': e.preventDefault(); this.toggleFormat({ type: 'bold' }); return
      case 'formatItalic': e.preventDefault(); this.toggleFormat({ type: 'italic' }); return
      case 'formatUnderline': e.preventDefault(); this.toggleFormat({ type: 'underline' }); return
      case 'formatStrikeThrough': e.preventDefault(); this.toggleFormat({ type: 'strikethrough' }); return
      case 'formatSuperscript': e.preventDefault(); this.toggleFormat({ type: 'superscript' }); return
      case 'formatSubscript': e.preventDefault(); this.toggleFormat({ type: 'subscript' }); return
      case 'formatRemove': e.preventDefault(); this.clearFormatting(); return
      case 'historyUndo': e.preventDefault(); this.#opts.onUndo?.(); return
      case 'historyRedo': e.preventDefault(); this.#opts.onRedo?.(); return
      case 'insertFromPaste':
      case 'insertFromPasteAsQuotation':
      case 'insertFromDrop':
      case 'insertFromYank':
      case 'deleteByCut':
      case 'deleteByDrag':
        // Handled by the paste, cut and drop events; never let the browser insert markup.
        e.preventDefault()
        return
      case 'deleteContentBackward':
      case 'deleteWordBackward':
      case 'deleteSoftLineBackward':
      case 'deleteHardLineBackward':
        if (!s || !isCollapsed(s) || this.#composing) return
        if (s.focus === 0) { e.preventDefault(); this.#opts.onMergeBackward?.(); return }
        if (e.inputType === 'deleteContentBackward' && this.#deleteObject(s.focus - 1)) e.preventDefault()
        return
      case 'deleteContentForward':
      case 'deleteWordForward':
      case 'deleteSoftLineForward':
      case 'deleteHardLineForward':
        if (!s || !isCollapsed(s) || this.#composing) return
        if (s.focus === this.#value.text.length) { e.preventDefault(); this.#opts.onMergeForward?.(); return }
        if (e.inputType === 'deleteContentForward' && this.#deleteObject(s.focus)) e.preventDefault()
        return
      default:
        // Everything that is block structure or styling the model does not have.
        if (e.inputType.startsWith('format') || e.inputType === 'insertOrderedList' || e.inputType === 'insertUnorderedList' || e.inputType === 'insertHorizontalRule' || e.inputType === 'insertLink') {
          e.preventDefault()
        }
    }
  }

  #onInput(e: InputEvent): void {
    if (this.#composing || e.isComposing) return
    this.#readBack('typing')
  }

  #onCompositionStart(): void {
    this.#flush()
    this.#composing = true
  }

  #onCompositionEnd(): void {
    this.#composing = false
    // WebKit fires the last input event after compositionend; Blink before it.
    // Reading back on the next task covers both, and a later input event is a no-op.
    setTimeout(() => { if (!this.#composing) this.#readBack('composition') }, 0)
  }

  #onKeyDown(e: KeyboardEvent): void {
    // Android reports key code 229 during composition.
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- keyCode is the only signal for this
    if (e.isComposing || e.keyCode === 229) return
    // selectionchange is async: after Home or a click the stored selection can be stale.
    this.#syncSelectionFromDom()
    this.#arrow = null
    const s = this.#selection
    const plain = !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey
    if (s && isCollapsed(s) && plain && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      const forward = (e.key === 'ArrowRight') !== (this.direction() === 'rtl')
      if (this.#stepBoundary(forward) || this.#stepOverObject(forward)) { e.preventDefault(); return }
      // The browser moves the caret; #onSelectionChange decides which side of a boundary it lands on.
      this.#arrow = { forward, marks: this.activeMarks() }
    }
    if (this.#opts.onKeyDown?.(e)) return
    if (!this.#editable) return
    // WebKit fires no beforeinput for Backspace at the start (or Delete at the end) of an
    // editing host, because there is nothing to delete. Detect the boundary here too.
    if (s && isCollapsed(s) && plain) {
      if (e.key === 'Backspace' && s.focus === 0) { e.preventDefault(); this.#flush(); this.#opts.onMergeBackward?.(); return }
      if (e.key === 'Delete' && s.focus === this.#value.text.length) { e.preventDefault(); this.#flush(); this.#opts.onMergeForward?.(); return }
    }
    const mac = isMac()
    const shortcut = (this.#opts.shortcuts ?? FIELD_SHORTCUTS).find((sc) => matchesShortcut(sc, e, mac))
    if (!shortcut) return
    e.preventDefault()
    this.#run(shortcut.command)
  }

  #run(command: FieldCommand): void {
    switch (command) {
      case 'clearFormatting': this.clearFormatting(); return
      case 'link': this.#flush(); this.#opts.onRequestLink?.(); return
      case 'undo': this.#flush(); this.#opts.onUndo?.(); return
      case 'redo': this.#flush(); this.#opts.onRedo?.(); return
      default: this.toggleFormat({ type: command.format })
    }
  }

  #onCopy(e: ClipboardEvent, cut: boolean): void {
    this.#flush()
    const s = this.#selection
    if (!s || isCollapsed(s) || !e.clipboardData) return
    e.preventDefault()
    this.#writeData(e.clipboardData, selectionStart(s), selectionEnd(s))
    if (cut) this.#replaceSelection(s, marked('', []), 'cut')
  }

  /** Plain text, HTML and the internal format of [start, end), for the clipboard and for dragging. */
  #writeData(data: DataTransfer, start: number, end: number): void {
    const part = slice(this.#value, start, end)
    const holder = this.element.ownerDocument.createElement('div')
    holder.appendChild(toDom(part, this.element.ownerDocument, this.#formats, this.#opts.labels))
    holder.querySelectorAll('br[data-pz-pad]').forEach((b) => { b.remove() })
    holder.querySelectorAll('[contenteditable]').forEach((b) => { b.removeAttribute('contenteditable') })
    const json = JSON.stringify({ version: 1, inline: part })
    // Objects have no text of their own: plain text leaves them out.
    data.setData('text/plain', part.text.replaceAll(OBJECT_CHAR, ''))
    data.setData(PROZA_MIME, json)
    // Firefox drops custom types on the system clipboard, so the JSON also rides in the HTML.
    const wrapper = this.element.ownerDocument.createElement('span')
    wrapper.setAttribute(CLIP_ATTR, json)
    wrapper.append(...holder.childNodes)
    data.setData('text/html', wrapper.outerHTML)
  }

  /** Inline content in `data`: the internal format, else plain text. Null when there is none. */
  #readData(data: DataTransfer, s: TextSelection): RichTextValue | null {
    const internal = parseClipboard(data.getData(PROZA_MIME)) ?? parseClipboard(clipFromHtml(data.getData('text/html')))
    if (internal) return this.#sanitize(internal)
    // HTML goes through the editor's import pipeline (onPaste); a field on its own pastes plain text.
    const text = data.getData('text/plain').replace(/\r\n?/g, '\n').replaceAll(OBJECT_CHAR, '')
    if (!text) return null
    const insert = marked(text, this.#marksForInsert(s))
    return this.#sanitize(this.#allowed('link') ? linkify(insert, this.#formats) : insert)
  }

  #onPaste(e: ClipboardEvent): void {
    e.preventDefault()
    this.#flush()
    const data = e.clipboardData
    const s = this.#selection
    if (!data || !s) return
    if (this.#opts.onPaste?.(data, s)) return
    const internal = parseClipboard(data.getData(PROZA_MIME)) ?? parseClipboard(clipFromHtml(data.getData('text/html')))
    // An address pasted onto selected words links them.
    const url = data.getData('text/plain').trim()
    if (!internal && !isCollapsed(s) && this.#allowed('link') && /^(?:https?:\/\/|mailto:)\S+$/i.test(url)) {
      const href = safeUrl(url)
      if (href) {
        this.#commit(applyFormat(this.#value, selectionStart(s), selectionEnd(s), { type: 'link', attrs: { href } }, this.#formats), s, 'paste')
        return
      }
    }
    const insert = this.#readData(data, s)
    if (insert) this.#replaceSelection(s, insert, 'paste')
  }

  // -------------------------------------------------------------------------
  // Drag and drop of text (drop is a controlled intent)

  #onDragStart(e: DragEvent): void {
    this.#flush()
    const s = this.#selection
    if (!s || isCollapsed(s) || !e.dataTransfer) { e.preventDefault(); return }
    const start = selectionStart(s), end = selectionEnd(s)
    this.#writeData(e.dataTransfer, start, end)
    e.dataTransfer.effectAllowed = this.#editable ? 'copyMove' : 'copy'
    dragging = { field: this, start, end }
  }

  #onDragOver(e: DragEvent): void {
    // Accept the drop; the field inserts it itself. Show copy when the copy key is held.
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = this.#copyKey(e) || !dragging ? 'copy' : 'move'
  }

  #copyKey(e: DragEvent): boolean {
    return isMac() ? e.altKey : e.ctrlKey
  }

  #onDrop(e: DragEvent): void {
    // Never let the browser insert markup (it would also fire insertFromDrop, which is cancelled too).
    e.preventDefault()
    const source = dragging
    dragging = null
    if (!e.dataTransfer || this.#composing) return
    this.#flush()
    const offset = this.offsetAtPoint(e.clientX, e.clientY)
    const copy = this.#copyKey(e)
    if (this.#opts.onDrop?.({ data: e.dataTransfer, offset, source, copy })) return
    const at = { anchor: offset, focus: offset }
    const insert = this.#readData(e.dataTransfer, at)
    if (!insert) return
    const len = insert.text.length
    if (source?.field === this && !copy) {
      // A move inside this field: dropping onto the dragged text changes nothing.
      if (offset >= source.start && offset <= source.end) { this.setSelection({ anchor: source.start, focus: source.end }); return }
      const without = deleteRange(this.#value, source.start, source.end, this.#formats)
      const target = offset > source.end ? offset - (source.end - source.start) : offset
      this.#commit(replace(without, target, target, insert, this.#formats), { anchor: target, focus: target + len }, 'drop')
      return
    }
    this.#commit(replace(this.#value, offset, offset, insert, this.#formats), { anchor: offset, focus: offset + len }, 'drop')
  }

  #watch(): void {
    watchSelection(this.element.ownerDocument, this, () => { this.#onSelectionChange() })
  }

  #onSelectionChange(fromPointer = false): void {
    if (this.#composing) return
    // Only a field holding the selection, or with the focus, reads it; the others stop listening.
    if (this.#selection === null && !hasFocusWithin(this.element)) { unwatchSelection(this.element.ownerDocument, this); return }
    this.#watch()
    // Read pending typing first, so it gets the pending formats before they are dropped.
    if (readSelection(this.element, this.#getSelection())) this.#flush()
    const before = this.#selection
    const now = this.#syncSelectionFromDom()
    const arrow = this.#arrow
    this.#arrow = null
    if (!now) {
      if (before) { this.#selection = null; this.#pending = null; this.#paintHighlights(); this.#opts.onSelectionChange?.(null) }
      return
    }
    const moved = !before || before.anchor !== now.anchor || before.focus !== now.focus
    if (moved) {
      // Moving the caret drops pending formats. Typing also moves it, but #readBack clears them itself.
      this.#pending = null
      if (arrow && isCollapsed(now)) this.#landOnBoundary(arrow)
      this.#paintHighlights()
    }
    // Returning to the same caret can still switch the editor's active block.
    if (moved || (fromPointer && hasFocusWithin(this.element))) this.#opts.onSelectionChange?.(now)
  }

  // -------------------------------------------------------------------------
  // Format boundaries: at the edge of a link or inline
  // code there are two caret positions, inside and outside. The arrow keys
  // step between them before they move the caret, so the author chooses
  // whether the next character joins the link. The side is a pending mark.

  /** Non-inclusive marks (link, code, language) of the character at `offset`. */
  #edgeMarks(offset: number): Mark[] {
    if (offset < 0 || offset >= this.#value.text.length) return []
    return marksAt(this.#value, offset).filter((m) => {
      const spec = this.#formats.get(m.type)
      return spec !== undefined && !spec.inclusive && !spec.object
    })
  }

  #stepBoundary(forward: boolean): boolean {
    const s = this.#selection
    if (!s) return false
    const o = s.focus
    const current = this.activeMarks()
    const before = this.#edgeMarks(o - 1), after = this.#edgeMarks(o)
    const has = (list: readonly Mark[], m: Mark): boolean => list.some((x) => marksEqual(x, m))
    const ahead = forward ? after : before
    const behind = forward ? before : after
    // Outside a range that starts (forward) or ends (backward) here: step in.
    const enter = ahead.filter((m) => !has(current, m) && !has(behind, m))
    // Inside a range that ends (forward) or starts (backward) here: step out.
    const leave = current.filter((m) => has(behind, m) && !has(ahead, m) && !this.#formats.get(m.type)?.inclusive)
    const next = enter.length > 0 ? [...current, ...enter] : leave.length > 0 ? current.filter((m) => !has(leave, m)) : null
    if (!next) return false
    this.#pending = next
    writeSelection(this.element, this.#getSelection(), s, this.#affinity())
    this.#paintHighlights()
    this.#opts.onSelectionChange?.(s)
    this.#opts.onBoundaryChange?.(enter.length > 0 ? { entered: enter, left: [] } : { entered: [], left: leave })
    return true
  }

  /** After the browser moved the caret onto a boundary, keep it on the side it came from. */
  #landOnBoundary(arrow: { forward: boolean; marks: Mark[] }): void {
    const o = this.#selection!.focus
    const came = this.#edgeMarks(arrow.forward ? o - 1 : o)
    const ahead = this.#edgeMarks(arrow.forward ? o : o - 1)
    const keep = came.filter((m) => arrow.marks.some((x) => marksEqual(x, m)) && !ahead.some((x) => marksEqual(x, m)))
    if (keep.length === 0) return
    const base = inheritedMarks(this.#value, o, this.#formats)
    this.#pending = [...base.filter((m) => !keep.some((k) => k.type === m.type)), ...keep]
  }

  /**
   * Move over an inline object in one step. Engines disagree about carets next
   * to non-editable elements (Firefox can stop on both sides of one), so the model decides.
   */
  #stepOverObject(forward: boolean): boolean {
    const s = this.#selection
    if (!s) return false
    const at = forward ? s.focus : s.focus - 1
    if (!this.objectAt(at)) return false
    const o = forward ? s.focus + 1 : s.focus - 1
    this.#pending = null
    this.setSelection({ anchor: o, focus: o })
    this.#opts.onSelectionChange?.(this.#selection)
    return true
  }

  /** Backspace or Delete next to an object removes exactly that object. */
  #deleteObject(at: number): boolean {
    if (!this.objectAt(at)) return false
    this.#flush()
    this.#pending = null
    this.#commit(deleteRange(this.#value, at, at + 1, this.#formats), { anchor: at, focus: at }, 'typing')
    return true
  }

  /**
   * Where the browser should put the caret: inside the element before it when
   * the next typed text carries all of that element's formats, otherwise
   * after it, so typing after a link does not type into the link.
   */
  #affinity(): Affinity {
    const s = this.#selection
    if (!s || !isCollapsed(s) || s.focus === 0) return 'backward'
    const marks = this.activeMarks()
    const before = marksAt(this.#value, s.focus - 1).filter((m) => !this.#formats.get(m.type)?.object)
    return before.every((m) => marks.some((x) => marksEqual(x, m))) ? 'backward' : 'forward'
  }

  /** The resolved base direction, so Left and Right can be read as backward and forward. */
  direction(): 'ltr' | 'rtl' {
    return getComputedStyle(this.element).direction === 'rtl' ? 'rtl' : 'ltr'
  }

  // -------------------------------------------------------------------------
  // Input rules. Each applies as its own change with origin
  // 'inputRule', after the typed character was committed, so one undo gives
  // the literal characters back.

  #rulesOn(): boolean {
    return this.#opts.inputRules !== false
  }

  /** `inserted` ends at the caret. Android keyboards commit a word and its space at once, so only its end counts. */
  #afterTyping(inserted: string): void {
    const s = this.#selection
    if (!s || !isCollapsed(s) || inserted === '') return
    const caret = s.focus
    if (inserted.endsWith(' ')) {
      const block = matchBlockRuleOnSpace(this.#value, caret, this.#formats)
      if (block && this.#opts.onBlockRule?.(block)) return
      if (this.#autolinkBeforeCaret(caret - 1)) return
    }
    const inline = matchInlineRule(this.#value, caret, (t) => this.#allowed(t), this.#formats)
    if (!inline) return
    this.#commit(inline.value, { anchor: inline.caret, focus: inline.caret }, 'inputRule')
    this.#pending = [...inline.marks]
    this.#paintHighlights()
  }

  /** Enter rules: a code fence or a separator line, then autolink. True when the block took over. */
  #enterRules(): boolean {
    const s = this.#selection
    if (!s || !isCollapsed(s)) return false
    if (s.focus === this.#value.text.length) {
      const block = matchBlockRuleOnEnter(this.#value)
      if (block && this.#opts.onBlockRule?.(block)) return true
    }
    this.#autolinkBeforeCaret()
    return false
  }

  #autolinkBeforeCaret(end?: number): boolean {
    const s = this.#selection
    if (!s || !isCollapsed(s) || !this.#allowed('link')) return false
    const linked = matchAutolink(this.#value, end ?? s.focus, this.#formats)
    if (!linked) return false
    this.#commit(linked, s, 'inputRule')
    return true
  }

  // -------------------------------------------------------------------------
  // Internals

  get #win(): Win {
    return this.element.ownerDocument.defaultView ?? window
  }

  /** A mark from a command, with its attributes through the format rules; null when refused. */
  #checked(mark: Mark): Mark | null {
    if (!this.#allowed(mark.type)) return null
    const attrs = checkFormatAttrs(mark.type, mark.attrs, this.#formats)
    if (!attrs) return null
    return Object.keys(attrs).length > 0 ? { type: mark.type, attrs } : { type: mark.type }
  }

  #allowed(type: string): boolean {
    return this.#opts.allowedFormats?.includes(type) ?? true
  }

  /** Only allowed formats, attributes through their rules, no stray object characters. */
  #sanitize(value: RichTextValue): RichTextValue {
    const formats: FormatRange[] = []
    const admit = formatTypeGate(this.#formats)
    for (const f of value.formats) {
      if (!this.#allowed(f.type) || !admit(f.type)) continue
      // Clipboard JSON comes from any page: its attributes pass the same rules as loaded JSON.
      const attrs = f.attrs ? checkFormatAttrs(f.type, f.attrs, this.#formats) : undefined
      if (attrs === null) continue
      formats.push(attrs && Object.keys(attrs).length > 0 ? { type: f.type, start: f.start, end: f.end, attrs } : { type: f.type, start: f.start, end: f.end })
    }
    return dropOrphanObjects(normalize({ text: value.text, formats }, this.#formats), this.#formats)
  }

  /** The range a format command acts on: the selection, or the range of `type` around a collapsed caret. */
  #commandRange(type: string): [number, number] | null {
    const s = this.#selection
    if (!s) return null
    if (!isCollapsed(s)) return [selectionStart(s), selectionEnd(s)]
    const r = formatRangeAt(this.#value, s.focus, type)
    return r ? [r.start, r.end] : null
  }

  #syncSelectionFromDom(): TextSelection | null {
    const s = readSelection(this.element, this.#getSelection())
    if (s) this.#selection = s
    return s
  }

  #marksForInsert(s: TextSelection): Mark[] {
    if (this.#pending) return this.#pending
    return typingMarks(this.#value, selectionStart(s), selectionEnd(s), this.#formats)
  }

  /** Read the browser's text edit back into the model. */
  #readBack(origin: ChangeOrigin): void {
    const domText = textFromDom(this.element)
    const sel = readSelection(this.element, this.#getSelection())
    const old = this.#value
    const change = findChange(old.text, domText, sel?.focus)
    if (!change) { this.#reconcile(); return }
    const raw = domText.slice(change.start, change.newEnd)
    // The browser never creates an object; an object character in typed text is a stray (a widget, a symbol picker).
    const inserted = raw.replaceAll(OBJECT_CHAR, '')
    const marks = (this.#pending ?? typingMarks(old, change.start, change.oldEnd, this.#formats)).filter((m) => this.#allowed(m.type))
    const next = replace(old, change.start, change.oldEnd, marked(inserted, marks), this.#formats)
    const end = change.start + inserted.length
    const caret = sel && inserted === raw ? sel : { anchor: end, focus: end }
    // Typing goes on with the formats it had, so the side of a boundary the author chose holds for the next character.
    this.#pending = inserted === '' ? null : marks
    this.#value = next
    this.#selection = caret
    this.#reconcile()
    if (inserted !== raw) writeSelection(this.element, this.#getSelection(), caret)
    this.#opts.onChange?.(next, caret, origin)
    if (this.#rulesOn() && change.oldEnd === change.start && isCollapsed(caret) && caret.focus === end) this.#afterTyping(inserted)
    this.#paintHighlights()
  }

  /** Commit any browser edit not yet read, so commands see the current text. */
  #flush(): void {
    if (this.#composing) return
    if (textFromDom(this.element) !== this.#value.text) this.#readBack('typing')
  }

  #replaceSelection(s: TextSelection, insert: RichTextValue, origin: ChangeOrigin): void {
    const a = selectionStart(s)
    const next = replace(this.#value, a, selectionEnd(s), insert, this.#formats)
    const caret = a + insert.text.length
    this.#pending = null
    this.#commit(next, { anchor: caret, focus: caret }, origin)
  }

  #commit(value: RichTextValue, selection: TextSelection, origin: ChangeOrigin): void {
    this.#value = value
    this.#reconcile()
    this.setSelection(selection)
    this.#opts.onChange?.(value, selection, origin)
  }

  #render(): void {
    this.element.replaceChildren(toDom(this.#value, this.element.ownerDocument, this.#formats, this.#opts.labels))
  }

  /**
   * Make the DOM canonical for the current value, replacing only the
   * top-level nodes that differ, and keep the selection where it was.
   */
  #reconcile(): void {
    if (this.#composing) return
    const root = this.element
    const want = Array.from(toDom(this.#value, root.ownerDocument, this.#formats, this.#opts.labels).childNodes)
    const have = Array.from(root.childNodes)
    let head = 0
    while (head < want.length && head < have.length && want[head]!.isEqualNode(have[head]!)) head++
    let tail = 0
    while (tail < want.length - head && tail < have.length - head && want[want.length - 1 - tail]!.isEqualNode(have[have.length - 1 - tail]!)) tail++
    if (head === want.length && head === have.length) return
    const sel = readSelection(root, this.#getSelection()) ?? this.#selection
    const ref = have[have.length - tail] ?? null
    for (let i = head; i < have.length - tail; i++) have[i]!.remove()
    for (let i = head; i < want.length - tail; i++) root.insertBefore(want[i]!, ref)
    if (sel && hasFocusWithin(root)) writeSelection(root, this.#getSelection(), sel, this.#affinity())
    this.#paintHighlights()
  }

  /** Repaint highlights: the DOM ranges die when reconciliation replaces nodes. */
  #paintHighlights(): void {
    const doc = this.element.ownerDocument
    const toRange = (start: number, end: number): Range => {
      const a = offsetToDomPoint(this.element, start), b = offsetToDomPoint(this.element, end)
      const r = doc.createRange()
      r.setStart(a.node, a.offset)
      r.setEnd(b.node, b.offset)
      return r
    }
    const len = this.#value.text.length
    for (const [name, list] of this.#highlights) {
      setHighlightRanges(this.#win, this, name, list.filter((x) => x.start < x.end && x.end <= len).map((x) => toRange(x.start, x.end)))
    }
    // The link or code the next typed character joins, so the author sees which side of its edge the caret is on.
    const s = this.#selection
    const boundary: Range[] = []
    if (s && isCollapsed(s) && hasFocusWithin(this.element)) {
      for (const m of this.activeMarks()) {
        const spec = this.#formats.get(m.type)
        if (!spec || spec.inclusive || spec.object) continue
        const r = this.#value.formats.find((f) => f.type === m.type && marksEqual(f, m) && f.start <= s.focus && s.focus <= f.end)
        if (r) boundary.push(toRange(r.start, r.end))
      }
    }
    setHighlightRanges(this.#win, this, BOUNDARY_HIGHLIGHT, boundary)
  }

  /** The canonical DOM matches the actual DOM (used by tests). */
  isCanonical(): boolean {
    const holder = this.element.ownerDocument.createElement('div')
    holder.appendChild(toDom(this.#value, this.element.ownerDocument, this.#formats, this.#opts.labels))
    return holder.innerHTML === this.element.innerHTML
  }

  /** The value as the DOM currently says, formats included (used by tests). */
  readDom(): RichTextValue {
    return fromDom(this.element, this.#formats)
  }
}

function sameLine(a: DOMRect, b: DOMRect): boolean {
  const mid = a.top + a.height / 2
  return mid >= b.top && mid <= b.top + Math.max(b.height, 1)
}

function clamp(n: number, len: number): number {
  return Math.max(0, Math.min(len, n))
}
