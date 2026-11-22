/**
 * Structural edits over the text blocks: every Enter, Backspace, Delete, Tab,
 * removal, move, duplication and paste leaves a document the schema accepts,
 * keeps the text in reading order, points the selection at something real,
 * and undoes exactly.
 */
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { applyOperations } from '../model/operations'
import { createValue, defaultFormats, split } from '../model/richtext'
import { DOC_VERSION, serializeDoc, validateDoc } from '../model/schema'
import { type Block, type Tree, blocksFromTree, childrenOf, treeFromBlocks } from '../model/tree'
import { type Change, type Stop, type StructureContext, editingRegistry, fieldValue, mainField, stops } from '../editor/editing'
import { en } from '../editor/locale-en'
import { type EditorSelection, NO_SELECTION, blocks as blockSelection, caret, selectedBlocks } from '../editor/selection'
import {
  duplicateBlocks, insertBlocks, mergeBackward, mergeForward, moveBlocks, moveBlocksTo, newBlock, pasteBlocks, removeBlocks, retype, splitBlock,
} from '../editor/structure'
import { coreRegistry as textRegistry } from './core'
import { mediaBlockDefinitions } from './media-edit'
import { type ShowAs, indentItem, outdentItem, showAs, textEditing, toggleCheck } from './text-behaviour'

// Text and media blocks together: structural edits must hold around parts without a main text (pictures, galleries).
const editing = editingRegistry([...textEditing, ...mediaBlockDefinitions])

function context(tree: Tree, selection: EditorSelection = NO_SELECTION, prefix = 'n'): StructureContext {
  let n = 0
  const current = selection.kind === 'text' ? selection.blockId : selection.kind === 'blocks' ? selection.focusId : null
  return { tree, schemas: textRegistry, editing, formats: defaultFormats, strings: en, createId: () => `${prefix}${++n}`, current, selection }
}

// ---------------------------------------------------------------------------
// Documents

const word = fc.stringMatching(/^[a-c ]{0,6}$/)
let ids = 0
const id = (): string => `b${++ids}`
const rich = (text: string) => ({ text, formats: [] })

const paragraph = word.map((t): Block => ({ id: id(), type: 'core/paragraph', attrs: { content: rich(t) } }))
const heading = fc.tuple(word, fc.integer({ min: 1, max: 6 })).map(([t, level]): Block => ({ id: id(), type: 'core/heading', attrs: { level, content: rich(t) } }))
const code = word.map((t): Block => ({ id: id(), type: 'core/code', attrs: { content: rich(t) } }))
const separator = fc.constant(null).map((): Block => ({ id: id(), type: 'core/separator', attrs: {} }))
const listItem: fc.Arbitrary<Block> = fc.letrec<{ item: Block; list: Block }>((tie) => ({
  item: fc.tuple(word, fc.oneof({ depthSize: 'small' }, fc.constant([]), fc.array(tie('list'), { maxLength: 1 })))
    .map(([t, kids]): Block => ({ id: id(), type: 'core/list-item', attrs: { content: rich(t) }, ...(kids.length ? { children: kids } : {}) })),
  list: fc.tuple(fc.constantFrom('bullet', 'number'), fc.array(tie('item'), { minLength: 1, maxLength: 3 }))
    .map(([style, children]): Block => ({ id: id(), type: 'core/list', attrs: { style }, children })),
})).item
const list = fc.tuple(fc.constantFrom('bullet', 'number'), fc.array(listItem, { minLength: 1, maxLength: 3 }))
  .map(([style, children]): Block => ({ id: id(), type: 'core/list', attrs: { style }, children }))
const quote = fc.tuple(fc.array(paragraph, { minLength: 1, maxLength: 2 }), word)
  .map(([children, cite]): Block => ({ id: id(), type: 'core/quote', attrs: { citation: rich(cite) }, children }))
const image = fc.tuple(word, fc.boolean()).map(([cap, filled]): Block => ({ id: id(), type: 'core/image', attrs: { src: filled ? '/a.png' : '', caption: rich(cap) } }))
const gallery = fc.array(image, { maxLength: 3 }).map((children): Block => ({ id: id(), type: 'core/gallery', attrs: {}, children }))
const file = fc.constant(null).map((): Block => ({ id: id(), type: 'core/file', attrs: { href: '/a.pdf' } }))

/** Valid documents: generated, then through validateDoc so every attribute is set. */
const arbDoc = fc.array(fc.oneof(paragraph, paragraph, heading, list, quote, code, separator, image, gallery, file), { minLength: 1, maxLength: 6 }).map((blocks) => {
  const { doc, issues } = validateDoc({ version: DOC_VERSION, blocks }, textRegistry)
  expect(issues).toEqual([])
  return treeFromBlocks(doc.blocks)
})

// ---------------------------------------------------------------------------
// Checks

/** The text a reader meets, field by field, in order. */
function reading(tree: Tree): string {
  return stops({ tree, editing, current: null })
    .map((s) => (s.field === null ? '|' : fieldValue(tree.nodes.get(s.blockId)!, s.field).text))
    .join('/')
    .replace(/\/+/g, '/')
}

function flatText(tree: Tree): string {
  return stops({ tree, editing, current: null }).map((s) => (s.field === null ? '' : fieldValue(tree.nodes.get(s.blockId)!, s.field).text)).join('')
}

function check(before: Tree, change: Change): Tree {
  const after = applyOperations(before, change.ops)
  const blocks = blocksFromTree(after.tree)
  // The schema accepts it: nothing becomes a placeholder, nothing is repaired.
  const { issues } = validateDoc(serializeDoc({ version: DOC_VERSION, blocks }, textRegistry), textRegistry)
  expect(issues).toEqual([])
  expect(childrenOf(after.tree, null).length).toBeGreaterThan(0)
  // Undo is exact.
  expect(blocksFromTree(applyOperations(after.tree, after.inverse).tree)).toEqual(blocksFromTree(before))
  // The selection points at something that exists.
  const s = change.selection
  if (s.kind === 'text') {
    const node = after.tree.nodes.get(s.blockId)
    expect(node).toBeDefined()
    const len = fieldValue(node!, s.field).text.length
    expect(s.anchor).toBeLessThanOrEqual(len)
    expect(s.focus).toBeLessThanOrEqual(len)
  }
  if (s.kind === 'blocks') expect(selectedBlocks(after.tree, s).length).toBeGreaterThan(0)
  return after.tree
}

const pick = <T>(list: readonly T[], n: number): T | undefined => list[n % Math.max(1, list.length)]

function textStops(tree: Tree): Stop[] {
  return stops({ tree, editing, current: null }).filter((s) => s.field !== null)
}

// ---------------------------------------------------------------------------

describe('structural edits on text blocks', () => {
  it('Enter keeps every character, in order, and the document valid', () => {
    fc.assert(fc.property(arbDoc, fc.nat(), fc.nat(), (tree, i, at) => {
      const stop = pick(textStops(tree), i)
      if (!stop) return
      const value = fieldValue(tree.nodes.get(stop.blockId)!, stop.field!)
      const offset = at % (value.text.length + 1)
      const [before, after] = split(value, offset)
      const sel = caret(stop.blockId, stop.field!, offset)
      const change = splitBlock(context(tree, sel), stop.blockId, stop.field!, before, after)
      if (!change) return
      const next = check(tree, change)
      const def = editing.get(tree.nodes.get(stop.blockId)!.type)
      // A caption breaks its line on Enter, like a multiline field.
      const multiline = def?.group === true || def?.fields.find((f) => f.attr === stop.field)?.multiline
      const strip = (t: string): string => t.replace(/\n/g, '')
      if (multiline && change.typed === '\n') {
        // A line break was typed: one character more, the same text around it.
        expect(flatText(next).length).toBe(flatText(tree).length + 1)
        expect(strip(flatText(next))).toBe(strip(flatText(tree)))
      } else if (!multiline) expect(flatText(next)).toBe(flatText(tree))
    }), { numRuns: 400 })
  })

  it('Backspace at a start and Delete at an end keep the text in reading order', () => {
    fc.assert(fc.property(arbDoc, fc.nat(), fc.boolean(), (tree, i, back) => {
      const stop = pick(textStops(tree), i)
      if (!stop) return
      const len = fieldValue(tree.nodes.get(stop.blockId)!, stop.field!).text.length
      const sel = caret(stop.blockId, stop.field!, back ? 0 : len)
      const ctx = context(tree, sel)
      const change = back ? mergeBackward(ctx, stop.blockId, stop.field!) : mergeForward(ctx, stop.blockId, stop.field!)
      if (!change) return
      const next = check(tree, change)
      expect(flatText(next)).toBe(flatText(tree))
    }), { numRuns: 400 })
  })

  it('Tab and Shift+Tab in list items keep the text and the document valid', () => {
    fc.assert(fc.property(arbDoc, fc.nat(), fc.boolean(), (tree, i, indent) => {
      const items = [...tree.nodes.values()].filter((n) => n.type === 'core/list-item')
      const item = pick(items, i)
      if (!item) return
      const ctx = context(tree, caret(item.id, 'content', 0))
      const change = indent ? indentItem(ctx, item.id) : outdentItem(ctx, item.id)
      if (!change) return
      const next = check(tree, change)
      expect(flatText(next)).toBe(flatText(tree))
    }), { numRuns: 300 })
  })

  it('removing, moving, duplicating and changing type keep the document valid', () => {
    fc.assert(fc.property(arbDoc, fc.nat(), fc.nat(), fc.nat(3), (tree, i, j, kind) => {
      const all = [...tree.nodes.keys()]
      const a = pick(all, i)!, b = pick(all, j)!
      const sel = blockSelection(a, b)
      const targets = selectedBlocks(tree, sel)
      const ctx = context(tree, sel)
      const change = kind === 0 ? removeBlocks(ctx, targets)
        : kind === 1 ? moveBlocks(ctx, targets, j % 2 === 0 ? -1 : 1, sel)
          : kind === 2 ? duplicateBlocks(ctx, targets, sel)
            : retype(ctx, targets, 'core/heading', { level: 3 })
      if (!change) return
      check(tree, change)
    }), { numRuns: 400 })
  })

  it('pasting any copied blocks anywhere keeps the document valid and every pasted character', () => {
    fc.assert(fc.property(arbDoc, arbDoc, fc.nat(), fc.nat(), fc.boolean(), (tree, clip, i, at, onBlocks) => {
      const pasted = blocksFromTree(clip).map(function fresh(b: Block): Block {
        const base = { ...b, id: `x${b.id}` }
        return b.children ? { ...base, children: b.children.map(fresh) } : base
      })
      let sel: EditorSelection
      if (onBlocks) {
        const all = [...tree.nodes.keys()]
        sel = blockSelection(pick(all, i)!)
      } else {
        const stop = pick(textStops(tree), i)
        if (!stop) return
        const len = fieldValue(tree.nodes.get(stop.blockId)!, stop.field!).text.length
        sel = caret(stop.blockId, stop.field!, at % (len + 1))
      }
      const change = pasteBlocks(context(tree, sel), sel, pasted)
      if (!change) return
      const next = check(tree, change)
      const clipText = flatText(clip)
      // Every pasted character arrives, in order, somewhere in the document.
      let k = 0
      for (const ch of flatText(next)) if (ch === clipText[k]) k++
      expect(k).toBe(clipText.length)
    }), { numRuns: 300 })
  })

  it('Enter then Backspace at the new block gives the text back', () => {
    fc.assert(fc.property(arbDoc, fc.nat(), fc.nat(), (tree, i, at) => {
      const stop = pick(textStops(tree).filter((s) => {
        const def = editing.get(tree.nodes.get(s.blockId)!.type)
        // Captions of pictures are not main text: Enter leaves them, Backspace never joins them.
        return mainField(def)?.attr === s.field && !def?.group && !def?.fields.find((f) => f.attr === s.field)?.multiline
      }), i)
      if (!stop) return
      const value = fieldValue(tree.nodes.get(stop.blockId)!, stop.field!)
      const offset = at % (value.text.length + 1)
      const [before, after] = split(value, offset)
      const s1 = splitBlock(context(tree, caret(stop.blockId, stop.field!, offset)), stop.blockId, stop.field!, before, after)
      if (!s1 || s1.selection.kind !== 'text') return
      const mid = check(tree, s1)
      const sel = s1.selection
      if (sel.anchor !== 0) return
      const s2 = mergeBackward(context(mid, sel, 'm'), sel.blockId, sel.field)
      if (!s2) return
      const end = check(mid, s2)
      expect(reading(end).replace(/\//g, '')).toBe(reading(tree).replace(/\//g, ''))
    }), { numRuns: 300 })
  })
})

describe('examples', () => {
  const doc = (blocks: unknown[]): Tree => treeFromBlocks(validateDoc({ version: 1, blocks }, textRegistry).doc.blocks)
  const p = (id: string, text: string) => ({ id, type: 'core/paragraph', attrs: { content: { text, formats: [] } } })
  const li = (id: string, text: string, children?: unknown[]) => ({ id, type: 'core/list-item', attrs: { content: { text, formats: [] } }, ...(children ? { children } : {}) })
  const ul = (id: string, children: unknown[]) => ({ id, type: 'core/list', attrs: { style: 'bullet' }, children })
  const shape = (tree: Tree): unknown => blocksFromTree(tree).map(function s(b: Block): unknown {
    const t = (b.attrs.content as { text?: string } | undefined)?.text
    return b.children?.length ? [b.type, t ?? '', b.children.map(s)] : [b.type, t ?? '']
  })

  it('Enter splits a list item; its nested list goes with the second half', () => {
    const tree = doc([ul('l', [li('a', 'onetwo', [ul('m', [li('b', 'deep')])])])])
    const value = fieldValue(tree.nodes.get('a')!, 'content')
    const [before, after] = split(value, 3)
    const next = check(tree, splitBlock(context(tree, caret('a', 'content', 3)), 'a', 'content', before, after)!)
    expect(shape(next)).toEqual([['core/list', '', [
      ['core/list-item', 'one'],
      ['core/list-item', 'two', [['core/list', '', [['core/list-item', 'deep']]]]],
    ]]])
  })

  it('Backspace joins a list item into the one before, and its nested items follow it', () => {
    const tree = doc([ul('l', [li('a', 'one'), li('b', 'two', [ul('m', [li('c', 'deep')])])])])
    const next = check(tree, mergeBackward(context(tree, caret('b', 'content', 0)), 'b', 'content')!)
    expect(shape(next)).toEqual([['core/list', '', [['core/list-item', 'onetwo', [['core/list', '', [['core/list-item', 'deep']]]]]]]])
  })

  it('Delete at the end of a paragraph pulls in the first list item; the emptied list goes', () => {
    const tree = doc([p('a', 'x'), ul('l', [li('b', 'y')])])
    const next = check(tree, mergeForward(context(tree, caret('a', 'content', 1)), 'a', 'content')!)
    expect(shape(next)).toEqual([['core/paragraph', 'xy']])
  })

  it('outdenting a nested item takes the items after it as its children', () => {
    const tree = doc([ul('l', [li('a', 'top', [ul('m', [li('b', 'one'), li('c', 'two')])])])])
    const next = check(tree, outdentItem(context(tree, caret('b', 'content', 0)), 'b')!)
    expect(shape(next)).toEqual([['core/list', '', [
      ['core/list-item', 'top'],
      ['core/list-item', 'one', [['core/list', '', [['core/list-item', 'two']]]]],
    ]]])
  })

  it('removing every item of a list removes the list; removing everything leaves one empty paragraph', () => {
    const tree = doc([ul('l', [li('a', 'one')])])
    const change = removeBlocks(context(tree), ['a'])!
    const next = check(tree, change)
    expect(shape(next)).toEqual([['core/paragraph', '']])
    expect(change.selection).toMatchObject({ kind: 'text', anchor: 0 })
  })

  it('a code block takes text without formats when a paragraph joins it', () => {
    const tree = treeFromBlocks([
      { id: 'c', type: 'core/code', attrs: { content: createValue('x'), language: '' } },
      { id: 'p', type: 'core/paragraph', attrs: { content: createValue('bold', [{ type: 'bold', start: 0, end: 4 }]), anchor: '', textAlign: '', lang: '', dir: '' } },
    ])
    const next = check(tree, mergeBackward(context(tree, caret('p', 'content', 0)), 'p', 'content')!)
    expect(fieldValue(next.nodes.get('c')!, 'content')).toEqual({ text: 'xbold', formats: [] })
  })
})

describe('interface edits', () => {
  const kinds: readonly ShowAs[] = ['text', 'heading', 'list', 'quote']

  it('Show as keeps every character in reading order and the document valid', () => {
    fc.assert(fc.property(arbDoc, fc.nat(), fc.nat(3), (tree, i, k) => {
      const id = pick(childrenOf(tree, null), i)!
      const change = showAs(context(tree, caret(id, 'content', 0)), id, kinds[k]!)
      if (!change) return
      const next = check(tree, change)
      expect(flatText(next)).toBe(flatText(tree))
    }), { numRuns: 400 })
  })

  it('inserting new blocks after, in place of, or at the end keeps the document valid and the caret in the new text', () => {
    fc.assert(fc.property(arbDoc, fc.nat(), fc.nat(2), fc.constantFrom('core/paragraph', 'core/heading', 'core/separator', 'core/quote', 'core/list'), (tree, i, where, type) => {
      const all = [...tree.nodes.keys()]
      const id = pick(all, i)!
      const ctx = context(tree)
      const block = type === 'core/quote' ? newBlock(ctx, type, {}, [newBlock(ctx, 'core/paragraph')])
        : type === 'core/list' ? newBlock(ctx, type, { style: 'bullet' }, [newBlock(ctx, 'core/list-item')])
          : newBlock(ctx, type)
      const at = where === 0 ? { after: id } : where === 1 ? { replace: id } : 'end' as const
      const change = insertBlocks(ctx, at, [block])
      if (!change) return
      const next = check(tree, change)
      // The replaced block's text is gone; nothing else is.
      if (where !== 1) expect(flatText(next)).toBe(flatText(tree))
      const s = change.selection
      const inside = s.kind === 'text' ? s.blockId : s.kind === 'blocks' ? s.focusId : null
      expect(inside === block.id || (block.children ?? []).some((c) => c.id === inside)).toBe(true)
    }), { numRuns: 300 })
  })

  it('moving blocks anywhere the schema allows keeps their text and the document valid', () => {
    fc.assert(fc.property(arbDoc, fc.nat(), fc.nat(), fc.nat(), (tree, i, j, k) => {
      const all = [...tree.nodes.keys()]
      const id = pick(all, i)!
      const parents = [null, ...all.filter((n) => tree.children.has(n))]
      const parent = pick(parents, j)!
      const kids = childrenOf(tree, parent)
      const before = k % (kids.length + 1) === kids.length ? null : kids[k % (kids.length + 1)]!
      const change = moveBlocksTo(context(tree), [id], parent, before, NO_SELECTION)
      if (!change) return
      const next = check(tree, change)
      expect(flatText(next).length).toBe(flatText(tree).length)
      expect(next.nodes.get(id)).toEqual(tree.nodes.get(id))
    }), { numRuns: 400 })
  })
})

describe('presets and checklists', () => {
  const tree = (blocks: unknown[]): Tree => treeFromBlocks(validateDoc({ version: 1, blocks }, textRegistry).doc.blocks)
  const t = tree([{ id: 'p', type: 'core/paragraph', attrs: { content: { text: 'x', formats: [] } } },
    { id: 'l', type: 'core/list', attrs: { style: 'check' }, children: [{ id: 'i', type: 'core/list-item', attrs: { content: { text: 'Milk', formats: [] } } }] }])

  it('Show as offers only what the preset offers', () => {
    const basic = { ...context(t, caret('p', 'content', 0)), offers: (id: string) => id !== 'core/quote' }
    expect(showAs(basic, 'p', 'quote')).toBeNull()
    expect(showAs(basic, 'p', 'heading')).not.toBeNull()
  })

  it('a checklist item is ticked and unticked, with an announcement', () => {
    const on = toggleCheck(context(t, caret('i', 'content', 0)), 'i')!
    expect(on.ops).toEqual([{ type: 'setAttrs', id: 'i', patch: { checked: true } }])
    expect(on.announce).toBe(en.checked)
    expect(toggleCheck(context(t), 'p')).toBeNull()
  })
})

