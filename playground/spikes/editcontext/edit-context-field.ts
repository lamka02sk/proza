/**
 * The rich-text field on the EditContext API, for its evaluation against
 * contenteditable. Chromium only.
 *
 * With EditContext the browser never edits the DOM: it reports text changes
 * and we render. This removes read-back and reconciliation, but the field
 * then owns caret painting of IME state, character bounds and every key the
 * EditContext does not handle (Enter, Tab, formatting shortcuts).
 */
import {
  applyFormat, defaultFormats, deleteRange, inheritedMarks, isFormatActive, marked, marksAt, removeFormat, replace,
  split, toggleFormat, toggleMark, type Mark, type RichTextValue,
} from '../../../src/model/richtext'
import { offsetToDomPoint, readSelection, selectionEnd, selectionStart, toDom, writeSelection, type TextSelection } from '../../../src/richtext/dom'
import type { FieldOptions } from '../../../src/richtext/field'
import type { FieldLike } from '../../shared/spike-doc'

// Minimal typings: TypeScript's DOM lib has no EditContext yet.
interface TextUpdateEvent extends Event {
  readonly updateRangeStart: number
  readonly updateRangeEnd: number
  readonly text: string
  readonly selectionStart: number
  readonly selectionEnd: number
}
interface TextFormat { readonly rangeStart: number; readonly rangeEnd: number; readonly underlineStyle: string; readonly underlineThickness: string }
interface TextFormatUpdateEvent extends Event { getTextFormats(): TextFormat[] }
interface CharacterBoundsUpdateEvent extends Event { readonly rangeStart: number; readonly rangeEnd: number }
interface EditContextLike extends EventTarget {
  readonly text: string
  updateText(start: number, end: number, text: string): void
  updateSelection(start: number, end: number): void
  updateControlBounds(r: DOMRect): void
  updateSelectionBounds(r: DOMRect): void
  updateCharacterBounds(start: number, bounds: DOMRect[]): void
}
declare const EditContext: { new (init?: { text?: string; selectionStart?: number; selectionEnd?: number }): EditContextLike } | undefined

export const editContextSupported = (): boolean => typeof (globalThis as { EditContext?: unknown }).EditContext === 'function'

export class EditContextField implements FieldLike {
  readonly element: HTMLElement
  #ctx: EditContextLike
  #value: RichTextValue
  #selection: TextSelection | null = null
  #pending: Mark[] | null = null
  #composing = false
  #opts: FieldOptions
  #abort = new AbortController()

  constructor(element: HTMLElement, options: FieldOptions = {}) {
    if (!EditContext) throw new Error('EditContext is not supported in this browser')
    this.element = element
    this.#opts = options
    this.#value = options.value ?? { text: '', formats: [] }
    this.#ctx = new EditContext({ text: this.#value.text })
    ;(element as HTMLElement & { editContext: EditContextLike | null }).editContext = this.#ctx
    element.tabIndex = 0
    element.classList.add('pz-richtext')
    element.style.setProperty('white-space', 'pre-wrap', 'important')
    element.setAttribute('role', 'textbox')
    element.setAttribute('aria-multiline', 'true')
    if (options.label) element.setAttribute('aria-label', options.label)
    this.#render()

    const signal = this.#abort.signal
    const trace = (e: Event): void => { this.#opts.onTrace?.(e) }
    this.#ctx.addEventListener('textupdate', (e) => { trace(e); this.#onTextUpdate(e as TextUpdateEvent) }, { signal })
    this.#ctx.addEventListener('textformatupdate', (e) => { trace(e); this.#onFormatUpdate(e as TextFormatUpdateEvent) }, { signal })
    this.#ctx.addEventListener('characterboundsupdate', (e) => { trace(e); this.#onBounds(e as CharacterBoundsUpdateEvent) }, { signal })
    this.#ctx.addEventListener('compositionstart', (e) => { trace(e); this.#composing = true }, { signal })
    this.#ctx.addEventListener('compositionend', (e) => { trace(e); this.#composing = false; CSS.highlights.delete('pz-ime') }, { signal })
    element.addEventListener('keydown', (e) => { trace(e); this.#onKeyDown(e) }, { signal })
    element.addEventListener('beforeinput', (e) => { trace(e); this.#onBeforeInput(e) }, { signal })
    element.ownerDocument.addEventListener('selectionchange', () => { this.#onSelectionChange() }, { signal })
  }

  destroy(): void {
    this.#abort.abort()
    ;(this.element as HTMLElement & { editContext: EditContextLike | null }).editContext = null
  }

  get value(): RichTextValue { return this.#value }
  get selection(): TextSelection | null { return this.#selection }

  setValue(value: RichTextValue, selection?: TextSelection): void {
    this.#value = value
    this.#ctx.updateText(0, this.#ctx.text.length, value.text)
    this.#render()
    if (selection) this.setSelection(selection)
  }

  setSelection(s: TextSelection): void {
    const len = this.#value.text.length
    const sel = { anchor: Math.min(len, Math.max(0, s.anchor)), focus: Math.min(len, Math.max(0, s.focus)) }
    this.#selection = sel
    if (document.activeElement !== this.element) this.element.focus({ preventScroll: true })
    writeSelection(this.element, document.getSelection(), sel)
    this.#ctx.updateSelection(selectionStart(sel), selectionEnd(sel))
  }

  focus(at: number | 'start' | 'end' = 'end'): void {
    const o = at === 'start' ? 0 : at === 'end' ? this.#value.text.length : at
    this.setSelection({ anchor: o, focus: o })
  }

  activeMarks(): Mark[] {
    const s = this.#selection
    if (!s) return []
    if (this.#pending) return this.#pending
    if (s.anchor === s.focus) return inheritedMarks(this.#value, s.focus)
    return [...defaultFormats.keys()].filter((t) => isFormatActive(this.#value, selectionStart(s), selectionEnd(s), t)).map((type) => ({ type }))
  }

  setPendingMarks(marks: readonly Mark[]): void { this.#pending = [...marks] }

  toggleFormat(mark: Mark): void {
    const s = this.#selection
    if (!s) return
    if (s.anchor === s.focus) { this.#pending = toggleMark(this.#pending ?? inheritedMarks(this.#value, s.focus), mark); return }
    this.#commit(toggleFormat(this.#value, selectionStart(s), selectionEnd(s), mark), s, 'format')
  }

  setLink(href: string | null): void {
    const s = this.#selection
    if (!s || s.anchor === s.focus) return
    const a = selectionStart(s), b = selectionEnd(s)
    this.#commit(href === null ? removeFormat(this.#value, a, b, 'link') : applyFormat(this.#value, a, b, { type: 'link', attrs: { href } }), s, 'format')
  }

  caretX(): number | null {
    const s = this.#selection
    return s ? this.#rect(s.focus).left : null
  }

  isCaretOnFirstLine(): boolean { return this.#onLine(0) }
  isCaretOnLastLine(): boolean { return this.#onLine(this.#value.text.length) }

  placeCaretAtX(x: number, line: 'first' | 'last'): void {
    const edge = line === 'first' ? 0 : this.#value.text.length
    const er = this.#rect(edge)
    let best = edge, dist = Infinity
    for (let i = 0; i <= this.#value.text.length; i++) {
      const r = this.#rect(i)
      if (Math.abs(r.top - er.top) > er.height / 2) continue
      const d = Math.abs(r.left - x)
      if (d < dist) { dist = d; best = i }
    }
    this.focus(best)
  }

  // -------------------------------------------------------------------------

  #onTextUpdate(e: TextUpdateEvent): void {
    const start = e.updateRangeStart, end = e.updateRangeEnd
    const marks = this.#pending ?? (end > start ? marksAt(this.#value, start) : inheritedMarks(this.#value, start))
    if (!this.#composing) this.#pending = null
    const next = replace(this.#value, start, end, marked(e.text, marks))
    this.#value = next
    this.#render()
    const sel = { anchor: e.selectionStart, focus: e.selectionEnd }
    this.#selection = sel
    writeSelection(this.element, document.getSelection(), sel)
    this.#opts.onChange?.(next, sel, this.#composing ? 'composition' : 'typing')
  }

  #onFormatUpdate(e: TextFormatUpdateEvent): void {
    // IME decorations go through the Custom Highlight API, so the DOM stays canonical.
    const ranges = e.getTextFormats().filter((f) => f.underlineStyle !== 'none' && f.rangeEnd > f.rangeStart).map((f) => {
      const r = new Range()
      const a = offsetToDomPoint(this.element, f.rangeStart), b = offsetToDomPoint(this.element, f.rangeEnd)
      r.setStart(a.node, a.offset); r.setEnd(b.node, b.offset)
      return r
    })
    if (ranges.length) CSS.highlights.set('pz-ime', new Highlight(...ranges))
    else CSS.highlights.delete('pz-ime')
  }

  #onBounds(e: CharacterBoundsUpdateEvent): void {
    const rects: DOMRect[] = []
    for (let i = e.rangeStart; i < e.rangeEnd; i++) rects.push(this.#charRect(i))
    this.#ctx.updateCharacterBounds(e.rangeStart, rects)
    this.#ctx.updateControlBounds(this.element.getBoundingClientRect())
  }

  #onKeyDown(e: KeyboardEvent): void {
    if (this.#opts.onKeyDown?.(e)) return
    const s = this.#selection
    if (!s) return
    const mod = e.ctrlKey || e.metaKey
    if (e.key === 'Enter' && !this.#composing) {
      e.preventDefault()
      if (e.shiftKey) { this.#replaceSelection(marked('\n', this.#pending ?? inheritedMarks(this.#value, selectionStart(s))), 'typing'); return }
      const without = deleteRange(this.#value, selectionStart(s), selectionEnd(s))
      const [before, after] = split(without, selectionStart(s))
      this.#opts.onSplit?.(before, after)
      return
    }
    const collapsed = s.anchor === s.focus
    if (e.key === 'Backspace' && collapsed && s.focus === 0 && !mod) { e.preventDefault(); this.#opts.onMergeBackward?.(); return }
    if (e.key === 'Delete' && collapsed && s.focus === this.#value.text.length && !mod) { e.preventDefault(); this.#opts.onMergeForward?.(); return }
    if (mod && !e.altKey) {
      const k = e.key.toLowerCase()
      const t = ({ b: 'bold', i: 'italic', u: 'underline' } as Record<string, string>)[k]
      if (t) { e.preventDefault(); this.toggleFormat({ type: t }); return }
      if (k === 'z') { e.preventDefault(); if (e.shiftKey) this.#opts.onRedo?.(); else this.#opts.onUndo?.(); return }
      if (k === 'y') { e.preventDefault(); this.#opts.onRedo?.() }
    }
  }

  #onBeforeInput(e: InputEvent): void {
    // Chromium still fires beforeinput for some intents on an EditContext element.
    if (e.inputType === 'historyUndo') { e.preventDefault(); this.#opts.onUndo?.() }
    if (e.inputType === 'historyRedo') { e.preventDefault(); this.#opts.onRedo?.() }
  }

  #onSelectionChange(): void {
    const s = readSelection(this.element, document.getSelection())
    if (!s) return
    const before = this.#selection
    if (before && before.anchor === s.anchor && before.focus === s.focus) return
    this.#selection = s
    if (!this.#composing) { this.#pending = null; this.#ctx.updateSelection(selectionStart(s), selectionEnd(s)) }
    this.#ctx.updateSelectionBounds(this.#rect(s.focus))
    this.#opts.onSelectionChange?.(s)
  }

  #replaceSelection(insert: RichTextValue, origin: 'typing' | 'format'): void {
    const s = this.#selection!
    const a = selectionStart(s)
    this.#pending = null
    this.#commit(replace(this.#value, a, selectionEnd(s), insert), { anchor: a + insert.text.length, focus: a + insert.text.length }, origin)
  }

  #commit(value: RichTextValue, sel: TextSelection, origin: 'typing' | 'format'): void {
    const oldText = this.#ctx.text
    this.#value = value
    if (oldText !== value.text) this.#ctx.updateText(0, oldText.length, value.text)
    this.#render()
    this.setSelection(sel)
    this.#opts.onChange?.(value, sel, origin)
  }

  #render(): void {
    // The browser never touches this DOM, so a full re-render is safe. shortcut: per-node diff if profiling asks for it.
    this.element.replaceChildren(toDom(this.#value, document))
  }

  #charRect(i: number): DOMRect {
    const a = offsetToDomPoint(this.element, i), b = offsetToDomPoint(this.element, i + 1)
    const r = new Range()
    r.setStart(a.node, a.offset); r.setEnd(b.node, b.offset)
    return r.getBoundingClientRect()
  }

  #rect(offset: number): DOMRect {
    const p = offsetToDomPoint(this.element, offset)
    const r = new Range()
    r.setStart(p.node, p.offset)
    const rect = r.getClientRects()[0]
    if (rect) return rect
    const box = this.element.getBoundingClientRect()
    return new DOMRect(box.left, offset === 0 ? box.top : box.bottom - 20, 0, 20)
  }

  #onLine(edge: number): boolean {
    const s = this.#selection
    if (!s) return false
    const a = this.#rect(s.focus), b = this.#rect(edge)
    return Math.abs(a.top - b.top) < Math.max(a.height, b.height) / 2
  }
}
