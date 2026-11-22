/**
 * Editing behaviour of the layout blocks: columns and
 * their columns, group, fold-out (details), buttons and space. Fields, edges,
 * inserter entries and the edits their options make. No Vue here: the canvas
 * components are in `layout-edit.ts`.
 */
import type { BlockEditing, Change, InserterItem, StructureContext } from '../editor/editing'
import { fieldValue, stopsIn } from '../editor/editing'
import { caret } from '../editor/selection'
import { Draft, canHold, cleanup, newBlock, stopEdge } from '../editor/structure'
import type { Operation } from '../model/operations'
import { type Block, type BlockNode, type Tree, getBlock } from '../model/tree'
import { BUTTON, BUTTONS, COLUMN, COLUMNS, DETAILS, GROUP, type Ratio, SPACER, ratioFor, ratioParts } from './layout'

const PARAGRAPH = 'core/paragraph'

const name = (type: string) => (_node: BlockNode, s: { blockNames: Readonly<Record<string, string>> }): string => s.blockNames[type] ?? type

const item = (type: string, drawing: InserterItem['drawing'], keywords: readonly string[], create: InserterItem['create']): InserterItem => ({
  id: type, category: 'layout', drawing, create, keywords: [type.replace('core/', ''), ...keywords],
  title: (s) => s.blockNames[type] ?? type,
})

const column = (ctx: Pick<StructureContext, 'schemas' | 'createId'>, children?: readonly Block[]): Block =>
  newBlock(ctx, COLUMN, {}, children ?? [newBlock(ctx, PARAGRAPH)])

// ---------------------------------------------------------------------------
// Columns

/**
 * Columns follow their count: one left is unwrapped into its parts, none
 * leaves nothing, and a ratio for another count becomes the equal one.
 */
function tidyColumns(tree: Tree, id: string): readonly Operation[] | null {
  const kids = tree.children.get(id) ?? []
  if (kids.length === 0) return [{ type: 'removeBlocks', ids: [id] }]
  if (kids.length === 1) return [{ type: 'replaceBlocks', ids: [id], blocks: getBlock(tree, kids[0]!).children ?? [] }]
  const r = tree.nodes.get(id)?.attrs.ratio
  const ratio = typeof r === 'string' ? r : ''
  return ratioParts(ratio).length === kids.length ? null : [{ type: 'setAttrs', id, patch: { ratio: ratioFor(kids.length) } }]
}

/**
 * A new ratio: missing columns are added, and the parts of columns no longer
 * needed move into the last one kept, so nothing is lost.
 */
export function setRatio(ctx: StructureContext, id: string, ratio: Ratio): Change | null {
  const d = new Draft(ctx)
  if (!d.has(id) || d.node(id).attrs.ratio === ratio) return null
  const want = ratioParts(ratio).length
  const kids = d.kids(id)
  if (kids.length < want) d.insert(id, kids.length, Array.from({ length: want - kids.length }, () => column(ctx)))
  else if (kids.length > want) {
    const keep = kids[want - 1]!
    const extra = kids.slice(want)
    const moved = extra.flatMap((c) => d.kids(c).filter((k) => !(d.node(k).type === PARAGRAPH && fieldValue(d.node(k), 'content').text === '')))
    d.move(moved, keep, d.kids(keep).length)
    d.remove(extra)
  }
  d.set(id, { ratio })
  return d.done(ctx.selection, { announce: ctx.strings.changedTo(ctx.strings.blockNames[COLUMNS] ?? COLUMNS) })
}

export const columnsEditing: BlockEditing = {
  name: COLUMNS,
  fields: [],
  isolating: true,
  frame: true,
  title: name(COLUMNS),
  tidy: tidyColumns,
  inserter: [item(COLUMNS, { ink: ['M6 4h40v40H6zM50 4h40v40H50z'], accent: ['M12 12h28M12 19h22M56 12h28M56 19h18'] }, ['columns', 'layout', 'side by side', 'grid'],
    (ctx) => [newBlock(ctx, COLUMNS, { ratio: '1-1' }, [column(ctx), column(ctx)])])],
}

export const columnEditing: BlockEditing = {
  name: COLUMN,
  fields: [],
  isolating: true,
  keepsChild: true,
  frame: true,
  title: name(COLUMN),
}

// ---------------------------------------------------------------------------
// Group

/** The group's parts take its place; the group goes. */
export function ungroup(ctx: StructureContext, id: string): Change | null {
  const d = new Draft(ctx)
  if (!d.has(id)) return null
  const parent = d.parent(id)
  const kids = d.kids(id)
  if (!kids.every((k) => canHold(d, parent, d.node(k).type))) return null
  const first = kids[0]
  d.move(kids, parent, d.index(id))
  d.remove([id])
  cleanup(d, parent)
  const stop = first === undefined ? undefined : stopsIn(d.now(null), first)[0]
  return d.done(stop ? stopEdge(d, stop, 'start') : ctx.selection, { announce: ctx.strings.ungrouped })
}

export const groupEditing: BlockEditing = {
  name: GROUP,
  fields: [],
  keepsChild: true,
  frame: true,
  title: name(GROUP),
  inserter: [item(GROUP, { ink: ['M6 4h84v40H6z'], accent: ['M14 13h50M14 21h60M14 29h40'] }, ['group', 'section', 'box', 'panel', 'container', 'aside'],
    (ctx) => [newBlock(ctx, GROUP, { look: 'panel' }, [newBlock(ctx, PARAGRAPH)])])],
}

// ---------------------------------------------------------------------------
// Fold-out (details)

export const detailsEditing: BlockEditing = {
  name: DETAILS,
  fields: [{ attr: 'summary', inputRules: false }],
  keepsChild: true,
  enterInside: true,
  frame: true,
  title: name(DETAILS),
  fieldLabel: (_n, attr, s) => s.fieldNames[attr] ?? attr,
  inserter: [item(DETAILS, { ink: ['M6 6h84M6 42h84', 'M20 24h50'], accent: ['m8 20 4 4 4-4'] }, ['details', 'accordion', 'fold', 'collapse', 'expand', 'faq', 'summary', 'toggle'],
    (ctx) => [newBlock(ctx, DETAILS, {}, [newBlock(ctx, PARAGRAPH)])])],
}

// ---------------------------------------------------------------------------
// Buttons

/** Enter in an empty button: it goes, and a text starts after the buttons. */
function leaveButtons(ctx: StructureContext, id: string): Change | null {
  const d = new Draft(ctx)
  const row = d.parent(id)
  if (row === null) return null
  const p = newBlock(ctx, PARAGRAPH)
  d.insert(d.parent(row), d.index(row) + 1, [p])
  if (d.kids(row).length > 1) d.remove([id])
  else d.remove([row])
  return d.done(caret(p.id, 'content', 0))
}

/** Backspace at a button's start: an empty one goes; otherwise the caret moves to the text before, never joining two buttons. */
function backFromButton(ctx: StructureContext, id: string): Change | null {
  const d = new Draft(ctx)
  const row = d.parent(id)
  if (row === null) return null
  const all = stopsIn({ ...ctx, current: null }, row)
  const i = all.findIndex((s) => s.blockId === id)
  const empty = fieldValue(d.node(id), 'text').text === ''
  const before = i > 0 ? all[i - 1] : undefined
  if (empty) {
    d.remove([d.kids(row).length > 1 ? id : row])
    return d.done(before && d.has(before.blockId) ? stopEdge(d, before, 'end') : ctx.selection)
  }
  return before ? { ops: [], selection: stopEdge(d, before, 'end') } : null
}

export const buttonsEditing: BlockEditing = {
  name: BUTTONS,
  fields: [],
  frame: true,
  removeWhenEmpty: true,
  title: name(BUTTONS),
  inserter: [item(BUTTONS, { ink: ['M36 16h44a6 6 0 0 1 0 12H36a6 6 0 0 1 0-12'], accent: ['M10 16h20a6 6 0 0 1 0 12H10a6 6 0 0 1 0-12'] }, ['button', 'buttons', 'call to action', 'cta', 'link'],
    (ctx) => [newBlock(ctx, BUTTONS, {}, [newBlock(ctx, BUTTON)])])],
}

export const buttonEditing: BlockEditing = {
  name: BUTTON,
  fields: [{ attr: 'text', inputRules: false }],
  enterCreates: 'same',
  carry: ['look'],
  title: name(BUTTON),
  enterEmpty: leaveButtons,
  backspaceAtStart: backFromButton,
}

// ---------------------------------------------------------------------------
// Space

export const spacerEditing: BlockEditing = {
  name: SPACER,
  fields: [],
  title: name(SPACER),
  inserter: [item(SPACER, { ink: ['M6 6h84M6 42h84'], accent: ['M48 14v20M42 18l6-6 6 6M42 30l6 6 6-6'] }, ['spacer', 'space', 'gap', 'blank', 'empty'],
    (ctx) => [newBlock(ctx, SPACER)])],
}
