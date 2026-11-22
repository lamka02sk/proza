import { describe, expect, it } from 'vitest'
import { type Block, treeFromBlocks } from '../model/tree'
import { frozen, lockViolation } from './locks'

const p = (id: string, lock = ''): Block => ({ id, type: 'p', attrs: { lock } })
const box = (id: string, lock: string, children: Block[]): Block => ({ id, type: 'box', attrs: { lock }, children })
const tree = treeFromBlocks([p('free'), p('pinned', 'move'), box('frozen', 'all', [p('inside')]), box('holder', '', [p('kid', 'move')])])

describe('locks', () => {
  it('a part locked in place is not moved, removed or replaced; its text may change', () => {
    expect(lockViolation(tree, [{ type: 'removeBlocks', ids: ['pinned'] }])).toBe('move')
    expect(lockViolation(tree, [{ type: 'moveBlocks', ids: ['pinned'], parentId: null, index: 0 }])).toBe('move')
    expect(lockViolation(tree, [{ type: 'replaceBlocks', ids: ['pinned'], blocks: [] }])).toBe('move')
    expect(lockViolation(tree, [{ type: 'setAttrs', id: 'pinned', patch: { text: 'x' } }])).toBeNull()
  })

  it('a container holding a locked part cannot go either', () => {
    expect(lockViolation(tree, [{ type: 'removeBlocks', ids: ['holder'] }])).toBe('move')
  })

  it('nothing in a part locked whole changes; its lock may', () => {
    expect(frozen(tree, 'inside')).toBe(true)
    expect(lockViolation(tree, [{ type: 'setAttrs', id: 'inside', patch: { text: 'x' } }])).toBe('edit')
    expect(lockViolation(tree, [{ type: 'insertBlocks', parentId: 'frozen', index: 0, blocks: [p('new')] }])).toBe('edit')
    expect(lockViolation(tree, [{ type: 'removeBlocks', ids: ['inside'] }])).toBe('move')
    expect(lockViolation(tree, [{ type: 'setAttrs', id: 'frozen', patch: { lock: '' } }])).toBeNull()
  })

  it('free parts are free', () => {
    expect(lockViolation(tree, [{ type: 'removeBlocks', ids: ['free'] }, { type: 'insertBlocks', parentId: null, index: 0, blocks: [p('n')] }])).toBeNull()
  })
})
