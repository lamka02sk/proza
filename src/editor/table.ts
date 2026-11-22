/**
 * Table edits: rows, columns,
 * merging and splitting, header row and column, clearing and filling cells.
 * Pure like the other structural edits: each reads a tree and returns the
 * operations and the selection after.
 *
 * Every edit first squares the table up (a short row gets the cells it lacks),
 * so the grid it works on is a rectangle. Spans are honoured: a row or column
 * added inside a merged cell widens it, and removing the row or column a merged
 * cell starts in moves the cell along instead of losing its content.
 */
import { type Grid, type GridCell, type Rect, buildGrid, cellRect, cellsIn, closeRect, unionRect } from '../model/grid'
import type { Block, Tree } from '../model/tree'
import { childrenOf, getBlock, parentOf } from '../model/tree'
import { type Change, type StructureContext, fieldValue, stopsIn } from './editing'
import { type EditorSelection, caret, cells as cellSelection } from './selection'
import { Draft, newBlock, stopEdge } from './structure'

export const TABLE = 'core/table'
export const ROW = 'core/table-row'
export const CELL = 'core/table-cell'
const PARAGRAPH = 'core/paragraph'

const num = (v: unknown): number => (typeof v === 'number' && v > 0 ? v : 1)

/** The grid of a table in the tree: which cell id covers each slot. */
export function tableGrid(tree: Tree, tableId: string): Grid<string> {
  const is = (id: string, type: string): boolean => tree.nodes.get(id)?.type === type
  const rows = (tree.children.get(tableId) ?? []).filter((r) => is(r, ROW)).map((r) => (tree.children.get(r) ?? []).filter((c) => is(c, CELL)))
  return buildGrid(rows, (id) => {
    const a = tree.nodes.get(id)?.attrs ?? {}
    return { colspan: num(a.colspan), rowspan: num(a.rowspan) }
  })
}

/** The nearest block of `type` that is `id` or holds it. */
export function enclosing(tree: Tree, id: string | null, type: string): string | null {
  for (let p = id; p !== null && tree.nodes.has(p); p = parentOf(tree, p)) if (tree.nodes.get(p)!.type === type) return p
  return null
}

export function cellIn(grid: Grid<string>, id: string): GridCell<string> | undefined {
  return grid.cells.find((c) => c.item === id)
}

/** The rectangle a cell selection covers, grown over merged cells. */
export function selectionRect(tree: Tree, sel: Extract<EditorSelection, { kind: 'cells' }>): { grid: Grid<string>; rect: Rect } | null {
  if (!tree.nodes.has(sel.tableId)) return null
  const grid = tableGrid(tree, sel.tableId)
  const a = cellIn(grid, sel.anchorId), f = cellIn(grid, sel.focusId)
  if (!a || !f) return null
  return { grid, rect: closeRect(grid, unionRect(cellRect(a), cellRect(f))) }
}

/** The selected cell ids in reading order. Empty unless the selection is a cell selection. */
export function selectedCells(tree: Tree, sel: EditorSelection): string[] {
  if (sel.kind !== 'cells') return []
  const r = selectionRect(tree, sel)
  return r ? cellsIn(r.grid, r.rect).map((c) => c.item) : []
}

/** Whether the first row is all header cells. */
export function hasHeaderRow(tree: Tree, tableId: string): boolean {
  const first = tree.children.get(tableId)?.[0]
  const kids = first === undefined ? [] : tree.children.get(first) ?? []
  return kids.length > 0 && kids.every((c) => tree.nodes.get(c)?.attrs.header === true)
}

/** Whether the first column, below a header row, is all header cells. */
export function hasHeaderColumn(tree: Tree, tableId: string): boolean {
  const grid = tableGrid(tree, tableId)
  const from = hasHeaderRow(tree, tableId) ? 1 : 0
  const firsts = grid.cells.filter((c) => c.col === 0 && c.row >= from)
  return firsts.length > 0 && firsts.every((c) => tree.nodes.get(c.item)?.attrs.header === true)
}

/** Whether any cell spans more than one slot (stacking is offered only without). */
export function hasMerged(tree: Tree, tableId: string): boolean {
  return tableGrid(tree, tableId).cells.some((c) => c.colspan > 1 || c.rowspan > 1)
}

// ---------------------------------------------------------------------------
// Building blocks

function emptyCell(ctx: Pick<StructureContext, 'schemas' | 'createId'>, like?: Readonly<Record<string, unknown>>): Block {
  const header = like?.header === true
  return newBlock(ctx, CELL, { header, scope: header ? like.scope ?? '' : '', textAlign: like?.textAlign }, [newBlock(ctx, PARAGRAPH)])
}

/** A new table: a header row (ATAG B.2: tables start with a header row) and body rows. */
export function newTable(ctx: Pick<StructureContext, 'schemas' | 'createId'>, rows = 3, cols = 3): Block {
  const row = (header: boolean): Block => newBlock(ctx, ROW, {}, Array.from({ length: cols }, () => emptyCell(ctx, header ? { header: true, scope: 'col' } : undefined)))
  return newBlock(ctx, TABLE, {}, Array.from({ length: rows }, (_, i) => row(i === 0)))
}

/** Index in a row's cell list where a cell starting at column `col` goes. */
function indexInRow(grid: Grid<string>, row: number, col: number): number {
  return grid.cells.filter((c) => c.row === row && c.col < col).length
}

/** Short rows get the cells they lack, so the grid is a rectangle. */
function squareUp(d: Draft, tableId: string): void {
  const grid = tableGrid(d.tree, tableId)
  const rows = d.kids(tableId)
  grid.slots.forEach((slots, r) => {
    const missing = slots.filter((s) => s === -1).length
    if (missing === 0) return
    const like = r === 0 && hasHeaderRow(d.tree, tableId) ? { header: true, scope: 'col' } : undefined
    const row = rows[r]!
    d.insert(row, d.kids(row).length, Array.from({ length: missing }, () => emptyCell(d.ctx, like)))
  })
}

/** Rows left without a cell of their own (every slot covered from above) go; the spans over them shrink. */
function dropEmptyRows(d: Draft, tableId: string): void {
  for (;;) {
    const rows = d.kids(tableId)
    const r = rows.findIndex((row) => d.kids(row).length === 0)
    if (r < 0) return
    const grid = tableGrid(d.tree, tableId)
    const crossing = new Set(grid.slots[r]!.filter((i) => i >= 0).map((i) => grid.cells[i]!))
    for (const c of crossing) if (c.rowspan > 1) d.set(c.item, { rowspan: c.rowspan - 1 })
    d.remove([rows[r]!])
  }
}

/** Caret at the start of a cell's first text. */
function inCell(d: Draft, cellId: string): EditorSelection {
  const stop = stopsIn(d.now(null), cellId)[0]
  return stop ? stopEdge(d, stop, 'start') : caret(cellId, 'content', 0)
}

/** The cell now at a slot, after edits. */
function cellAtSlot(d: Draft, tableId: string, row: number, col: number): string | null {
  const grid = tableGrid(d.tree, tableId)
  const r = Math.max(0, Math.min(row, grid.rows - 1)), c = Math.max(0, Math.min(col, grid.cols - 1))
  const i = grid.slots[r]?.[c] ?? -1
  return i >= 0 ? grid.cells[i]!.item : null
}

// ---------------------------------------------------------------------------
// Rows and columns

/** A row at `at` (0 puts it first). New cells look like the row they push down, or the last one. */
export function insertRow(ctx: StructureContext, tableId: string, at: number, focusCol = 0): Change | null {
  const d = new Draft(ctx)
  if (!d.has(tableId)) return null
  squareUp(d, tableId)
  const grid = tableGrid(d.tree, tableId)
  const index = Math.max(0, Math.min(at, grid.rows))
  const likeRow = index < grid.rows ? index : grid.rows - 1
  const widened = new Set<string>()
  const added: Block[] = []
  for (let c = 0; c < grid.cols;) {
    const over = index > 0 && index < grid.rows ? grid.cells[grid.slots[index]![c]!] : undefined
    if (over && over.row < index) {
      // A merged cell runs across the new row: it grows to cover it.
      if (!widened.has(over.item)) { widened.add(over.item); d.set(over.item, { rowspan: over.rowspan + 1 }) }
      c = over.col + over.colspan
      continue
    }
    const like = likeRow >= 0 ? grid.cells[grid.slots[likeRow]![c]!] : undefined
    added.push(emptyCell(ctx, like ? d.node(like.item).attrs : undefined))
    c++
  }
  const row = newBlock(ctx, ROW, {}, added)
  d.insert(tableId, index, [row])
  const target = cellAtSlot(d, tableId, index, focusCol) ?? added[0]?.id
  return d.done(target ? inCell(d, target) : ctx.selection, { announce: ctx.strings.table.rowAdded })
}

/** Remove the row at `r`. A merged cell that starts there moves down to the next row. */
export function removeRow(ctx: StructureContext, tableId: string, r: number, focusCol = 0): Change | null {
  const d = new Draft(ctx)
  if (!d.has(tableId)) return null
  squareUp(d, tableId)
  const grid = tableGrid(d.tree, tableId)
  if (grid.rows <= 1 || r < 0 || r >= grid.rows) return null
  const rows = d.kids(tableId)
  const covering = [...new Set(grid.slots[r]!.filter((i) => i >= 0))].map((i) => grid.cells[i]!)
  const moving: GridCell<string>[] = []
  for (const c of covering) {
    if (c.row < r) d.set(c.item, { rowspan: c.rowspan - 1 })
    else if (c.rowspan > 1) moving.push(c)
  }
  // Starting cells that span down continue in the next row, in column order.
  moving.sort((a, b) => a.col - b.col).forEach((c, k) => {
    d.set(c.item, { rowspan: c.rowspan - 1 })
    d.move([c.item], rows[r + 1]!, indexInRow(grid, r + 1, c.col) + k)
  })
  d.remove([rows[r]!])
  const target = cellAtSlot(d, tableId, Math.min(r, grid.rows - 2), focusCol)
  return d.done(target ? inCell(d, target) : ctx.selection, { announce: ctx.strings.table.rowRemoved })
}

/** A column at `at` (0 puts it first). New cells look like the column they push along, or the last one. */
export function insertColumn(ctx: StructureContext, tableId: string, at: number, focusRow = 0): Change | null {
  const d = new Draft(ctx)
  if (!d.has(tableId)) return null
  squareUp(d, tableId)
  const grid = tableGrid(d.tree, tableId)
  const index = Math.max(0, Math.min(at, grid.cols))
  const likeCol = index < grid.cols ? index : grid.cols - 1
  const rows = d.kids(tableId)
  const widened = new Set<string>()
  // Inserting changes later indexes of the same row only; rows are independent.
  for (let r = 0; r < grid.rows; r++) {
    const over = index > 0 && index < grid.cols ? grid.cells[grid.slots[r]![index]!] : undefined
    if (over && over.col < index) {
      if (!widened.has(over.item)) { widened.add(over.item); d.set(over.item, { colspan: over.colspan + 1 }) }
      continue
    }
    const like = likeCol >= 0 ? grid.cells[grid.slots[r]![likeCol]!] : undefined
    d.insert(rows[r]!, indexInRow(grid, r, index), [emptyCell(ctx, like ? d.node(like.item).attrs : undefined)])
  }
  const target = cellAtSlot(d, tableId, focusRow, index)
  return d.done(target ? inCell(d, target) : ctx.selection, { announce: ctx.strings.table.columnAdded })
}

/** Remove the column at `c`. A merged cell across it gets narrower. */
export function removeColumn(ctx: StructureContext, tableId: string, c: number, focusRow = 0): Change | null {
  const d = new Draft(ctx)
  if (!d.has(tableId)) return null
  squareUp(d, tableId)
  const grid = tableGrid(d.tree, tableId)
  if (grid.cols <= 1 || c < 0 || c >= grid.cols) return null
  const covering = [...new Set(grid.slots.map((s) => s[c]!).filter((i) => i >= 0))].map((i) => grid.cells[i]!)
  const gone: string[] = []
  for (const cell of covering) {
    if (cell.colspan > 1) d.set(cell.item, { colspan: cell.colspan - 1 })
    else gone.push(cell.item)
  }
  d.remove(gone)
  dropEmptyRows(d, tableId)
  const target = cellAtSlot(d, tableId, focusRow, Math.min(c, grid.cols - 2))
  return d.done(target ? inCell(d, target) : ctx.selection, { announce: ctx.strings.table.columnRemoved })
}

// ---------------------------------------------------------------------------
// Merging and splitting

const isEmptyParagraph = (b: Block): boolean => b.type === PARAGRAPH && fieldValue(b, 'content').text === '' && !b.children?.length

/** Merge the cells of a rectangle into its first cell; their content follows in reading order. */
export function mergeCells(ctx: StructureContext, tableId: string, rect: Rect): Change | null {
  const d = new Draft(ctx)
  if (!d.has(tableId)) return null
  squareUp(d, tableId)
  const grid = tableGrid(d.tree, tableId)
  const closed = closeRect(grid, rect)
  const inside = cellsIn(grid, closed)
  const first = inside[0]
  if (!first || inside.length < 2) return null
  const others = inside.slice(1)
  const moved = others.flatMap((c) => d.kids(c.item).filter((k) => !isEmptyParagraph(d.block(k))))
  if (moved.length > 0) {
    // The first cell's empty line gives way to what comes in.
    const own = d.kids(first.item)
    if (own.every((k) => isEmptyParagraph(d.block(k)))) {
      d.move(moved, first.item, own.length)
      d.remove(own)
    } else d.move(moved, first.item, own.length)
  }
  d.remove(others.map((c) => c.item))
  d.set(first.item, { colspan: closed.right - closed.left + 1, rowspan: closed.bottom - closed.top + 1 })
  dropEmptyRows(d, tableId)
  return d.done(inCell(d, first.item), { announce: ctx.strings.table.merged })
}

/** Split a merged cell back into single cells; its content stays in the first. */
export function splitCell(ctx: StructureContext, tableId: string, cellId: string): Change | null {
  const d = new Draft(ctx)
  if (!d.has(tableId)) return null
  squareUp(d, tableId)
  const grid = tableGrid(d.tree, tableId)
  const cell = cellIn(grid, cellId)
  if (!cell || (cell.colspan === 1 && cell.rowspan === 1)) return null
  const rows = d.kids(tableId)
  const like = d.node(cellId).attrs
  d.set(cellId, { colspan: 1, rowspan: 1 })
  for (let r = cell.row; r < cell.row + cell.rowspan; r++) {
    const own = r === cell.row
    const count = own ? cell.colspan - 1 : cell.colspan
    if (count === 0) continue
    // Before the cells that start further along this row (as the grid was before the split).
    const at = indexInRow(grid, r, cell.col) + (own ? 1 : 0)
    d.insert(rows[r]!, at, Array.from({ length: count }, () => emptyCell(ctx, like)))
  }
  return d.done(inCell(d, cellId), { announce: ctx.strings.table.split })
}

// ---------------------------------------------------------------------------
// Header row and column

export function setHeaderRow(ctx: StructureContext, tableId: string, on: boolean): Change | null {
  const d = new Draft(ctx)
  const first = d.kids(tableId)[0]
  if (first === undefined || hasHeaderRow(ctx.tree, tableId) === on) return null
  const column = hasHeaderColumn(ctx.tree, tableId)
  for (const c of d.kids(first)) {
    // Without the header row, the first cell stays a row header when the first column is one.
    const keep = !on && column && d.index(c) === 0
    d.set(c, on ? { header: true, scope: 'col' } : { header: keep, scope: keep ? 'row' : '' })
  }
  return d.done(ctx.selection, { announce: on ? ctx.strings.table.headerRowOn : ctx.strings.table.headerRowOff })
}

export function setHeaderColumn(ctx: StructureContext, tableId: string, on: boolean): Change | null {
  const d = new Draft(ctx)
  if (!d.has(tableId) || hasHeaderColumn(ctx.tree, tableId) === on) return null
  const from = hasHeaderRow(ctx.tree, tableId) ? 1 : 0
  for (const c of tableGrid(ctx.tree, tableId).cells) {
    if (c.col !== 0 || c.row < from) continue
    d.set(c.item, on ? { header: true, scope: 'row' } : { header: false, scope: '' })
  }
  return d.done(ctx.selection, { announce: on ? ctx.strings.table.headerColumnOn : ctx.strings.table.headerColumnOff })
}

// ---------------------------------------------------------------------------
// Content of cells

/** Empty the cells: each keeps one empty line. The selection stays. */
export function clearCells(ctx: StructureContext, ids: readonly string[]): Change | null {
  const d = new Draft(ctx)
  let changed = 0
  for (const id of ids) {
    const kids = d.kids(id)
    if (kids.length === 1 && isEmptyParagraph(d.block(kids[0]!))) continue
    d.remove(kids)
    d.insert(id, 0, [newBlock(ctx, PARAGRAPH)])
    changed++
  }
  if (changed === 0) return null
  return d.done(ctx.selection, { announce: ctx.strings.table.cleared(ids.length) })
}

/** The cells of a rectangle as a table of their own, for the clipboard. */
export function cellsToCopy(tree: Tree, tableId: string, rect: Rect): Block {
  const grid = tableGrid(tree, tableId)
  const closed = closeRect(grid, rect)
  const table = tree.nodes.get(tableId)!
  const rows = childrenOf(tree, tableId).slice(closed.top, closed.bottom + 1).map((rowId, i) => {
    const r = closed.top + i
    const kids = cellsIn(grid, closed).filter((c) => c.row === r).map((c) => getBlock(tree, c.item))
    return { ...getBlock(tree, rowId), children: kids }
  }).filter((row) => row.children.length > 0)
  return { id: table.id, type: table.type, attrs: { ...table.attrs, caption: { text: '', formats: [] }, anchor: '' }, children: rows }
}

/**
 * Paste a table into cells, from `startCellId` on, as a spreadsheet does: each
 * pasted cell's content replaces a cell's, rows and columns are added when the
 * table is too small, and the pasted cells' own spans are left behind.
 */
export function fillCells(ctx: StructureContext, tableId: string, startCellId: string, source: Block): Change | null {
  const d = new Draft(ctx)
  if (!d.has(tableId)) return null
  squareUp(d, tableId)
  const start = cellIn(tableGrid(d.tree, tableId), startCellId)
  if (!start) return null
  const src = buildGrid((source.children ?? []).map((r) => r.children ?? []), (c) => ({ colspan: num(c.attrs.colspan), rowspan: num(c.attrs.rowspan) }))
  if (src.cells.length === 0) return null
  const needRows = start.row + src.rows, needCols = start.col + src.cols
  // Grow the table with plain body cells at the end.
  for (let g = tableGrid(d.tree, tableId); g.cols < needCols; g = tableGrid(d.tree, tableId)) {
    d.kids(tableId).forEach((row) => { d.insert(row, d.kids(row).length, [emptyCell(ctx)]) })
  }
  for (let g = tableGrid(d.tree, tableId); g.rows < needRows; g = tableGrid(d.tree, tableId)) {
    d.insert(tableId, d.kids(tableId).length, [newBlock(ctx, ROW, {}, Array.from({ length: g.cols }, () => emptyCell(ctx)))])
  }
  const grid = tableGrid(d.tree, tableId)
  let last = startCellId
  for (const s of src.cells) {
    const i = grid.slots[start.row + s.row]?.[start.col + s.col] ?? -1
    const target = i >= 0 ? grid.cells[i]! : undefined
    // A slot inside a merged cell other than its first takes nothing.
    if (!target || target.row !== start.row + s.row || target.col !== start.col + s.col) continue
    // The source is a validated table, so its cells hold what a cell may hold.
    const content = s.item.children ?? []
    d.remove(d.kids(target.item))
    d.insert(target.item, 0, content.length > 0 ? content : [newBlock(ctx, PARAGRAPH)])
    last = target.item
  }
  return d.done(cellSelection(tableId, startCellId, last), { announce: ctx.strings.pasted(src.cells.length) })
}

// ---------------------------------------------------------------------------
// Moving between cells

export type CellDirection = 'up' | 'down' | 'left' | 'right'

/**
 * The cell next to `cellId` in a direction, at column (or row) `along` when
 * given (the column Up and Down keep). Null at the table's edge. Left and
 * right are logical: start and end of the row.
 */
export function cellToward(tree: Tree, tableId: string, cellId: string, dir: CellDirection, along?: number): string | null {
  const grid = tableGrid(tree, tableId)
  const cell = cellIn(grid, cellId)
  if (!cell) return null
  let r: number, c: number
  if (dir === 'up' || dir === 'down') {
    c = Math.max(cell.col, Math.min(along ?? cell.col, cell.col + cell.colspan - 1))
    r = dir === 'up' ? cell.row - 1 : cell.row + cell.rowspan
  } else {
    r = Math.max(cell.row, Math.min(along ?? cell.row, cell.row + cell.rowspan - 1))
    c = dir === 'left' ? cell.col - 1 : cell.col + cell.colspan
  }
  const i = grid.slots[r]?.[c] ?? -1
  return i >= 0 ? grid.cells[i]!.item : null
}

/** The cell after (1) or before (-1) in reading order, or null past the last or first. */
export function cellInOrder(tree: Tree, tableId: string, cellId: string, dir: -1 | 1): string | null {
  const grid = tableGrid(tree, tableId)
  const i = grid.cells.findIndex((c) => c.item === cellId)
  return i < 0 ? null : grid.cells[i + dir]?.item ?? null
}
