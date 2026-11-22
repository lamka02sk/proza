/**
 * Table edits: every sequence of row, column, merge, split,
 * header, clear and fill edits leaves a table the schema accepts whose grid is
 * a rectangle with each slot covered once, keeps every cell's content unless
 * the edit removes it, points the selection at something real, and undoes exactly.
 */
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { buildGrid } from '../model/grid'
import { applyOperations } from '../model/operations'
import { defaultFormats } from '../model/richtext'
import { DOC_VERSION, serializeDoc, validateDoc } from '../model/schema'
import { type Block, type Tree, blocksFromTree, getBlock, treeFromBlocks } from '../model/tree'
import { type Change, type StructureContext, editingRegistry, fieldValue } from '../editor/editing'
import { en } from '../editor/locale-en'
import { type EditorSelection, NO_SELECTION, cells as cellSelection } from '../editor/selection'
import { removeBlocks, pasteBlocks } from '../editor/structure'
import {
  cellToward, cellsToCopy, clearCells, fillCells, hasHeaderColumn, hasHeaderRow, insertColumn, insertRow, mergeCells, newTable, removeColumn, removeRow,
  selectedCells, setHeaderColumn, setHeaderRow, splitCell, tableGrid,
} from '../editor/table'
import { coreRegistry } from './core'
import { tableCellEditing, tableEditing, tableRowEditing } from './table-behaviour'
import { textEditing } from './text-behaviour'

const editing = editingRegistry([...textEditing, tableEditing, tableRowEditing, tableCellEditing])

function context(tree: Tree, selection: EditorSelection = NO_SELECTION): StructureContext {
  let n = 0
  return { tree, schemas: coreRegistry, editing, formats: defaultFormats, strings: en, createId: () => `n${++n}x${Math.random().toString(36).slice(2, 6)}`, current: null, selection }
}

const rich = (text: string) => ({ text, formats: [] })
const para = (id: string, text: string): Block => ({ id: `${id}p`, type: 'core/paragraph', attrs: { content: rich(text) } })
const cell = (id: string, text: string, header = false): Block => ({ id, type: 'core/table-cell', attrs: { header, scope: header ? 'col' : '' }, children: [para(id, text)] })

function table(rows: number, cols: number, header: boolean): Tree {
  const blocks: Block[] = [{
    id: 't', type: 'core/table', attrs: {},
    children: Array.from({ length: rows }, (_, r) => ({
      id: `r${r}`, type: 'core/table-row', attrs: {},
      children: Array.from({ length: cols }, (_, c) => cell(`c${r}_${c}`, `${r}.${c}`, header && r === 0)),
    })),
  }]
  const { doc, issues } = validateDoc({ version: DOC_VERSION, blocks }, coreRegistry)
  expect(issues).toEqual([])
  return treeFromBlocks(doc.blocks)
}

/** Texts of all cells, in no particular order. */
function texts(tree: Tree): string[] {
  const out: string[] = []
  for (const n of tree.nodes.values()) if (n.type === 'core/paragraph') { const t = fieldValue(n, 'content').text; if (t !== '') out.push(t) }
  return out.sort()
}

function expectSound(tree: Tree): void {
  const { issues } = validateDoc(serializeDoc({ version: DOC_VERSION, blocks: blocksFromTree(tree) }, coreRegistry), coreRegistry)
  expect(issues).toEqual([])
  if (!tree.nodes.has('t')) return
  // Each slot is covered exactly once, and the grid is a rectangle.
  const rows = (tree.children.get('t') ?? []).map((r) => tree.children.get(r) ?? [])
  const cover = new Map<string, number>()
  const grid = buildGrid(rows, (id) => ({ colspan: Number(tree.nodes.get(id)!.attrs.colspan), rowspan: Number(tree.nodes.get(id)!.attrs.rowspan) }))
  for (const c of grid.cells) for (let y = c.row; y < c.row + c.rowspan; y++) for (let x = c.col; x < c.col + c.colspan; x++) cover.set(`${y},${x}`, (cover.get(`${y},${x}`) ?? 0) + 1)
  expect([...cover.values()].every((v) => v === 1)).toBe(true)
  expect(cover.size).toBe(grid.rows * grid.cols)
  for (const r of rows) expect(r.length).toBeGreaterThan(0)
  for (const c of grid.cells) expect((tree.children.get(c.item) ?? []).length).toBeGreaterThan(0)
}

function check(before: Tree, change: Change | null): Tree {
  if (!change) return before
  const after = applyOperations(before, change.ops)
  expectSound(after.tree)
  expect(blocksFromTree(applyOperations(after.tree, after.inverse).tree)).toEqual(blocksFromTree(before))
  const s = change.selection
  if (s.kind === 'text') expect(after.tree.nodes.has(s.blockId)).toBe(true)
  if (s.kind === 'cells') expect(selectedCells(after.tree, s).length).toBeGreaterThan(0)
  return after.tree
}

type Step = readonly [kind: number, a: number, b: number, c: number, d: number]
const step = fc.tuple(fc.integer({ min: 0, max: 9 }), fc.nat(9), fc.nat(9), fc.nat(9), fc.nat(9))

function run(tree: Tree, [kind, a, b, c, d]: Step): { tree: Tree; keeps: boolean } {
  if (!tree.nodes.has('t')) return { tree, keeps: true }
  const g = tableGrid(tree, 't')
  const ctx = context(tree)
  const cellAt = (i: number) => g.cells[i % g.cells.length]!
  switch (kind) {
    case 0: return { tree: check(tree, insertRow(ctx, 't', a % (g.rows + 1), b % g.cols)), keeps: true }
    case 1: return { tree: check(tree, insertColumn(ctx, 't', a % (g.cols + 1), b % g.rows)), keeps: true }
    case 2: return { tree: check(tree, removeRow(ctx, 't', a % g.rows)), keeps: false }
    case 3: return { tree: check(tree, removeColumn(ctx, 't', a % g.cols)), keeps: false }
    case 4: {
      const top = a % g.rows, left = b % g.cols
      return { tree: check(tree, mergeCells(ctx, 't', { top, left, bottom: Math.min(g.rows - 1, top + (c % 3)), right: Math.min(g.cols - 1, left + (d % 3)) })), keeps: true }
    }
    case 5: return { tree: check(tree, splitCell(ctx, 't', cellAt(a).item)), keeps: true }
    case 6: return { tree: check(tree, setHeaderRow(ctx, 't', a % 2 === 0)), keeps: true }
    case 7: return { tree: check(tree, setHeaderColumn(ctx, 't', a % 2 === 0)), keeps: true }
    case 8: return { tree: check(tree, clearCells(ctx, selectedCells(tree, cellSelection('t', cellAt(a).item, cellAt(b).item)))), keeps: false }
    default: {
      const src = newTable(ctx, 1 + (c % 2), 1 + (d % 3))
      return { tree: check(tree, fillCells(ctx, 't', cellAt(a).item, src)), keeps: false }
    }
  }
}

describe('table edits', () => {
  it('any sequence keeps the grid whole, the schema satisfied and undo exact', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 4 }), fc.integer({ min: 1, max: 4 }), fc.boolean(), fc.array(step, { minLength: 1, maxLength: 8 }), (rows, cols, header, steps) => {
      let tree = table(rows, cols, header)
      let words = texts(tree)
      for (const s of steps) {
        const next = run(tree, s)
        // Rows, columns, merging, splitting and headers never lose a word.
        if (next.keeps) expect(texts(next.tree)).toEqual(words)
        tree = next.tree
        words = texts(tree)
      }
    }), { numRuns: 400 })
  })

  it('a row added inside a merged cell widens it; removing the row a merged cell starts in moves the cell down', () => {
    let tree = table(3, 2, false)
    tree = check(tree, mergeCells(context(tree), 't', { top: 0, left: 0, bottom: 1, right: 0 }))
    expect(tree.nodes.get('c0_0')!.attrs.rowspan).toBe(2)
    tree = check(tree, insertRow(context(tree), 't', 1))
    expect(tree.nodes.get('c0_0')!.attrs.rowspan).toBe(3)
    tree = check(tree, removeRow(context(tree), 't', 0))
    expect(tree.nodes.get('c0_0')!.attrs.rowspan).toBe(2)
    // Merging brought 1.0 into the merged cell, which moved down with it.
    expect(texts(tree)).toEqual(['0.0', '1.0', '1.1', '2.0', '2.1'])
  })

  it('merging joins the content in reading order; splitting gives back single cells', () => {
    let tree = table(3, 3, false)
    tree = check(tree, mergeCells(context(tree), 't', { top: 0, left: 0, bottom: 1, right: 1 }))
    expect(tableGrid(tree, 't').cells).toHaveLength(6)
    expect((tree.children.get('c0_0') ?? []).map((p) => fieldValue(tree.nodes.get(p)!, 'content').text)).toEqual(['0.0', '0.1', '1.0', '1.1'])
    tree = check(tree, splitCell(context(tree), 't', 'c0_0'))
    expect(tableGrid(tree, 't').cells).toHaveLength(9)
  })

  it('merging whole rows leaves one row: a row with no cell of its own goes', () => {
    let tree = table(2, 2, false)
    tree = check(tree, mergeCells(context(tree), 't', { top: 0, left: 0, bottom: 1, right: 1 }))
    const g = tableGrid(tree, 't')
    expect([g.rows, g.cols, g.cells.length]).toEqual([1, 2, 1])
  })

  it('header row and column switch on and off; a new row below the header is a body row', () => {
    let tree = table(2, 2, true)
    expect(hasHeaderRow(tree, 't')).toBe(true)
    tree = check(tree, setHeaderColumn(context(tree), 't', true))
    expect(hasHeaderColumn(tree, 't')).toBe(true)
    tree = check(tree, insertRow(context(tree), 't', 1))
    const second = tree.children.get(tree.children.get('t')![1]!)!
    expect(second.map((c) => tree.nodes.get(c)!.attrs.header)).toEqual([true, false])
    tree = check(tree, setHeaderRow(context(tree), 't', false))
    expect(hasHeaderRow(tree, 't')).toBe(false)
  })

  it('a table pasted into a cell fills cells from there and grows the table', () => {
    let tree = table(2, 2, false)
    const src = getBlock(treeFromBlocks([{ id: 's', type: 'core/table', attrs: {}, children: [
      { id: 'sr', type: 'core/table-row', attrs: {}, children: [cell('x', 'X'), cell('y', 'Y'), cell('z', 'Z')] },
    ] }]), 's')
    tree = check(tree, fillCells(context(tree), 't', 'c1_1', src))
    const g = tableGrid(tree, 't')
    expect([g.rows, g.cols]).toEqual([2, 4])
    expect(texts(tree)).toEqual(['0.0', '0.1', '1.0', 'X', 'Y', 'Z'])
  })

  it('copied cells are a table of their own', () => {
    const tree = table(3, 3, true)
    const copy = cellsToCopy(tree, 't', { top: 1, left: 1, bottom: 2, right: 2 })
    expect(copy.children!.map((r) => r.children!.map((c) => c.id))).toEqual([['c1_1', 'c1_2'], ['c2_1', 'c2_2']])
  })

  it('removing a selected cell empties it; the grid stays', () => {
    const tree = table(2, 2, false)
    const after = check(tree, removeBlocks(context(tree), ['c0_1']))
    expect(texts(after)).toEqual(['0.0', '1.0', '1.1'])
    expect(tableGrid(after, 't').cells).toHaveLength(4)
  })

  it('a paragraph pasted into a cell stays in it; a table pasted there goes after the table', () => {
    const tree = table(2, 2, false)
    const ctx = context(tree, { kind: 'text', blockId: 'c0_0p', field: 'content', anchor: 3, focus: 3 })
    const after = check(tree, pasteBlocks(ctx, ctx.selection, [newTable(ctx, 1, 1)]))
    expect(blocksFromTree(after).map((b) => b.type)).toEqual(['core/table', 'core/table'])
  })

  it('Up and Down keep the column across merged cells', () => {
    let tree = table(3, 3, false)
    tree = check(tree, mergeCells(context(tree), 't', { top: 1, left: 0, bottom: 1, right: 2 }))
    expect(cellToward(tree, 't', 'c0_2', 'down')).toBe('c1_0')
    expect(cellToward(tree, 't', 'c1_0', 'down', 2)).toBe('c2_2')
    expect(cellToward(tree, 't', 'c0_0', 'up')).toBeNull()
  })
})
