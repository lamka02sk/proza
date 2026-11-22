/**
 * Structural edits: what Enter, Backspace and
 * Delete at the edge of a field mean, and the block commands (remove, move,
 * duplicate, change type, paste blocks). Pure: each function reads a tree and
 * returns the operations and the selection after, or null when it does not apply.
 */
import { type Operation, applyOperation } from '../model/operations'
import {
  type Mark, type RichTextValue, concat, deleteRange, dropOrphanObjects, normalize, replace as replaceText, slice, split as splitText,
} from '../model/richtext'
import { UNSUPPORTED, attrSpecs, defaultAttrs } from '../model/schema'
import { type Attrs, type Block, type BlockNode, type ParentId, type Tree, TreeError, childrenOf, getBlock, isSelfOrAncestor, parentOf, topmost } from '../model/tree'
import {
  type BlockEditing, type Change, type Stop, type StructureContext, fieldValue, mainField, neighbourStop, stops, stopsIn,
} from './editing'
import { type EditorSelection, blocks as blockSelection, caret, selectedBlocks } from './selection'

const PARAGRAPH = 'core/paragraph'

// ---------------------------------------------------------------------------
// Draft: operations applied one by one, so each step sees the tree the previous one left.

export class Draft {
  tree: Tree
  readonly ops: Operation[] = []
  readonly ctx: StructureContext

  constructor(ctx: StructureContext) {
    this.ctx = ctx
    this.tree = ctx.tree
  }

  apply(op: Operation): void {
    this.tree = applyOperation(this.tree, op).tree
    this.ops.push(op)
  }

  node(id: string): BlockNode {
    const n = this.tree.nodes.get(id)
    if (!n) throw new TreeError(`No block ${id}`)
    return n
  }

  has(id: string): boolean { return this.tree.nodes.has(id) }
  parent(id: string): ParentId { return parentOf(this.tree, id) }
  kids(parent: ParentId): readonly string[] { return parent !== null && !this.tree.children.has(parent) ? [] : childrenOf(this.tree, parent) }
  index(id: string): number { return this.kids(this.parent(id)).indexOf(id) }
  block(id: string): Block { return getBlock(this.tree, id) }
  def(id: string): BlockEditing | undefined { return this.ctx.editing.get(this.node(id).type) }
  value(id: string, attr: string): RichTextValue { return fieldValue(this.node(id), attr) }

  set(id: string, patch: Attrs): void { this.apply({ type: 'setAttrs', id, patch }) }
  insert(parent: ParentId, index: number, blocks: readonly Block[]): void {
    if (blocks.length > 0) this.apply({ type: 'insertBlocks', parentId: parent, index, blocks })
  }
  remove(ids: readonly string[]): void {
    if (ids.length > 0) this.apply({ type: 'removeBlocks', ids })
  }
  move(ids: readonly string[], parent: ParentId, index: number): void {
    if (ids.length > 0) this.apply({ type: 'moveBlocks', ids, parentId: parent, index })
  }

  /** The context as of now, for stop queries after some operations. */
  now(current: string | null = this.ctx.current): StructureContext {
    return { ...this.ctx, tree: this.tree, current }
  }

  /** Finish: a document is never empty, so the caret always has somewhere to be. */
  done(selection: EditorSelection, extra: Omit<Change, 'ops' | 'selection'> = {}): Change {
    if (this.kids(null).length === 0) {
      const p = newBlock(this.ctx, PARAGRAPH)
      this.insert(null, 0, [p])
      return { ...extra, ops: this.ops, selection: caret(p.id, 'content', 0) }
    }
    return { ...extra, ops: this.ops, selection }
  }
}

// ---------------------------------------------------------------------------
// Schema helpers

/** A new block with default attributes, empty children for a container. */
export function newBlock(ctx: Pick<StructureContext, 'schemas' | 'createId'>, type: string, attrs: Attrs = {}, children?: readonly Block[]): Block {
  const schema = ctx.schemas.get(type)
  if (!schema) throw new TreeError(`No block type ${type}`)
  // An attribute passed as undefined (copied from a block type without it) keeps its default.
  const all: Record<string, unknown> = { ...defaultAttrs(schema) }
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined) all[k] = v
  const container = schema.children !== undefined && schema.children !== false
  return container ? { id: ctx.createId(), type, attrs: all, children: children ?? [] } : { id: ctx.createId(), type, attrs: all }
}

/** May a block of `type` live directly in `parent` (null: the root)? */
export function canHold(d: Draft, parent: ParentId, type: string): boolean {
  // A placeholder keeps content this editor cannot show; it may sit wherever it was put.
  if (type === UNSUPPORTED) return true
  const child = d.ctx.schemas.get(type)
  if (!child) return false
  if (parent === null) return child.parent === undefined
  const p = d.ctx.schemas.get(d.node(parent).type)
  if (!p || p.children === undefined || p.children === false) return false
  if (p.children.allowed && !p.children.allowed.includes(type)) return false
  return child.parent === undefined || child.parent.includes(p.name)
}

/** `value` made acceptable to an attribute: only its allowed formats, no stray object characters. */
export function fitValue(ctx: Pick<StructureContext, 'schemas' | 'formats'>, type: string, attr: string, value: RichTextValue): RichTextValue {
  const schema = ctx.schemas.get(type)
  const spec = schema ? attrSpecs(schema)[attr] : undefined
  const allowed = spec?.type === 'richtext' ? spec.formats : undefined
  const formats = allowed ? value.formats.filter((f) => allowed.includes(f.type)) : value.formats
  return dropOrphanObjects(normalize({ text: value.text, formats }, ctx.formats), ctx.formats)
}

/** Attributes of `node` that `def.carry` names and the type `to` also has. */
function carried(ctx: StructureContext, node: BlockNode, def: BlockEditing | undefined, to: string): Record<string, unknown> {
  const schema = ctx.schemas.get(to)
  const specs = schema ? attrSpecs(schema) : {}
  return Object.fromEntries((def?.carry ?? []).filter((k) => k in specs && k in node.attrs).map((k) => [k, node.attrs[k]]))
}

/** The attributes a changed block keeps: those both types have, except rich text (handled per field) and type-specific ones. */
function shared(ctx: StructureContext, node: BlockNode, to: string): Record<string, unknown> {
  const schema = ctx.schemas.get(to)
  if (!schema) return {}
  const specs = attrSpecs(schema)
  return Object.fromEntries(['anchor', 'textAlign', 'lang', 'dir', 'size', 'color'].filter((k) => k in specs && k in node.attrs).map((k) => [k, node.attrs[k]]))
}

/** Nothing to keep: every field empty and no children. Blocks without fields (a separator) are never empty. */
export function isEmptyBlock(d: Draft, id: string): boolean {
  const def = d.def(id)
  if (!def || def.fields.length === 0) return false
  if (d.kids(id).length > 0) return false
  const node = d.node(id)
  return def.fields.every((f) => fieldValue(node, f.attr).text === '')
}

/**
 * Put containers right after a child left them, walking up from `parent`:
 * those that go when empty go (a list without items), those that keep a child
 * get an empty line (a table cell), and those with a `tidy` rule apply it (columns).
 */
export function cleanup(d: Draft, parent: ParentId): void {
  let p = parent
  while (p !== null && d.has(p)) {
    const def = d.def(p)
    if (def?.keepsChild && d.kids(p).length === 0) {
      d.insert(p, 0, [newBlock(d.ctx, PARAGRAPH)])
      return
    }
    if (def?.tidy) for (const op of def.tidy(d.tree, p) ?? []) d.apply(op)
    if (!d.has(p)) return
    if (!def?.removeWhenEmpty || !isEmptyContainer(d, p)) return
    const up = d.parent(p)
    d.remove([p])
    p = up
  }
}

/** The nearest isolating block that is `id` or holds it (a table cell, a column): edits do not cross its edge. */
export function isolatingAround(d: Draft, id: ParentId): ParentId {
  for (let p = id; p !== null; p = d.parent(p)) if (d.def(p)?.isolating) return p
  return null
}

/** A fixed part of a structure (a table row or cell): block commands do not move, copy or remove it. */
export function isFixed(ctx: Pick<StructureContext, 'tree' | 'editing'>, id: string): boolean {
  const node = ctx.tree.nodes.get(id)
  return node !== undefined && ctx.editing.get(node.type)?.fixed === true
}

function isEmptyContainer(d: Draft, id: string): boolean {
  const node = d.node(id)
  return d.kids(id).length === 0 && (d.def(id)?.fields ?? []).every((f) => fieldValue(node, f.attr).text === '')
}

/** A part selected as a whole (a picture): its caption is never joined into. */
function isGroup(d: Draft, id: string): boolean {
  return d.def(id)?.group === true
}

/** Caret at the end (or start) of a stop; a stop without text selects its block. */
export function stopEdge(d: Draft, stop: Stop, edge: 'start' | 'end'): EditorSelection {
  if (stop.field === null) return blockSelection(stop.blockId)
  return caret(stop.blockId, stop.field, edge === 'start' ? 0 : d.value(stop.blockId, stop.field).text.length)
}

/** A copy with fresh ids everywhere and no anchors (ids in a page must stay unique). */
export function cloneBlock(ctx: Pick<StructureContext, 'createId'>, b: Block): Block {
  const attrs = 'anchor' in b.attrs ? { ...b.attrs, anchor: '' } : b.attrs
  const base = { id: ctx.createId(), type: b.type, attrs }
  return b.children ? { ...base, children: b.children.map((c) => cloneBlock(ctx, c)) } : base
}

// ---------------------------------------------------------------------------
// Placing blocks where the schema allows them

/**
 * `blocks` as they can live in `parent`: each one as it is, or its children
 * when only they fit (a pasted list's items going into a list). Null when some do not fit.
 */
function fitTo(d: Draft, parent: ParentId, blocks: readonly Block[]): Block[] | null {
  const out: Block[] = []
  for (const b of blocks) {
    if (canHold(d, parent, b.type)) out.push(b)
    else if (b.children && b.children.length > 0 && b.children.every((c) => canHold(d, parent, c.type))) for (const c of b.children) out.push(c)
    else return null
  }
  return out
}

/** A container like `id`, empty, for the second half when it is split. */
function emptyCopy(d: Draft, id: string): Block {
  const node = d.node(id)
  const def = d.def(id)
  // Fields after the children (a citation) go with the second half; the rest stays.
  const attrs: Record<string, unknown> = { ...node.attrs }
  if ('anchor' in attrs) attrs.anchor = ''
  for (const f of def?.fields ?? []) if (!f.after) attrs[f.attr] = { text: '', formats: [] }
  for (const f of def?.fields ?? []) if (f.after) d.set(id, { [f.attr]: { text: '', formats: [] } })
  return { id: d.ctx.createId(), type: node.type, attrs, children: [] }
}

/**
 * Insert `blocks` at `index` of `parent`, or as close as the schema allows:
 * where they cannot live (paragraphs inside a list), the container is split
 * at that point and the blocks go between its halves. Returns the inserted top-level ids.
 */
export function placeBlocks(d: Draft, parent: ParentId, index: number, blocks: readonly Block[]): string[] {
  let p = parent, i = index
  for (;;) {
    const fitted = fitTo(d, p, blocks)
    if (fitted) { d.insert(p, i, fitted); return fitted.map((b) => b.id) }
    if (p === null) {
      // Validated blocks always fit the root; anything else is not inserted.
      const ok = blocks.filter((b) => canHold(d, null, b.type))
      d.insert(null, i, ok)
      return ok.map((b) => b.id)
    }
    // A block that cannot go in a cell (or a column) goes after the table (or the columns), never splitting them.
    if (d.def(p)?.isolating) {
      let top = p
      for (let up = d.parent(top); up !== null && d.def(up)?.isolating; up = d.parent(top)) top = up
      p = d.parent(top)
      i = d.index(top) + 1
      continue
    }
    const kids = d.kids(p)
    const up = d.parent(p), at = d.index(p)
    // In a container with text before its children (a list item, a fold-out's title), index 0
    // is after that text: the blocks go after the container, and its children after them.
    const leading = (d.def(p)?.fields ?? []).some((f) => !f.after)
    if (i < kids.length && (i > 0 || leading)) {
      const copy = emptyCopy(d, p)
      d.insert(up, at + 1, [copy])
      d.move(kids.slice(i), copy.id, 0)
    }
    p = up
    i = i === 0 && !leading ? at : at + 1
  }
}

// ---------------------------------------------------------------------------
// Enter

/**
 * Enter in `field` of block `id`. `before` and `after` are the field's text on
 * either side of the caret, the selection already deleted. `marks` are the
 * inclusive formats to carry into a new block.
 */
export function splitBlock(ctx: StructureContext, id: string, field: string, before: RichTextValue, after: RichTextValue, marks: readonly Mark[] = []): Change | null {
  const d = new Draft(ctx)
  const node = d.node(id)
  const def = d.def(id)
  const spec = def?.fields.find((f) => f.attr === field)
  if (!def || !spec) return null

  if (spec.multiline) {
    // Two empty lines at the end and Enter again: leave the block, as in a word processor's code style.
    if (after.text === '' && before.text.endsWith('\n\n')) {
      d.set(id, { [field]: slice(before, 0, before.text.length - 2) })
      const p = newBlock(ctx, PARAGRAPH)
      placeBlocks(d, d.parent(id), d.index(id) + 1, [p])
      return d.done(caret(p.id, 'content', 0))
    }
    d.set(id, { [field]: concat([before, { text: '\n', formats: [] }, after], ctx.formats) })
    return d.done(caret(id, field, before.text.length + 1), { typed: '\n' })
  }

  const main = mainField(def)
  // Inside a caption Enter breaks the line: moving the rest out of a gallery would change the reading order.
  if (def.group && after.text !== '') {
    d.set(id, { [field]: concat([before, { text: '\n', formats: [] }, after], ctx.formats) })
    return d.done(caret(id, field, before.text.length + 1), { typed: '\n' })
  }
  if (spec !== main || def.group) {
    // A field after the children (a citation) or a caption: its rest starts a text after the block,
    // after the gallery a picture is in rather than splitting it.
    d.set(id, { [field]: before })
    const p = newBlock(ctx, PARAGRAPH, { content: fitValue(ctx, PARAGRAPH, 'content', after) })
    let at = id
    while (d.parent(at) !== null && !canHold(d, d.parent(at), PARAGRAPH)) at = d.parent(at)!
    placeBlocks(d, d.parent(at), d.index(at) + 1, [p])
    return d.done(caret(p.id, 'content', 0), { marks })
  }

  if (before.text === '' && after.text === '' && isEmptyBlock(d, id)) {
    const hooked = def.enterEmpty?.(ctx, id)
    if (hooked) return hooked
    // The empty last child of a quote: Enter leaves the quote.
    const parent = d.parent(id)
    if (parent !== null && d.def(parent)?.exitOnEmptyEnter && d.kids(parent).at(-1) === id && canHold(d, d.parent(parent), node.type)) {
      const up = d.parent(parent)
      d.move([id], up, d.index(parent) + 1)
      cleanup(d, parent)
      return d.done(caret(id, field, 0))
    }
  }

  // Enter in a summary: what follows the caret starts the content under it.
  if (def.enterInside && !(before.text === '' && after.text !== '') && canHold(d, id, PARAGRAPH)) {
    const p = newBlock(ctx, PARAGRAPH, { content: fitValue(ctx, PARAGRAPH, 'content', after) })
    d.set(id, { [field]: before })
    d.insert(id, 0, [p])
    return d.done(caret(p.id, 'content', 0), { marks })
  }

  const sameType = def.enterCreates === 'same'
  const createType = sameType ? node.type : def.enterCreates ?? PARAGRAPH
  const attrsFor = (type: string): Record<string, unknown> => (type === node.type ? carried(ctx, node, def, type) : {})

  // Enter at the start of text pushes it down: an empty block above, the caret stays.
  if (before.text === '' && after.text !== '') {
    const b = newBlock(ctx, createType, attrsFor(createType))
    const parent = d.parent(id)
    if (canHold(d, parent, createType)) d.insert(parent, d.index(id), [b])
    else placeBlocks(d, parent, d.index(id), [b])
    return d.done(caret(id, field, 0))
  }

  // At the end the next block is what the type asks for (text after a heading); in the middle the type stays.
  const type = after.text === '' ? createType : node.type
  const target = mainField(ctx.editing.get(type))?.attr ?? 'content'
  const nb = newBlock(ctx, type, { ...attrsFor(type), [target]: fitValue(ctx, type, target, after) })
  d.set(id, { [field]: before })
  const kids = d.kids(id)
  placeBlocks(d, d.parent(id), d.index(id) + 1, [nb])
  // What followed the caret, nested items included, now belongs to the new block.
  if (kids.length > 0 && type === node.type) d.move(kids, nb.id, 0)
  return d.done(caret(nb.id, target, 0), { marks })
}

// ---------------------------------------------------------------------------
// Backspace at the start, Delete at the end

/** Backspace at offset 0 of `field` in block `id`. */
export function mergeBackward(ctx: StructureContext, id: string, field: string): Change | null {
  const d = new Draft(ctx)
  const node = d.node(id)
  const def = d.def(id)
  const main = mainField(def)
  if (!def || !main) return null
  const here: Stop = { blockId: id, field }
  // A caption: Backspace at its start selects the picture, it never joins the caption to the text before.
  if (def.group) return { ops: [], selection: blockSelection(id) }
  if (field !== main.attr) {
    // In a citation: move to the text before it, never join (the citation is a separate thing).
    const prev = neighbourStop(ctx, here, -1)
    return prev ? { ops: [], selection: stopEdge(d, prev, 'end') } : null
  }
  const hooked = def.backspaceAtStart?.(ctx, id)
  if (hooked) return hooked

  const prev = neighbourStop(ctx, here, -1)
  if (prev && isolatingAround(d, id) !== isolatingAround(d, prev.blockId)) return null
  const parent = d.parent(id)
  // A container with its own text before its children (a details summary): the first child joins that text.
  const leading = parent !== null && (d.def(parent)?.fields ?? []).some((f) => !f.after)
  // First inside a container: step out of it (a paragraph leaves a quote).
  if (parent !== null && !leading && d.kids(parent)[0] === id && canHold(d, d.parent(parent), node.type)) {
    const up = d.parent(parent)
    d.move([id], up, d.index(parent))
    cleanup(d, parent)
    return d.done(caret(id, field, 0))
  }

  if (!prev) {
    // The very start of the document: a heading becomes text, as Backspace removes a style in a word processor.
    if (node.type !== PARAGRAPH && def.fields.length === 1 && d.kids(id).length === 0 && canHold(d, parent, PARAGRAPH)) {
      return retype(ctx, [id], PARAGRAPH)
    }
    return null
  }
  const empty = isEmptyBlock(d, id)
  if (prev.field === null || isGroup(d, prev.blockId)) {
    // A block without text before (a separator, a picture): select it, so the next Backspace removes it.
    if (empty) { d.remove([id]); cleanup(d, parent) }
    return d.done(blockSelection(prev.blockId))
  }
  if (empty) {
    d.remove([id])
    cleanup(d, parent)
    return d.done(caret(prev.blockId, prev.field, d.value(prev.blockId, prev.field).text.length))
  }
  return join(d, prev.blockId, prev.field, id, field, 'backward')
}

/** Delete at the end of `field` in block `id`. */
export function mergeForward(ctx: StructureContext, id: string, field: string): Change | null {
  const d = new Draft(ctx)
  const main = mainField(d.def(id))
  if (!main || field !== main.attr || d.def(id)?.group) return null
  const next = neighbourStop(ctx, { blockId: id, field }, 1)
  if (!next) return null
  if (isolatingAround(d, id) !== isolatingAround(d, next.blockId)) return null
  const parent = d.parent(id)
  const empty = isEmptyBlock(d, id)
  if (next.field === null || isGroup(d, next.blockId)) {
    if (empty) { d.remove([id]); cleanup(d, parent) }
    return d.done(blockSelection(next.blockId))
  }
  // The next stop is a citation: Delete does not pull it into the text.
  if (mainField(d.def(next.blockId))?.attr !== next.field) return null
  if (empty) {
    d.remove([id])
    cleanup(d, parent)
    return d.done(caret(next.blockId, next.field, 0))
  }
  return join(d, id, field, next.blockId, next.field, 'forward')
}

/**
 * Append the text of `src` to `target` and remove `src`. Its children go where
 * reading order keeps them: into the target (joining backward, as list items
 * do) or in the place of the source (joining forward).
 */
export function join(d: Draft, target: string, targetField: string, src: string, srcField: string, dir: 'backward' | 'forward'): Change | null {
  const s = d.node(src)
  const sdef = d.def(src)
  // Other text of the source would be lost: do nothing rather than lose it.
  if ((sdef?.fields ?? []).some((f) => f.attr !== srcField && fieldValue(s, f.attr).text !== '')) return null
  const t = d.node(target)
  const tv = fieldValue(t, targetField)
  const joined = concat([tv, fitValue(d.ctx, t.type, targetField, fieldValue(s, srcField))], d.ctx.formats)
  const kids = d.kids(src)
  const sParent = d.parent(src)
  d.set(target, { [targetField]: joined })
  if (kids.length > 0) {
    const into = (): boolean => {
      if (!kids.every((k) => canHold(d, target, d.node(k).type))) return false
      // A source nested in the target (text selected from an item into its sub-item): its
      // children go before what still holds the source, which is where reading order had them.
      const holder = d.kids(target).findIndex((k) => isSelfOrAncestor(d.tree, k, src))
      d.move(kids, target, holder >= 0 ? holder : d.kids(target).length)
      return true
    }
    const inPlace = (): boolean => {
      const at = d.index(src) + 1
      if (kids.every((k) => canHold(d, sParent, d.node(k).type))) { d.move(kids, sParent, at); return true }
      // Nested lists of a list item: their items fit where the item was.
      const grand = kids.flatMap((k) => [...d.kids(k)])
      if (grand.length > 0 && grand.every((g) => canHold(d, sParent, d.node(g).type))) {
        d.move(grand, sParent, at)
        d.remove(kids)
        return true
      }
      return false
    }
    const ok = dir === 'backward' ? into() || inPlace() : inPlace() || into()
    if (!ok) return null
  }
  d.remove([src])
  cleanup(d, sParent)
  return d.done(caret(target, targetField, tv.text.length))
}

/**
 * Join `src` into `target` as `join` does, on a copy of the draft: when the
 * join is not possible nothing is applied. True when it was.
 */
export function joinInto(d: Draft, target: string, targetField: string, src: string, srcField: string): boolean {
  if (!d.has(target) || !d.has(src) || target === src || isGroup(d, target) || isGroup(d, src)) return false
  if (mainField(d.def(target))?.attr !== targetField || mainField(d.def(src))?.attr !== srcField) return false
  if (isolatingAround(d, target) !== isolatingAround(d, src)) return false
  const trial = new Draft(d.now(null))
  if (!join(trial, target, targetField, src, srcField, 'backward')) return false
  for (const op of trial.ops) d.apply(op)
  return true
}

// ---------------------------------------------------------------------------
// Block commands

/** Remove blocks. The caret goes to the end of the text before them, or the start of the text after. */
export function removeBlocks(ctx: StructureContext, ids: readonly string[]): Change | null {
  const d = new Draft(ctx)
  const order = topmost(ctx.tree, ids)
  if (order.length === 0) return null
  // Rows and cells keep the table's grid: removing them empties them (the table's own commands remove rows).
  if (order.some((id) => isFixed(ctx, id))) {
    const empty = (id: string): void => {
      if (d.def(id)?.keepsChild) {
        const kids = d.kids(id)
        if (kids.length === 1 && isEmptyBlock(d, kids[0]!)) return
        d.remove(kids)
        d.insert(id, 0, [newBlock(ctx, PARAGRAPH)])
      } else for (const k of d.kids(id)) empty(k)
    }
    for (const id of order) if (isFixed(ctx, id)) empty(id)
    const rest = order.filter((id) => !isFixed(ctx, id))
    if (rest.length > 0) d.remove(rest)
    const first = stopsIn(d.now(null), order[0]!)[0]
    return d.done(first ? stopEdge(d, first, 'start') : ctx.selection, { announce: ctx.strings.table.cleared(order.length) })
  }
  const gone = (s: Stop): boolean => order.some((id) => isSelfOrAncestor(ctx.tree, id, s.blockId))
  const all = stops({ ...ctx, current: null })
  const firstAt = all.findIndex(gone)
  let lastAt = -1
  all.forEach((s, i) => { if (gone(s)) lastAt = i })
  const prev = firstAt > 0 ? all[firstAt - 1] : undefined
  const next = lastAt >= 0 ? all[lastAt + 1] : undefined
  const parents = order.map((id) => d.parent(id))
  d.remove(order)
  for (const p of parents) cleanup(d, p)
  const target = prev && d.has(prev.blockId) ? stopEdge(d, prev, 'end') : next && d.has(next.blockId) ? stopEdge(d, next, 'start') : null
  return d.done(target ?? { kind: 'none' }, { announce: ctx.strings.removed(order.length) })
}

/** Move sibling blocks one place up (-1) or down (1) inside their parent. */
export function moveBlocks(ctx: StructureContext, ids: readonly string[], dir: -1 | 1, selection: EditorSelection): Change | null {
  const d = new Draft(ctx)
  const order = topmost(ctx.tree, ids)
  if (order.some((id) => isFixed(ctx, id))) return null
  const first = order[0], last = order.at(-1)
  if (first === undefined || last === undefined) return null
  const parent = d.parent(first)
  const kids = d.kids(parent)
  const i = kids.indexOf(first), j = kids.indexOf(last)
  if (order.some((id) => d.parent(id) !== parent) || j - i + 1 !== order.length) return null
  if (dir < 0 ? i === 0 : j === kids.length - 1) return null
  const index = dir < 0 ? i - 1 : i + 1
  d.move(order, parent, index)
  return d.done(selection, { announce: ctx.strings.moved(index + 1, kids.length) })
}

/** Copies of sibling blocks right after them. A caret in one block lands at the same place in its copy. */
export function duplicateBlocks(ctx: StructureContext, ids: readonly string[], selection: EditorSelection): Change | null {
  const d = new Draft(ctx)
  const order = topmost(ctx.tree, ids)
  if (order.some((id) => isFixed(ctx, id))) return null
  const last = order.at(-1)
  if (last === undefined) return null
  const copies = order.map((id) => cloneBlock(ctx, d.block(id)))
  d.insert(d.parent(last), d.index(last) + 1, copies)
  const sel: EditorSelection = selection.kind === 'text' && order.length === 1
    ? { ...selection, blockId: copies[0]!.id }
    : blockSelection(copies[0]!.id, copies.at(-1)!.id)
  return d.done(sel, { announce: ctx.strings.duplicated(order.length) })
}

/**
 * Change text blocks to another text type (text to heading), keeping their id,
 * text and the shared attributes. Blocks the change does not suit are left alone.
 */
export function retype(ctx: StructureContext, ids: readonly string[], type: string, attrs: Attrs = {}, selection?: EditorSelection): Change | null {
  const d = new Draft(ctx)
  const to = ctx.editing.get(type)
  const toMain = mainField(to)
  if (!toMain) return null
  let changed = 0
  for (const id of topmost(ctx.tree, ids)) {
    const node = d.node(id)
    const main = mainField(d.def(id))
    if (!main || d.kids(id).length > 0 || !canHold(d, d.parent(id), type)) continue
    if (node.type === type && Object.entries(attrs).every(([k, v]) => node.attrs[k] === v)) continue
    const content = fitValue(ctx, type, toMain.attr, fieldValue(node, main.attr))
    const block: Block = newBlock(ctx, type, { ...shared(ctx, node, type), ...attrs, [toMain.attr]: content })
    d.apply({ type: 'replaceBlocks', ids: [id], blocks: [{ ...block, id }] })
    changed++
  }
  if (changed === 0) return null
  const name = to ? to.title(d.node(topmost(d.tree, ids)[0]!), ctx.strings) : type
  const sel = selection ?? (ids.length === 1 ? caret(ids[0]!, toMain.attr, 0) : blockSelection(ids[0]!, ids.at(-1)))
  return d.done(adjustSelection(sel, toMain.attr), { announce: ctx.strings.changedTo(name) })
}

/** A text selection keeps its offsets when the field it was in is renamed by a change of type. */
function adjustSelection(sel: EditorSelection, field: string): EditorSelection {
  return sel.kind === 'text' ? { ...sel, field } : sel
}

/** Insert a block after `id` (Enter or typing on a separator). The caret goes into it. */
export function insertAfter(ctx: StructureContext, id: string, block: Block): Change {
  const d = new Draft(ctx)
  const [placed] = placeBlocks(d, d.parent(id), d.index(id) + 1, [block])
  const first = placed ? stopsIn(d.now(null), placed)[0] : undefined
  return d.done(first ? stopEdge(d, first, 'end') : blockSelection(block.id))
}

// ---------------------------------------------------------------------------
// Paste

/** Rich text into the selection of one field (a single copied text block pastes inline). */
export function pasteInline(ctx: StructureContext, sel: Extract<EditorSelection, { kind: 'text' }>, value: RichTextValue): Change {
  const d = new Draft(ctx)
  const node = d.node(sel.blockId)
  const v = fieldValue(node, sel.field)
  const a = Math.min(sel.anchor, sel.focus), b = Math.max(sel.anchor, sel.focus)
  const insert = fitValue(ctx, node.type, sel.field, value)
  d.set(sel.blockId, { [sel.field]: replaceText(v, a, b, insert, ctx.formats) })
  const at = a + insert.text.length
  return d.done(caret(sel.blockId, sel.field, at), { announce: ctx.strings.pasted(1) })
}

/**
 * Paste blocks at the selection. A caret splits its block (or replaces it when
 * empty); selected blocks are replaced. The caret goes to the end of the last pasted block.
 */
export function pasteBlocks(ctx: StructureContext, sel: EditorSelection, pasted: readonly Block[], open = false): Change | null {
  if (pasted.length === 0) return null
  const d = new Draft(ctx)
  let placed: string[]
  // With an open slice (text copied across parts), the text before the caret and the first pasted
  // part join, and so do the last pasted part and the text after the caret, as in a word processor.
  let joinFirst: { id: string; field: string } | null = null
  let joinLast: string | null = null
  if (sel.kind === 'text' && d.has(sel.blockId)) {
    const id = sel.blockId
    const node = d.node(id)
    const def = d.def(id)
    const main = mainField(def)
    const a = Math.min(sel.anchor, sel.focus), b = Math.max(sel.anchor, sel.focus)
    const value = deleteRange(fieldValue(node, sel.field), a, b, ctx.formats)
    const parent = d.parent(id), index = d.index(id)
    if (!main || sel.field !== main.attr) {
      d.set(id, { [sel.field]: value })
      placed = placeBlocks(d, parent, index + 1, pasted)
    } else if (value.text === '' && isEmptyBlock(d, id)) {
      placed = placeBlocks(d, parent, index, pasted)
      // Placing may have split the container: look the block's parent up again.
      const holder = d.parent(id)
      d.remove([id])
      if (holder !== null) cleanup(d, holder)
    } else if (a === value.text.length && d.kids(id).length === 0) {
      d.set(id, { [sel.field]: value })
      placed = placeBlocks(d, parent, index + 1, pasted)
      joinFirst = { id, field: sel.field }
    } else if (a === 0) {
      d.set(id, { [sel.field]: value })
      placed = placeBlocks(d, parent, index, pasted)
      joinLast = id
    } else {
      const [before, after] = splitText(value, a)
      const rest = newBlock(ctx, node.type, { ...node.attrs, ...('anchor' in node.attrs ? { anchor: '' } : {}), [sel.field]: after })
      d.set(id, { [sel.field]: before })
      const kids = d.kids(id)
      d.insert(parent, index + 1, [rest])
      d.move(kids, rest.id, 0)
      placed = placeBlocks(d, parent, index + 1, pasted)
      joinFirst = { id, field: sel.field }
      joinLast = rest.id
    }
  } else if (sel.kind === 'blocks') {
    const ids = selectedBlocks(ctx.tree, sel)
    const first = ids[0]
    if (first === undefined) return null
    const parent = d.parent(first), index = d.index(first)
    d.remove(ids)
    placed = placeBlocks(d, parent, index, pasted)
    if (parent !== null) cleanup(d, parent)
  } else {
    placed = placeBlocks(d, null, d.kids(null).length, pasted)
  }
  let last = placed.at(-1)
  let joined: EditorSelection | null = null
  if (open && last !== undefined) {
    // The first pasted text (an item inside a pasted list) joins the text before the caret,
    // and the text after the caret joins the last pasted text, however deep each is.
    const firstText = d.has(placed[0]!) ? stopsIn(d.now(null), placed[0]!).find((st) => st.field !== null) : undefined
    if (joinFirst && firstText?.field) joinInto(d, joinFirst.id, joinFirst.field, firstText.blockId, firstText.field)
    if (!d.has(last)) last = joinFirst?.id ?? last
    const lastText = d.has(last) ? stopsIn(d.now(null), last).filter((st) => st.field !== null).at(-1) : undefined
    const restMain = joinLast !== null && d.has(joinLast) ? mainField(d.def(joinLast)) : undefined
    if (lastText?.field && restMain) {
      const at = d.value(lastText.blockId, lastText.field).text.length
      if (joinInto(d, lastText.blockId, lastText.field, joinLast!, restMain.attr)) joined = caret(lastText.blockId, lastText.field, at)
    }
  }
  const end = last && d.has(last) ? stopsIn(d.now(null), last).at(-1) : undefined
  const selection = joined ?? (end ? stopEdge(d, end, 'end') : placed[0] ? blockSelection(placed[0], last) : { kind: 'none' as const })
  return d.done(selection, { announce: ctx.strings.pasted(placed.length) })
}

// ---------------------------------------------------------------------------
// Inserter and moving anywhere

/** Where the inserter puts new blocks: after a block, in place of one (an empty paragraph, the `/` text), or at the end. */
export type InsertAt = { readonly after: string } | { readonly replace: string } | 'end'

/**
 * New blocks from the inserter or a pattern, placed where the schema allows.
 * The caret goes to the start of the first inserted text.
 */
export function insertBlocks(ctx: StructureContext, at: InsertAt, blocks: readonly Block[], announce?: string): Change | null {
  if (blocks.length === 0) return null
  const d = new Draft(ctx)
  let placed: string[]
  if (at === 'end') {
    placed = placeBlocks(d, null, d.kids(null).length, blocks)
  } else if ('replace' in at) {
    if (!d.has(at.replace)) return null
    placed = placeBlocks(d, d.parent(at.replace), d.index(at.replace), blocks)
    // Placing may have split the container: look the block up again.
    const parent = d.parent(at.replace)
    d.remove([at.replace])
    cleanup(d, parent)
  } else {
    if (!d.has(at.after)) return null
    placed = placeBlocks(d, d.parent(at.after), d.index(at.after) + 1, blocks)
  }
  const first = placed[0]
  if (first === undefined || !d.has(first)) return null
  const stop = stopsIn(d.now(null), first)[0]
  return d.done(stop ? stopEdge(d, stop, 'start') : blockSelection(first), announce ? { announce } : {})
}

/**
 * Move sibling blocks into `parent`, before `before` (or to its end). The
 * list view's Move to and dragging a part use it. Null when the schema does
 * not allow them there, or when `parent` is inside them.
 */
export function moveBlocksTo(ctx: StructureContext, ids: readonly string[], parent: ParentId, before: string | null, selection: EditorSelection): Change | null {
  const d = new Draft(ctx)
  const order = topmost(ctx.tree, ids)
  const first = order[0]
  if (first === undefined || order.some((id) => isFixed(ctx, id))) return null
  const from = d.parent(first)
  if (order.some((id) => d.parent(id) !== from)) return null
  if (parent !== null && (!d.has(parent) || order.some((id) => isSelfOrAncestor(ctx.tree, id, parent)))) return null
  if (before !== null && (order.includes(before) || d.parent(before) !== parent)) return null
  if (!order.every((id) => canHold(d, parent, d.node(id).type))) return null
  const rest = d.kids(parent).filter((id) => !order.includes(id))
  const index = before === null ? rest.length : rest.indexOf(before)
  // Already there (together, at that place): nothing to do.
  const now = d.kids(parent)
  if (from === parent && now.indexOf(first) === index && now.slice(index, index + order.length).join() === order.join()) return null
  d.move(order, parent, index)
  cleanup(d, from)
  return d.done(selection, { announce: ctx.strings.moved(index + 1, d.kids(parent).length) })
}
