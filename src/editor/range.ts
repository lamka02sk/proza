/**
 * Text selected across parts. Pure:
 * each function reads a tree and a `range` selection and returns operations
 * and the selection after, or the blocks to copy.
 *
 * A range runs from a place in one field to a place in another, in reading
 * order. What lies between is covered: whole parts that have every stop
 * inside it, and whole fields of the parts around it.
 */
import { type Mark, type RichTextValue, applyFormat, deleteRange as deleteText, insertText, isFormatActive, removeAllFormats, removeFormat, slice, split as splitText, typingMarks } from '../model/richtext'
import type { SchemaRegistry } from '../model/schema'
import { type Block, type ParentId, childrenOf, isSelfOrAncestor, parentOf, topmost } from '../model/tree'
import { wrapForCopy } from './clipboard'
import { type Change, type Stop, type StructureContext, fieldValue, mainField, stopsIn } from './editing'
import { type EditorSelection, type TextPoint, caret, cells, liftToSiblings, range } from './selection'
import { Draft, cleanup, joinInto, newBlock, placeBlocks, splitBlock } from './structure'
import { CELL, TABLE, enclosing } from './table'

const PARAGRAPH = 'core/paragraph'

export type RangeSelection = Extract<EditorSelection, { kind: 'range' }>

/** A range in reading order, with the stops of the document and the indexes of its ends. */
export interface RangeEnds {
  readonly start: TextPoint
  readonly end: TextPoint
  readonly order: readonly Stop[]
  /** Index of the start's field and of the end's field in `order`. */
  readonly i: number
  readonly j: number
}

/** One field's part of a range: [start, end) of its text. */
export interface Piece { readonly blockId: string; readonly field: string; readonly start: number; readonly end: number }

/**
 * Every stop in reading order, optional fields included whether they are
 * shown or not: where a range starts and ends must not depend on which block
 * the caret is in.
 */
export function orderedStops(ctx: Pick<StructureContext, 'tree' | 'editing'>): Stop[] {
  const out: Stop[] = []
  const walk = (ids: readonly string[]): void => {
    for (const id of ids) {
      const node = ctx.tree.nodes.get(id)!
      const fields = ctx.editing.get(node.type)?.fields ?? []
      const kids = ctx.tree.children.get(id)
      for (const f of fields) if (!f.after) out.push({ blockId: id, field: f.attr })
      if (fields.length === 0 && (!kids || kids.length === 0)) out.push({ blockId: id, field: null })
      if (kids) walk(kids)
      for (const f of fields) if (f.after) out.push({ blockId: id, field: f.attr })
    }
  }
  walk(childrenOf(ctx.tree, null))
  return out
}

const indexOf = (order: readonly Stop[], p: TextPoint): number => order.findIndex((s) => s.blockId === p.blockId && s.field === p.field)

/** The range's ends in reading order. Null when an end is gone or both are in one field. */
export function rangeEnds(ctx: Pick<StructureContext, 'tree' | 'editing'>, sel: RangeSelection, order: readonly Stop[] = orderedStops(ctx)): RangeEnds | null {
  const a = indexOf(order, sel.anchor), f = indexOf(order, sel.focus)
  if (a < 0 || f < 0 || a === f) return null
  const len = (p: TextPoint): number => fieldValue(ctx.tree.nodes.get(p.blockId)!, p.field).text.length
  const fit = (p: TextPoint): TextPoint => ({ ...p, offset: Math.max(0, Math.min(len(p), p.offset)) })
  return a < f
    ? { start: fit(sel.anchor), end: fit(sel.focus), order, i: a, j: f }
    : { start: fit(sel.focus), end: fit(sel.anchor), order, i: f, j: a }
}

/**
 * The selection from `anchor` to `focus` as the editor keeps it: one field is
 * a text selection; two cells of one table select cells; an
 * end inside an isolating part that does not hold the other end (a table, a
 * column) moves to that part's far edge, so a range never ends partway into a
 * table or a column it does not start in.
 */
export function normalizeRange(ctx: Pick<StructureContext, 'tree' | 'editing'>, anchor: TextPoint, focus: TextPoint): EditorSelection {
  const tree = ctx.tree
  if (anchor.blockId === focus.blockId && anchor.field === focus.field) {
    return { kind: 'text', blockId: anchor.blockId, field: anchor.field, anchor: anchor.offset, focus: focus.offset }
  }
  const ca = enclosing(tree, anchor.blockId, CELL), cf = enclosing(tree, focus.blockId, CELL)
  if (ca !== null && cf !== null && ca !== cf) {
    const table = enclosing(tree, ca, TABLE)
    if (table !== null && table === enclosing(tree, cf, TABLE)) return cells(table, ca, cf)
  }
  const order = orderedStops(ctx)
  const ai = indexOf(order, anchor), fi = indexOf(order, focus)
  if (ai < 0 || fi < 0) return { kind: 'none' }
  const forward = ai < fi
  const a = clampOut(ctx, order, anchor, focus.blockId, forward ? 'start' : 'end')
  const f = clampOut(ctx, order, focus, anchor.blockId, forward ? 'end' : 'start')
  if (a.blockId === f.blockId && a.field === f.field) {
    return { kind: 'text', blockId: a.blockId, field: a.field, anchor: a.offset, focus: f.offset }
  }
  return range(a, f)
}

/** `p` moved to the `edge` of the outermost isolating part around it that does not hold `other`. */
function clampOut(ctx: Pick<StructureContext, 'tree' | 'editing'>, order: readonly Stop[], p: TextPoint, other: string, edge: 'start' | 'end'): TextPoint {
  let outer: string | null = null
  for (let id: ParentId = p.blockId; id !== null; id = parentOf(ctx.tree, id)) {
    if (isSelfOrAncestor(ctx.tree, id, other)) break
    if (ctx.editing.get(ctx.tree.nodes.get(id)!.type)?.isolating) outer = id
  }
  if (outer === null) return p
  const inside = order.filter((s) => s.field !== null && isSelfOrAncestor(ctx.tree, outer, s.blockId))
  const s = edge === 'start' ? inside[0] : inside.at(-1)
  if (!s?.field) return p
  return { blockId: s.blockId, field: s.field, offset: edge === 'start' ? 0 : fieldValue(ctx.tree.nodes.get(s.blockId)!, s.field).text.length }
}

/** The text of each field the range touches, in reading order. */
export function pieces(ctx: Pick<StructureContext, 'tree'>, ends: RangeEnds): Piece[] {
  const out: Piece[] = []
  for (let k = ends.i; k <= ends.j; k++) {
    const s = ends.order[k]!
    if (s.field === null) continue
    const len = fieldValue(ctx.tree.nodes.get(s.blockId)!, s.field).text.length
    out.push({ blockId: s.blockId, field: s.field, start: k === ends.i ? ends.start.offset : 0, end: k === ends.j ? ends.end.offset : len })
  }
  return out
}

/**
 * Parts the range covers whole (topmost first): what deleting it removes, and
 * what is shown selected as a whole. A part counts when every stop of it is
 * strictly inside the range; an isolating part (a table, columns) also when an
 * end of the range sits at its outer edge, which is where normalizeRange puts
 * an end that reached into it.
 */
export function coveredBlocks(ctx: Pick<StructureContext, 'tree' | 'editing'>, ends: RangeEnds): string[] {
  const tree = ctx.tree
  const min = new Map<string, number>(), max = new Map<string, number>()
  ends.order.forEach((s, k) => {
    for (let id: ParentId = s.blockId; id !== null; id = parentOf(tree, id)) {
      if ((min.get(id) ?? Infinity) > k) min.set(id, k)
      if ((max.get(id) ?? -1) < k) max.set(id, k)
    }
  })
  const fromStart = ends.start.offset === 0
  const toEnd = ends.end.offset === fieldValue(tree.nodes.get(ends.end.blockId)!, ends.end.field).text.length
  const covered: string[] = []
  for (const [id, lo] of min) {
    const hi = max.get(id)!
    if (lo > ends.i && hi < ends.j) { covered.push(id); continue }
    if (!ctx.editing.get(tree.nodes.get(id)!.type)?.isolating) continue
    if ((lo > ends.i || (lo === ends.i && fromStart)) && (hi < ends.j || (hi === ends.j && toEnd)) && lo >= ends.i && hi <= ends.j) covered.push(id)
  }
  return topmost(tree, covered)
}

/** The parts the range touches, as siblings (block commands act on these: change type, move). */
export function rangeBlocks(ctx: Pick<StructureContext, 'tree'>, ends: RangeEnds): string[] {
  const { parent, anchor, focus } = liftToSiblings(ctx.tree, ends.start.blockId, ends.end.blockId)
  const kids = childrenOf(ctx.tree, parent)
  const i = kids.indexOf(anchor), j = kids.indexOf(focus)
  return kids.slice(Math.min(i, j), Math.max(i, j) + 1)
}

/** How many parts with text the range reaches into, for announcements. */
export function partCount(ctx: Pick<StructureContext, 'tree'>, ends: RangeEnds): number {
  return new Set(pieces(ctx, ends).map((p) => p.blockId)).size
}

// ---------------------------------------------------------------------------
// Editing

/**
 * Delete the text of the range. Parts covered whole go; the rest of the end
 * part joins the start part when the two can be joined:
 * never across an isolating edge, never into a citation or a caption. The
 * caret goes where the range started.
 */
export function deleteAcross(ctx: StructureContext, sel: RangeSelection): Change | null {
  const ends = rangeEnds(ctx, sel)
  if (!ends) return null
  const d = new Draft(ctx)
  return d.done(removeContent(d, ends), { announce: ctx.strings.deletedAcross(partCount(ctx, ends)) })
}

/** Remove the range's content; returns the caret after (where the range started, or after what went). */
function removeContent(d: Draft, ends: RangeEnds): EditorSelection {
  const { end } = ends
  let start = ends.start
  const tree = d.tree
  const covered = coveredBlocks({ tree, editing: d.ctx.editing }, ends)
  const inside = ends.order.slice(ends.i + 1, ends.j)
  // A whole column or cell is emptied, not removed: the structure around it stays.
  const empty = covered.filter((id) => { const p = parentOf(tree, id); return p !== null && d.def(p)?.isolating === true })
  const gone = covered.filter((id) => !empty.includes(id))
  const parents = [...new Set(gone.map((id) => parentOf(tree, id)))]
  // The range may start at the edge of a table or columns it covers: the part that held its start goes.
  const startTop = covered.find((id) => isSelfOrAncestor(tree, id, start.blockId)) ?? null
  const startPlace = startTop === null ? null : { parent: parentOf(tree, startTop), index: d.index(startTop) }
  d.remove(gone)
  // Emptied, not removed: a cell or column keeps an empty line, a row keeps its cells.
  const emptyOut = (id: string): void => {
    if (d.def(id)?.keepsChild) { d.remove(d.kids(id)); cleanup(d, id) } else for (const k of d.kids(id)) emptyOut(k)
  }
  for (const id of empty) emptyOut(id)
  // Fields between the ends whose part stays (a quote's citation, an emptied column's own text).
  for (const s of inside) {
    if (s.field === null || !d.has(s.blockId) || d.value(s.blockId, s.field).text === '') continue
    d.set(s.blockId, { [s.field]: { text: '', formats: [] } })
  }
  if (d.has(end.blockId)) {
    const ev = d.value(end.blockId, end.field)
    if (end.offset > 0) d.set(end.blockId, { [end.field]: deleteText(ev, 0, end.offset, d.ctx.formats) })
  }
  const endMain = d.has(end.blockId) && mainField(d.def(end.blockId))?.attr === end.field
  if (startTop !== null && gone.includes(startTop)) {
    // The end's text can take the caret; otherwise (a citation, or gone too) an empty line takes
    // the start's place, so what is typed or pasted next lands where the range was.
    if (endMain) { for (const p of parents) if (p === null || d.has(p)) cleanup(d, p); return caret(end.blockId, end.field, 0) }
    const p = newBlock(d.ctx, PARAGRAPH)
    placeBlocks(d, startPlace!.parent !== null && !d.has(startPlace!.parent) ? null : startPlace!.parent, startPlace!.index, [p])
    start = { blockId: p.id, field: 'content', offset: 0 }
  } else if (d.has(start.blockId)) {
    const sv = d.value(start.blockId, start.field)
    d.set(start.blockId, { [start.field]: deleteText(sv, start.offset, sv.text.length, d.ctx.formats) })
  }
  for (const p of parents) if (p === null || d.has(p)) cleanup(d, p)
  if (!d.has(start.blockId) && startTop !== null && d.has(startTop)) {
    // An emptied column or cell got its empty line back: the caret goes there.
    const first = stopsIn(d.now(null), startTop).find((s) => s.field !== null)
    if (first?.field) start = { blockId: first.blockId, field: first.field, offset: 0 }
  }
  if (!d.has(start.blockId)) return d.has(end.blockId) ? caret(end.blockId, end.field, 0) : { kind: 'none' }
  if (start.blockId !== end.blockId && d.has(end.blockId)) joinInto(d, start.blockId, start.field, end.blockId, end.field)
  return caret(start.blockId, start.field, start.offset)
}

/** Typing over a range: its text goes, and the typed text takes the formats of its first character. */
export function replaceAcross(ctx: StructureContext, sel: RangeSelection, text: string): Change | null {
  const ends = rangeEnds(ctx, sel)
  if (!ends) return null
  const { start } = ends
  const before = fieldValue(ctx.tree.nodes.get(start.blockId)!, start.field)
  const marks = typingMarks(before, start.offset, before.text.length, ctx.formats)
  const d = new Draft(ctx)
  const at = removeContent(d, ends)
  if (at.kind !== 'text') return d.done(at)
  const v = d.value(at.blockId, at.field)
  d.set(at.blockId, { [at.field]: insertText(v, at.focus, text, at.blockId === start.blockId ? marks : undefined, ctx.formats) })
  return d.done(caret(at.blockId, at.field, at.focus + text.length))
}

/** Enter on a range: the text goes, then the start part splits at the caret. */
export function splitAcross(ctx: StructureContext, sel: RangeSelection, marks: readonly Mark[] = []): Change | null {
  const removed = deleteAcross(ctx, sel)
  if (!removed || removed.selection.kind !== 'text') return removed
  const at = removed.selection
  return andThen(ctx, removed, (next) => {
    const value = fieldValue(next.tree.nodes.get(at.blockId)!, at.field)
    const [before, after] = splitText(value, at.focus)
    return splitBlock(next, at.blockId, at.field, before, after, marks)
  })
}

/**
 * `change`, then what `next` makes of the document it leaves, as one change
 * (one undo step): deleting a range, then pasting at the caret it left.
 */
export function andThen(ctx: StructureContext, change: Change, next: (after: StructureContext) => Change | null): Change {
  const d = new Draft(ctx)
  for (const op of change.ops) d.apply(op)
  const sel = change.selection
  const current = sel.kind === 'text' ? sel.blockId : null
  const second = next({ ...d.now(current), selection: sel })
  if (!second) return change
  const announce = second.announce ?? change.announce
  return { ...second, ops: [...change.ops, ...second.ops], ...(announce !== undefined ? { announce } : {}) }
}

// ---------------------------------------------------------------------------
// Formats

export type FormatEdit =
  | { readonly toggle: Mark }
  | { readonly set: Mark }
  | { readonly remove: string }
  | 'clear'

/** Which fields take which format: the schema's list for the attribute and the preset (the editor knows both). */
export type Allows = (blockId: string, field: string, type: string) => boolean

/**
 * A format over the whole range, in every field that takes it. Toggling
 * removes it when all the selected text in those fields has it, and adds it
 * otherwise. The range stays selected.
 */
export function formatAcross(ctx: StructureContext, sel: RangeSelection, edit: FormatEdit, allows: Allows): Change | null {
  const ends = rangeEnds(ctx, sel)
  if (!ends) return null
  const d = new Draft(ctx)
  const type = edit === 'clear' ? null : 'remove' in edit ? edit.remove : 'toggle' in edit ? edit.toggle.type : edit.set.type
  const list = pieces(ctx, ends).filter((p) => p.start < p.end && (type === null || allows(p.blockId, p.field, type)))
  if (list.length === 0) return null
  const on = edit !== 'clear' && 'toggle' in edit && list.every((p) => isFormatActive(d.value(p.blockId, p.field), p.start, p.end, edit.toggle.type))
  for (const p of list) {
    const v = d.value(p.blockId, p.field)
    let next: RichTextValue
    if (edit === 'clear') next = removeAllFormats(v, p.start, p.end, ctx.formats)
    else if ('remove' in edit) next = removeFormat(v, p.start, p.end, edit.remove, ctx.formats)
    else if ('set' in edit) next = applyFormat(v, p.start, p.end, edit.set, ctx.formats)
    else next = on ? removeFormat(v, p.start, p.end, edit.toggle.type, ctx.formats) : applyFormat(v, p.start, p.end, edit.toggle, ctx.formats)
    if (next !== v) d.set(p.blockId, { [p.field]: next })
  }
  if (d.ops.length === 0) return null
  return d.done(sel)
}

/** Formats every selected character has, in the fields that take them (the format bar's pressed states). */
export function marksAcross(ctx: Pick<StructureContext, 'tree' | 'editing' | 'formats'>, sel: RangeSelection, allows: Allows): Mark[] {
  const ends = rangeEnds(ctx, sel)
  if (!ends) return []
  const list = pieces(ctx, ends).filter((p) => p.start < p.end)
  const first = list[0]
  if (!first) return []
  const out: Mark[] = []
  const firstValue = fieldValue(ctx.tree.nodes.get(first.blockId)!, first.field)
  for (const f of firstValue.formats) {
    if (f.start > first.start || f.end < first.end || out.some((m) => m.type === f.type)) continue
    const all = list.filter((p) => allows(p.blockId, p.field, f.type))
    if (all.every((p) => isFormatActive(fieldValue(ctx.tree.nodes.get(p.blockId)!, p.field), p.start, p.end, f.type))) {
      out.push(f.attrs ? { type: f.type, attrs: f.attrs } : { type: f.type })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Copy

/**
 * The blocks to copy for a range: the parts it touches, as siblings under
 * their common container, with fields cut at the ends and outside fields
 * emptied. Parts that cannot stand alone travel in their container (list
 * items in a list). The result is an open slice.
 */
export function copyAcross(ctx: Pick<StructureContext, 'tree' | 'editing'>, schemas: SchemaRegistry, sel: RangeSelection): Block[] {
  const ends = rangeEnds(ctx, sel)
  if (!ends) return []
  const tree = ctx.tree
  const position = new Map<string, number>()
  ends.order.forEach((s, k) => { if (s.field !== null) position.set(`${s.blockId}:${s.field}`, k) })
  const reach = new Map<string, [number, number]>()
  ends.order.forEach((s, k) => {
    for (let id: ParentId = s.blockId; id !== null; id = parentOf(tree, id)) {
      const r = reach.get(id)
      reach.set(id, r ? [Math.min(r[0], k), Math.max(r[1], k)] : [k, k])
    }
  })
  const touches = (id: string): boolean => { const r = reach.get(id); return r !== undefined && r[1] >= ends.i && r[0] <= ends.j }
  const copy = (id: string): Block => {
    const node = tree.nodes.get(id)!
    const attrs: Record<string, unknown> = { ...node.attrs }
    for (const f of ctx.editing.get(node.type)?.fields ?? []) {
      const k = position.get(`${id}:${f.attr}`)
      if (k === undefined) continue
      const v = fieldValue(node, f.attr)
      attrs[f.attr] = k < ends.i || k > ends.j ? { text: '', formats: [] }
        : slice(v, k === ends.i ? ends.start.offset : 0, k === ends.j ? ends.end.offset : v.text.length)
    }
    const kids = tree.children.get(id)
    return kids ? { id, type: node.type, attrs, children: kids.filter(touches).map(copy) } : { id, type: node.type, attrs }
  }
  const top = rangeBlocks(ctx, ends)
  return wrapForCopy(tree, schemas, parentOf(tree, top[0]!), top.map(copy))
}
