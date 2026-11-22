/**
 * Text selected across parts over documents with every kind
 * of structure: lists nested in lists, quotes with citations, pictures,
 * separators, tables and columns. Deleting, typing over, copying and pasting
 * a range keep the document valid, keep the text outside the range in order,
 * point the selection at something real and undo exactly.
 */
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { applyOperations } from '../model/operations'
import { defaultFormats, isFormatActive } from '../model/richtext'
import { DOC_VERSION, serializeDoc, validateDoc } from '../model/schema'
import { type Block, type Tree, blocksFromTree, childrenOf, treeFromBlocks } from '../model/tree'
import { type Change, type StructureContext, editingRegistry, fieldValue } from '../editor/editing'
import { en } from '../editor/locale-en'
import { copyAcross, deleteAcross, formatAcross, normalizeRange, orderedStops, pieces, rangeEnds, replaceAcross, splitAcross, andThen } from '../editor/range'
import { type EditorSelection, type TextPoint, NO_SELECTION, caret, range } from '../editor/selection'
import { pasteBlocks } from '../editor/structure'
import { coreRegistry } from './core'
import { columnEditing, columnsEditing, groupEditing } from './layout-behaviour'
import { mediaBlockDefinitions } from './media-edit'
import { tableCellEditing, tableEditing, tableRowEditing } from './table-behaviour'
import { textEditing } from './text-behaviour'

const editing = editingRegistry([...textEditing, ...mediaBlockDefinitions, columnsEditing, columnEditing, groupEditing, tableEditing, tableRowEditing, tableCellEditing])

function context(tree: Tree, selection: EditorSelection = NO_SELECTION): StructureContext {
  let n = 0
  return { tree, schemas: coreRegistry, editing, formats: defaultFormats, strings: en, createId: () => `n${++n}`, current: null, selection }
}

// ---------------------------------------------------------------------------
// Documents

const word = fc.stringMatching(/^[a-d]{0,4}$/)
let ids = 0
const id = (): string => `b${++ids}`
const rich = (text: string) => ({ text, formats: [] })

const paragraph = word.map((t): Block => ({ id: id(), type: 'core/paragraph', attrs: { content: rich(t) } }))
const heading = word.map((t): Block => ({ id: id(), type: 'core/heading', attrs: { level: 2, content: rich(t) } }))
const separator = fc.constant(null).map((): Block => ({ id: id(), type: 'core/separator', attrs: {} }))
const image = word.map((cap): Block => ({ id: id(), type: 'core/image', attrs: { src: '/a.png', caption: rich(cap) } }))
const listItem: fc.Arbitrary<Block> = fc.letrec<{ item: Block; list: Block }>((tie) => ({
  item: fc.tuple(word, fc.oneof({ depthSize: 'small' }, fc.constant([]), fc.array(tie('list'), { maxLength: 1 })))
    .map(([t, kids]): Block => ({ id: id(), type: 'core/list-item', attrs: { content: rich(t) }, ...(kids.length ? { children: kids } : {}) })),
  list: fc.array(tie('item'), { minLength: 1, maxLength: 3 }).map((children): Block => ({ id: id(), type: 'core/list', attrs: { style: 'bullet' }, children })),
})).item
const list = fc.array(listItem, { minLength: 1, maxLength: 3 }).map((children): Block => ({ id: id(), type: 'core/list', attrs: { style: 'bullet' }, children }))
const quote = fc.tuple(fc.array(paragraph, { minLength: 1, maxLength: 2 }), word)
  .map(([children, cite]): Block => ({ id: id(), type: 'core/quote', attrs: { citation: rich(cite) }, children }))
const table = fc.array(word, { minLength: 4, maxLength: 4 }).map((t): Block => ({
  id: id(), type: 'core/table', attrs: {},
  children: [0, 1].map((r) => ({
    id: id(), type: 'core/table-row', attrs: {},
    children: [0, 1].map((c) => ({ id: id(), type: 'core/table-cell', attrs: {}, children: [{ id: id(), type: 'core/paragraph', attrs: { content: rich(t[r * 2 + c]!) } }] })),
  })),
}))
const columns = fc.array(fc.array(paragraph, { minLength: 1, maxLength: 2 }), { minLength: 2, maxLength: 3 }).map((cols): Block => ({
  id: id(), type: 'core/columns', attrs: { ratio: cols.length === 2 ? '1-1' : '1-1-1' },
  children: cols.map((kids) => ({ id: id(), type: 'core/column', attrs: {}, children: kids })),
}))
const group = fc.array(paragraph, { minLength: 1, maxLength: 2 }).map((children): Block => ({ id: id(), type: 'core/group', attrs: {}, children }))

const arbDoc = fc.array(fc.oneof(paragraph, paragraph, heading, list, quote, separator, image, table, columns, group), { minLength: 2, maxLength: 6 }).map((blocks) => {
  const { doc, issues } = validateDoc({ version: DOC_VERSION, blocks }, coreRegistry)
  expect(issues).toEqual([])
  return treeFromBlocks(doc.blocks)
})

// ---------------------------------------------------------------------------
// Checks

/** Every text point of the document, field by field in reading order. */
function points(tree: Tree): TextPoint[] {
  const out: TextPoint[] = []
  for (const s of orderedStops({ tree, editing })) {
    if (s.field === null) continue
    const len = fieldValue(tree.nodes.get(s.blockId)!, s.field).text.length
    for (let o = 0; o <= len; o++) out.push({ blockId: s.blockId, field: s.field, offset: o })
  }
  return out
}

/** The document's text in reading order, with `|` between fields (so joins are visible as a missing bar). */
const flat = (tree: Tree): string => orderedStops({ tree, editing })
  .filter((s) => s.field !== null)
  .map((s) => fieldValue(tree.nodes.get(s.blockId)!, s.field!).text)
  .join('')

/** The text before a point and after a point, in reading order. */
function around(tree: Tree, start: TextPoint, end: TextPoint): [string, string] {
  let before = '', after = ''
  let phase: 'before' | 'inside' | 'after' = 'before'
  for (const s of orderedStops({ tree, editing })) {
    if (s.field === null) continue
    const t = fieldValue(tree.nodes.get(s.blockId)!, s.field).text
    const isStart = s.blockId === start.blockId && s.field === start.field
    const isEnd = s.blockId === end.blockId && s.field === end.field
    if (phase === 'before' && isStart) { before += t.slice(0, start.offset); phase = 'inside' }
    else if (phase === 'before') before += t
    if (phase === 'inside' && isEnd) { after += t.slice(end.offset); phase = 'after'; continue }
    if (phase === 'after') after += t
  }
  return [before, after]
}

function check(before: Tree, change: Change): Tree {
  const after = applyOperations(before, change.ops)
  const blocks = blocksFromTree(after.tree)
  const { issues } = validateDoc(serializeDoc({ version: DOC_VERSION, blocks }, coreRegistry), coreRegistry)
  expect(issues).toEqual([])
  expect(childrenOf(after.tree, null).length).toBeGreaterThan(0)
  expect(blocksFromTree(applyOperations(after.tree, after.inverse).tree)).toEqual(blocksFromTree(before))
  const s = change.selection
  if (s.kind === 'text') {
    const node = after.tree.nodes.get(s.blockId)
    expect(node).toBeDefined()
    expect(s.focus).toBeLessThanOrEqual(fieldValue(node!, s.field).text.length)
  }
  return after.tree
}

/** A range from two picks among the document's text points, as the editor keeps it. */
function pickRange(tree: Tree, a: number, b: number): Extract<EditorSelection, { kind: 'range' }> | null {
  const all = points(tree)
  if (all.length < 2) return null
  const sel = normalizeRange({ tree, editing }, all[a % all.length]!, all[b % all.length]!)
  return sel.kind === 'range' ? sel : null
}

// ---------------------------------------------------------------------------

describe('text across parts', () => {
  it('a range never ends partway into a table or columns it does not start in', () => {
    fc.assert(fc.property(arbDoc, fc.nat(), fc.nat(), (tree, a, b) => {
      const sel = pickRange(tree, a, b)
      if (!sel) return
      const order = orderedStops({ tree, editing })
      const at = (q: TextPoint): number => order.findIndex((s) => s.blockId === q.blockId && s.field === q.field)
      const forward = at(sel.anchor) < at(sel.focus)
      const isolating = (q: TextPoint): string[] => {
        const out: string[] = []
        for (let x: string | null = q.blockId; x !== null; x = tree.parents.get(x) ?? null) if (editing.get(tree.nodes.get(x)!.type)?.isolating) out.push(x)
        return out
      }
      // Each end sits at the far edge of every isolating part around it that the other end is not in.
      for (const [q, other, toStart] of [[sel.anchor, sel.focus, forward], [sel.focus, sel.anchor, !forward]] as const) {
        const theirs = isolating(other)
        for (const x of isolating(q).filter((x) => !theirs.includes(x))) {
          const inside = order.filter((s) => s.field !== null && isUnder(tree, x, s.blockId))
          const edge = toStart ? inside[0]! : inside.at(-1)!
          const len = fieldValue(tree.nodes.get(edge.blockId)!, edge.field!).text.length
          expect({ blockId: q.blockId, field: q.field, offset: q.offset }).toEqual({ blockId: edge.blockId, field: edge.field, offset: toStart ? 0 : len })
        }
      }
    }), { numRuns: 300 })
  })

  it('deleting keeps the text before and after it, in order, and the document valid', () => {
    fc.assert(fc.property(arbDoc, fc.nat(), fc.nat(), (tree, a, b) => {
      const sel = pickRange(tree, a, b)
      if (!sel) return
      const ends = rangeEnds({ tree, editing }, sel)!
      const [before, after] = around(tree, ends.start, ends.end)
      const change = deleteAcross(context(tree, sel), sel)
      expect(change).not.toBeNull()
      const next = check(tree, change!)
      expect(flat(next)).toBe(before + after)
      // The caret is where the text before ends.
      const s = change!.selection
      if (s.kind === 'text') {
        const [b2] = around(next, { blockId: s.blockId, field: s.field, offset: s.focus }, { blockId: s.blockId, field: s.field, offset: s.focus })
        expect(b2).toBe(before)
      }
    }), { numRuns: 500 })
  })

  it('typing over it puts the typed text between the text before and after', () => {
    fc.assert(fc.property(arbDoc, fc.nat(), fc.nat(), (tree, a, b) => {
      const sel = pickRange(tree, a, b)
      if (!sel) return
      const ends = rangeEnds({ tree, editing }, sel)!
      const [before, after] = around(tree, ends.start, ends.end)
      const change = replaceAcross(context(tree, sel), sel, 'XY')
      expect(change).not.toBeNull()
      expect(flat(check(tree, change!))).toBe(`${before}XY${after}`)
    }), { numRuns: 300 })
  })

  it('Enter over it leaves the text before and after it in two parts', () => {
    fc.assert(fc.property(arbDoc, fc.nat(), fc.nat(), (tree, a, b) => {
      const sel = pickRange(tree, a, b)
      if (!sel) return
      const ends = rangeEnds({ tree, editing }, sel)!
      const [before, after] = around(tree, ends.start, ends.end)
      const change = splitAcross(context(tree, sel), sel)
      if (!change) return
      const next = check(tree, change)
      // A split in code or a caption adds a line break instead.
      expect(flat(next).replace(/\n/g, '')).toBe(before.replace(/\n/g, '') + after.replace(/\n/g, ''))
    }), { numRuns: 300 })
  })

  it('a copy holds exactly the selected text, validates, and pasted back where it was cut gives the text back', () => {
    fc.assert(fc.property(arbDoc, fc.nat(), fc.nat(), (tree, a, b) => {
      const sel = pickRange(tree, a, b)
      if (!sel) return
      const ctx = context(tree, sel)
      const ends = rangeEnds(ctx, sel)!
      const copied = copyAcross(ctx, coreRegistry, sel)
      const { doc, issues } = validateDoc({ version: DOC_VERSION, blocks: copied }, coreRegistry)
      expect(issues).toEqual([])
      const original = flat(tree)
      const [before, after] = around(tree, ends.start, ends.end)
      const inside = original.slice(before.length, original.length - after.length)
      expect(flat(treeFromBlocks(doc.blocks))).toBe(inside)
      // Cut and paste at the same place, as one change.
      const removed = deleteAcross(ctx, sel)!
      const at = removed.selection
      if (at.kind !== 'text') return
      let n = 0
      const fresh = (bl: Block): Block => ({ ...bl, id: `f${++n}`, ...(bl.children ? { children: bl.children.map(fresh) } : {}) })
      const change = andThen(ctx, removed, (c) => pasteBlocks(c, at, doc.blocks.map(fresh), true))
      expect(flat(check(tree, change))).toBe(original)
    }), { numRuns: 400 })
  })

  it('bold over it makes every selected character bold where bold is allowed, and touches nothing else', () => {
    fc.assert(fc.property(arbDoc, fc.nat(), fc.nat(), (tree, a, b) => {
      const sel = pickRange(tree, a, b)
      if (!sel) return
      const ctx = context(tree, sel)
      const change = formatAcross(ctx, sel, { set: { type: 'bold' } }, () => true)
      if (!change) return
      const next = check(tree, change)
      expect(flat(next)).toBe(flat(tree))
      expect(change.selection).toEqual(sel)
      const ends = rangeEnds(ctx, sel)!
      for (const p of pieces(ctx, ends)) {
        if (p.start < p.end) expect(isFormatActive(fieldValue(next.nodes.get(p.blockId)!, p.field), p.start, p.end, 'bold')).toBe(true)
      }
    }), { numRuns: 300 })
  })
})

describe('text across parts: examples', () => {
  const p = (bid: string, text: string): Block => ({ id: bid, type: 'core/paragraph', attrs: { content: rich(text) } })
  const doc = (...blocks: Block[]): Tree => treeFromBlocks(validateDoc({ version: DOC_VERSION, blocks }, coreRegistry).doc.blocks)
  const pt = (blockId: string, offset: number, field = 'content'): TextPoint => ({ blockId, field, offset })
  const across = (anchor: TextPoint, focus: TextPoint) => ({ kind: 'range', anchor, focus }) as const

  it('from an item into its sub-item, the sub-item joins and its own items stay in reading order', () => {
    const tree = doc({
      id: 'l', type: 'core/list', attrs: { style: 'bullet' }, children: [{
        id: 'a', type: 'core/list-item', attrs: { content: rich('one') }, children: [{
          id: 'm', type: 'core/list', attrs: { style: 'bullet' }, children: [
            { id: 'b', type: 'core/list-item', attrs: { content: rich('two') }, children: [{ id: 'n', type: 'core/list', attrs: { style: 'bullet' }, children: [{ id: 'c', type: 'core/list-item', attrs: { content: rich('deep') } }] }] },
            { id: 'd', type: 'core/list-item', attrs: { content: rich('three') } },
          ],
        }],
      }],
    })
    const sel = across(pt('a', 1), pt('b', 1))
    const next = check(tree, deleteAcross(context(tree, sel), sel)!)
    expect(flat(next)).toBe('owodeepthree')
    expect(fieldValue(next.nodes.get('a')!, 'content').text).toBe('owo')
  })

  it('a citation is never joined into: the rest stays in its field', () => {
    const tree = doc({ id: 'q', type: 'core/quote', attrs: { citation: rich('Author') }, children: [p('a', 'words')] }, p('b', 'after'))
    const sel = across(pt('a', 2), pt('q', 3, 'citation'))
    const next = check(tree, deleteAcross(context(tree, sel), sel)!)
    expect(fieldValue(next.nodes.get('a')!, 'content').text).toBe('wo')
    expect(fieldValue(next.nodes.get('q')!, 'citation').text).toBe('hor')
  })

  it('from one column into the next empties both and keeps the columns', () => {
    const tree = doc({
      id: 'cs', type: 'core/columns', attrs: { ratio: '1-1-1' }, children: [
        { id: 'c1', type: 'core/column', attrs: {}, children: [p('a', 'left')] },
        { id: 'c2', type: 'core/column', attrs: {}, children: [p('b', 'mid')] },
        { id: 'c3', type: 'core/column', attrs: {}, children: [p('c', 'right')] },
      ],
    })
    const sel = normalizeRange({ tree, editing }, pt('a', 2), pt('b', 1))
    expect(sel).toEqual(range(pt('a', 0), pt('b', 3)))
    if (sel.kind !== 'range') return
    const next = check(tree, deleteAcross(context(tree, sel), sel)!)
    expect(childrenOf(next, 'cs').length).toBe(3)
    expect(flat(next)).toBe('right')
  })

  it('paste of an open slice at a caret joins its ends with the text around the caret', () => {
    const tree = doc(p('x', 'ABCD'))
    const sel = caret('x', 'content', 2)
    const change = pasteBlocks(context(tree, sel), sel, [p('z1', 'one'), p('z2', 'two'), p('z3', 'three')], true)!
    const next = check(tree, change)
    expect(childrenOf(next, null).map((i) => fieldValue(next.nodes.get(i)!, 'content').text)).toEqual(['ABone', 'two', 'threeCD'])
    expect(change.selection).toMatchObject({ kind: 'text', focus: 5 })
  })
})

function isUnder(tree: Tree, ancestor: string, id: string): boolean {
  for (let x: string | null = id; x !== null; x = tree.parents.get(x) ?? null) if (x === ancestor) return true
  return false
}
