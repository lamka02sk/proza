import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { type Operation, OperationError, applyOperation, applyOperations } from './operations'
import { blocksFromTree, childrenOf, treeFromBlocks } from './tree'
import { arbSeed, arbTree, checkTree, counter, opFrom } from '../../tests/unit/tree-arbitraries'

// ---------------------------------------------------------------------------

describe('operations', () => {
  it('keep the tree invariants, and each inverse restores the tree before it', () => {
    fc.assert(fc.property(arbTree, fc.array(arbSeed, { maxLength: 12 }), (start, seeds) => {
      const fresh = counter('n')
      let tree = start
      for (const s of seeds) {
        const op = opFrom(tree, s, fresh)
        if (!op) continue
        const r = applyOperation(tree, op)
        checkTree(r.tree)
        const back = applyOperations(r.tree, r.inverse)
        checkTree(back.tree)
        expect(blocksFromTree(back.tree)).toEqual(blocksFromTree(tree))
        tree = r.tree
      }
    }))
  })

  it('a sequence inverts as a whole', () => {
    fc.assert(fc.property(arbTree, fc.array(arbSeed, { maxLength: 12 }), (start, seeds) => {
      const fresh = counter('n')
      const ops: Operation[] = []
      let tree = start
      for (const s of seeds) {
        const op = opFrom(tree, s, fresh)
        if (!op) continue
        ops.push(op)
        tree = applyOperation(tree, op).tree
      }
      const forward = applyOperations(start, ops)
      expect(blocksFromTree(forward.tree)).toEqual(blocksFromTree(tree))
      expect(blocksFromTree(applyOperations(forward.tree, forward.inverse).tree)).toEqual(blocksFromTree(start))
    }))
  })

  it('leave unchanged blocks as the same objects', () => {
    const tree = treeFromBlocks([{ id: 'a', type: 'l', attrs: {} }, { id: 'b', type: 'l', attrs: {} }])
    const r = applyOperation(tree, { type: 'setAttrs', id: 'b', patch: { x: 1 } })
    expect(r.tree.nodes.get('a')).toBe(tree.nodes.get('a'))
    expect(r.tree.nodes.get('b')).not.toBe(tree.nodes.get('b'))
    expect(tree.nodes.get('b')!.attrs).toEqual({})
  })

  const tree = treeFromBlocks([
    { id: 'a', type: 'l', attrs: {} },
    { id: 'c', type: 'c', attrs: {}, children: [{ id: 'd', type: 'l', attrs: {} }] },
  ])

  it.each<[string, Operation]>([
    ['insert into a leaf', { type: 'insertBlocks', parentId: 'a', index: 0, blocks: [] }],
    ['insert past the end', { type: 'insertBlocks', parentId: null, index: 3, blocks: [] }],
    ['insert a repeated id', { type: 'insertBlocks', parentId: null, index: 0, blocks: [{ id: 'd', type: 'l', attrs: {} }] }],
    ['insert an invalid id', { type: 'insertBlocks', parentId: null, index: 0, blocks: [{ id: 'a b', type: 'l', attrs: {} }] }],
    ['remove an unknown block', { type: 'removeBlocks', ids: ['zz'] }],
    ['move a block into itself', { type: 'moveBlocks', ids: ['c'], parentId: 'c', index: 0 }],
    ['move to a missing parent', { type: 'moveBlocks', ids: ['a'], parentId: 'zz', index: 0 }],
    ['set attributes of an unknown block', { type: 'setAttrs', id: 'zz', patch: {} }],
    ['replace nothing', { type: 'replaceBlocks', ids: [], blocks: [] }],
  ])('reject: %s', (_name, op) => {
    expect(() => applyOperation(tree, op)).toThrow(OperationError)
  })

  it('moves keep the document order of the moved blocks', () => {
    const t = treeFromBlocks(['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, type: 'l', attrs: {} })))
    const r = applyOperation(t, { type: 'moveBlocks', ids: ['d', 'b'], parentId: null, index: 0 })
    expect(childrenOf(r.tree, null)).toEqual(['b', 'd', 'a', 'c', 'e'])
  })

  it('replace puts the new blocks where the first replaced block was', () => {
    const t = treeFromBlocks(['a', 'b', 'c'].map((id) => ({ id, type: 'l', attrs: {} })))
    const r = applyOperation(t, { type: 'replaceBlocks', ids: ['c', 'b'], blocks: [{ id: 'x', type: 'l', attrs: {} }] })
    expect(childrenOf(r.tree, null)).toEqual(['a', 'x'])
  })
})
