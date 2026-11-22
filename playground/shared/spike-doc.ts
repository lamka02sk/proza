/**
 * A minimal multi-block document for the spikes: a list of paragraphs,
 * each one a rich-text field, with split, merge, caret movement between
 * blocks and snapshot undo. Throwaway: the real version is src/editor.
 */
import { concat, defaultFormats, type Mark, type RichTextValue } from '../../src/model/richtext'
import type { BlockRule } from '../../src/model/input-rules'
import type { FieldOptions } from '../../src/richtext/field'
import { domPointToOffset, type TextSelection } from '../../src/richtext/dom'

/** What the spikes need from a field. RichTextField and the EditContext field both fit. */
export interface FieldLike {
  readonly element: HTMLElement
  readonly value: RichTextValue
  readonly selection: TextSelection | null
  setValue(value: RichTextValue, selection?: TextSelection): void
  setSelection(selection: TextSelection): void
  focus(at?: number | 'start' | 'end'): void
  toggleFormat(mark: Mark): void
  setLink(href: string | null): void
  activeMarks(): Mark[]
  setPendingMarks(marks: readonly Mark[]): void
  caretX(): number | null
  isCaretOnFirstLine(): boolean
  isCaretOnLastLine(): boolean
  placeCaretAtX(x: number, line: 'first' | 'last'): void
  destroy(): void
  // Format and object commands; the EditContext spike field does not have them.
  setFormat?(mark: Mark): void
  removeFormat?(type: string): void
  insertObject?(mark: Mark): void
  clearFormatting?(): void
}

export type FieldFactory = (element: HTMLElement, options: FieldOptions) => FieldLike

/** `type` records which block input rule fired; the spike has no other block types. */
interface Block { id: string; value: RichTextValue; type: string }
interface Snapshot { blocks: Block[]; focus: { id: string; selection: TextSelection } | null }

export interface TraceEntry { t: number; block: string; line: string }

let nextId = 1
const newId = (): string => `b${nextId++}`

export class SpikeDoc {
  readonly container: HTMLElement
  blocks: Block[] = []
  readonly fields = new Map<string, FieldLike>()
  readonly trace: TraceEntry[] = []
  focusedId: string | null = null
  #factory: FieldFactory
  #undo: Snapshot[] = []
  #redo: Snapshot[] = []
  #lastChange = { origin: '', id: '', time: 0 }
  #lastSelection = new Map<string, TextSelection>()
  #goalX: number | null = null
  #onUpdate: () => void
  #label: (index: number) => string

  constructor(container: HTMLElement, factory: FieldFactory, options: { onUpdate?: () => void; label?: (index: number) => string } = {}) {
    this.container = container
    this.#factory = factory
    this.#onUpdate = options.onUpdate ?? (() => undefined)
    this.#label = options.label ?? (() => 'Paragraph')
  }

  load(values: RichTextValue[]): void {
    for (const f of this.fields.values()) { f.destroy(); f.element.remove() }
    this.fields.clear()
    this.blocks = (values.length ? values : [{ text: '', formats: [] }]).map((value) => ({ id: newId(), value, type: 'paragraph' }))
    for (const b of this.blocks) this.container.appendChild(this.#create(b).element)
    this.#undo = []; this.#redo = []
    this.#updateTabStops()
    this.#onUpdate()
  }

  field(index: number): FieldLike | undefined {
    const b = this.blocks[index]
    return b ? this.fields.get(b.id) : undefined
  }

  get focused(): FieldLike | null {
    return this.focusedId ? this.fields.get(this.focusedId) ?? null : null
  }

  /** Asks the page for a link address (Mod+K). */
  requestLink: (field: FieldLike) => void = () => undefined

  undo(): void { this.#step(this.#undo, this.#redo) }
  redo(): void { this.#step(this.#redo, this.#undo) }

  // -------------------------------------------------------------------------

  #create(block: Block): FieldLike {
    const el = document.createElement('p')
    el.dataset.block = block.id
    el.dataset.type = block.type
    const id = block.id
    const field = this.#factory(el, {
      value: block.value,
      label: this.#label(this.blocks.findIndex((b) => b.id === id)),
      onChange: (value, selection, origin) => { this.#change(id, value, selection, origin) },
      onSelectionChange: (s) => {
        if (s) { this.#lastSelection.set(id, s); this.focusedId = id }
        this.#onUpdate()
      },
      onSplit: (before, after) => { this.#split(id, before, after) },
      onMergeBackward: () => { this.#merge(id, -1) },
      onMergeForward: () => { this.#merge(id, 1) },
      onBlockRule: (match) => { this.#blockRule(id, match.rule, match.rest); return true },
      onRequestLink: () => { const f = this.fields.get(id); if (f) this.requestLink(f) },
      onUndo: () => { this.undo() },
      onRedo: () => { this.redo() },
      onKeyDown: (e) => this.#navigate(id, e),
      onTrace: (e) => { this.#traceEvent(id, e) },
    })
    el.addEventListener('focus', () => { this.focusedId = id; this.#updateTabStops(); this.#onUpdate() })
    this.fields.set(id, field)
    return field
  }

  /** One Tab stop for the whole canvas: the last focused block. */
  #updateTabStops(): void {
    const current = this.focusedId && this.fields.has(this.focusedId) ? this.focusedId : this.blocks[0]?.id
    for (const [bid, f] of this.fields) f.element.tabIndex = bid === current ? 0 : -1
  }

  #index(id: string): number { return this.blocks.findIndex((b) => b.id === id) }

  #snapshot(): Snapshot {
    const id = this.focusedId
    const selection = id ? this.#lastSelection.get(id) : undefined
    return { blocks: this.blocks.map((b) => ({ ...b })), focus: id && selection ? { id, selection } : null }
  }

  #record(origin: string, id: string): void {
    const now = performance.now()
    const last = this.#lastChange
    const coalesce = origin === 'typing' && last.origin === 'typing' && last.id === id && now - last.time < 1000
    if (!coalesce) { this.#undo.push(this.#snapshot()); this.#redo = [] }
    this.#lastChange = { origin, id, time: now }
  }

  #change(id: string, value: RichTextValue, selection: TextSelection, origin: string): void {
    this.#record(origin === 'composition' ? 'typing' : origin, id)
    const i = this.#index(id)
    if (i < 0) return
    this.blocks[i] = { ...this.blocks[i]!, value }
    this.#lastSelection.set(id, selection)
    this.focusedId = id
    this.#onUpdate()
  }

  /** A block input rule: the block takes the rule's type and keeps the text after the prefix. Its own undo step. */
  #blockRule(id: string, rule: BlockRule, rest: RichTextValue): void {
    this.#record('blockRule', id)
    const i = this.#index(id)
    const type = rule.kind === 'heading' ? `heading-${rule.level}` : rule.kind === 'list' ? `list-${rule.style}` : rule.kind
    this.blocks[i] = { id, value: rest, type }
    const f = this.fields.get(id)!
    f.element.dataset.type = type
    f.setValue(rest, { anchor: 0, focus: 0 })
    this.#lastSelection.set(id, { anchor: 0, focus: 0 })
    this.#onUpdate()
  }

  #split(id: string, before: RichTextValue, after: RichTextValue): void {
    this.#record('split', id)
    // Word processors carry character formatting across Enter, but not links or code.
    const carried = this.fields.get(id)!.activeMarks().filter((m) => defaultFormats.get(m.type)?.inclusive === true)
    const i = this.#index(id)
    const block: Block = { id: newId(), value: after, type: 'paragraph' }
    this.blocks[i] = { ...this.blocks[i]!, value: before }
    this.blocks.splice(i + 1, 0, block)
    this.fields.get(id)!.setValue(before)
    const field = this.#create(block)
    this.fields.get(id)!.element.after(field.element)
    field.focus(0)
    field.setPendingMarks(carried)
    this.#lastSelection.set(block.id, { anchor: 0, focus: 0 })
    this.focusedId = block.id
    this.#onUpdate()
  }

  #merge(id: string, direction: -1 | 1): void {
    const i = this.#index(id)
    const j = i + direction
    if (j < 0 || j >= this.blocks.length) return
    this.#record('merge', id)
    const [first, second] = direction < 0 ? [this.blocks[j]!, this.blocks[i]!] : [this.blocks[i]!, this.blocks[j]!]
    const caret = first.value.text.length
    const joined = concat([first.value, second.value])
    this.blocks[this.#index(first.id)] = { ...first, value: joined }
    this.blocks.splice(this.#index(second.id), 1)
    const gone = this.fields.get(second.id)!
    gone.destroy(); gone.element.remove(); this.fields.delete(second.id)
    const keep = this.fields.get(first.id)!
    keep.setValue(joined, { anchor: caret, focus: caret })
    keep.focus(caret)
    this.focusedId = first.id
    this.#onUpdate()
  }

  #step(from: Snapshot[], to: Snapshot[]): void {
    const snap = from.pop()
    if (!snap) return
    to.push(this.#snapshot())
    this.#lastChange = { origin: '', id: '', time: 0 }
    const keep = new Set(snap.blocks.map((b) => b.id))
    for (const [bid, f] of this.fields) if (!keep.has(bid)) { f.destroy(); f.element.remove(); this.fields.delete(bid) }
    this.blocks = snap.blocks.map((b) => ({ ...b }))
    let prev: HTMLElement | null = null
    for (const b of this.blocks) {
      const f = this.fields.get(b.id) ?? this.#create(b)
      if (f.value !== b.value) f.setValue(b.value)
      f.element.dataset.type = b.type
      if (prev) prev.after(f.element); else this.container.prepend(f.element)
      prev = f.element
    }
    if (snap.focus) {
      const f = this.fields.get(snap.focus.id)
      if (f) { f.setSelection(snap.focus.selection); this.focusedId = snap.focus.id }
    }
    this.#onUpdate()
  }

  /** Caret movement between blocks. */
  #navigate(id: string, e: KeyboardEvent): boolean {
    const vertical = e.key === 'ArrowUp' || e.key === 'ArrowDown'
    if (!vertical) this.#goalX = null
    if (e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return false
    const i = this.#index(id)
    const field = this.fields.get(id)!
    const s = field.selection
    if (!s || s.anchor !== s.focus) return false
    const prev = this.field(i - 1), next = this.field(i + 1)
    if (e.key === 'ArrowUp' && prev && field.isCaretOnFirstLine()) {
      this.#goalX ??= field.caretX()
      e.preventDefault(); prev.placeCaretAtX(this.#goalX ?? 0, 'last'); return true
    }
    if (e.key === 'ArrowDown' && next && field.isCaretOnLastLine()) {
      this.#goalX ??= field.caretX()
      e.preventDefault(); next.placeCaretAtX(this.#goalX ?? 0, 'first'); return true
    }
    if (e.key === 'ArrowLeft' && prev && s.focus === 0) { e.preventDefault(); prev.focus('end'); return true }
    if (e.key === 'ArrowRight' && next && s.focus === field.value.text.length) { e.preventDefault(); next.focus('start'); return true }
    return false
  }

  #traceEvent(id: string, e: Event): void {
    const el = this.fields.get(id)?.element
    let line = e.type
    if (e instanceof InputEvent) {
      const ranges = e.type === 'beforeinput' && el
        ? e.getTargetRanges().map((r) => `${domPointToOffset(el, r.startContainer, r.startOffset)}-${domPointToOffset(el, r.endContainer, r.endOffset)}`)
        : []
      line += ` ${e.inputType} data=${JSON.stringify(e.data)} composing=${e.isComposing} cancelable=${e.cancelable}${ranges.length ? ` ranges=${ranges.join(',')}` : ''}`
    } else if (e instanceof KeyboardEvent) {
      // eslint-disable-next-line @typescript-eslint/no-deprecated -- logged on purpose: Android sends 229
      line += ` key=${JSON.stringify(e.key)} code=${e.code} keyCode=${e.keyCode} composing=${e.isComposing}${e.shiftKey ? ' shift' : ''}${e.ctrlKey ? ' ctrl' : ''}${e.metaKey ? ' meta' : ''}${e.altKey ? ' alt' : ''}`
    } else if (e instanceof CompositionEvent) {
      line += ` data=${JSON.stringify(e.data)}`
    }
    const entry = { t: Math.round(performance.now()), block: id, line }
    this.trace.push(entry)
    if (this.trace.length > 500) this.trace.shift()
    // Record whether a handler cancelled it, once the handlers have run.
    queueMicrotask(() => { if (e.defaultPrevented) entry.line += ' [prevented]'; this.#onUpdate() })
  }
}
