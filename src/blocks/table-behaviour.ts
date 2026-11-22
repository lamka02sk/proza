/**
 * Editing behaviour of the table block:
 * the parts of its structure, the inserter entry, and Tab between
 * cells. The row and column edits are in `src/editor/table.ts`; the canvas
 * and the cell tools that call them are in `table-edit.ts`. No Vue here.
 */
import type { Command, CommandHost } from '../editor/commands'
import type { BlockEditing, InserterItem } from '../editor/editing'
import { stopsIn } from '../editor/editing'
import { Draft, stopEdge } from '../editor/structure'
import { CELL, TABLE, cellInOrder, enclosing, insertRow, newTable, tableGrid } from '../editor/table'
import type { BlockNode } from '../model/tree'
import { TABLE_ROW } from './table'

const name = (type: string) => (_node: BlockNode, s: { blockNames: Readonly<Record<string, string>> }): string => s.blockNames[type] ?? type

export const tableItem: InserterItem = {
  id: TABLE,
  category: 'data',
  keywords: ['table', 'grid', 'rows', 'columns', 'spreadsheet'],
  title: (s) => s.blockNames[TABLE] ?? TABLE,
  drawing: { ink: ['M6 4h84v40H6z', 'M6 18h84M6 31h84M34 4v40M62 4v40'], accent: ['M6 4h84v14H6z'] },
  create: (ctx) => [newTable(ctx)],
}

export const tableEditing: BlockEditing = {
  name: TABLE,
  // The caption is offered while you are in the table (ATAG B.2: tables offer a caption).
  fields: [{ attr: 'caption', optional: true, inputRules: false }],
  group: true,
  isolating: true,
  removeWhenEmpty: true,
  title: name(TABLE),
  fieldLabel: (_n, attr, s) => s.fieldNames[attr] ?? attr,
  inserter: [tableItem],
}

export const tableRowEditing: BlockEditing = {
  name: TABLE_ROW,
  fields: [],
  isolating: true,
  fixed: true,
  removeWhenEmpty: true,
  title: name(TABLE_ROW),
}

export const tableCellEditing: BlockEditing = {
  name: CELL,
  fields: [],
  isolating: true,
  fixed: true,
  keepsChild: true,
  title: name(CELL),
}

/** The cell holding the caret, and its table. */
function caretCell(h: CommandHost): { cell: string; table: string } | null {
  const s = h.selection
  if (s.kind !== 'text') return null
  const tree = h.context().tree
  const cell = enclosing(tree, s.blockId, CELL)
  const table = cell === null ? null : enclosing(tree, cell, TABLE)
  return cell !== null && table !== null ? { cell, table } : null
}

/** Caret at the end of a cell's last text: Tab lands after what is there, ready to add to it. */
function intoCell(h: CommandHost, cellId: string, edge: 'start' | 'end'): boolean {
  const ctx = h.context()
  const own = stopsIn(ctx, cellId)
  const stop = edge === 'start' ? own[0] : own.at(-1)
  if (!stop) return false
  return h.apply({ ops: [], selection: stopEdge(new Draft(ctx), stop, edge) })
}

export const tableCommands: readonly Command[] = [
  {
    name: 'nextCell',
    group: 'text',
    when: 'text',
    keys: [{ keys: 'Tab' }],
    // In a table Tab moves to the next cell; after the last one it adds a row.
    run: (h) => {
      const at = caretCell(h)
      if (!at) return false
      const next = cellInOrder(h.context().tree, at.table, at.cell, 1)
      if (next !== null) return intoCell(h, next, 'end')
      return h.apply(insertRow(h.context(), at.table, tableGrid(h.context().tree, at.table).rows, 0))
    },
  },
  {
    name: 'previousCell',
    group: 'text',
    when: 'text',
    keys: [{ keys: 'Shift+Tab' }],
    // In the first cell Shift+Tab is not taken, so it leaves the editor backwards as everywhere else.
    run: (h) => {
      const at = caretCell(h)
      if (!at) return false
      const prev = cellInOrder(h.context().tree, at.table, at.cell, -1)
      return prev !== null && intoCell(h, prev, 'end')
    },
  },
]
