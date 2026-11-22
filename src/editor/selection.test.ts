import { describe, expect, it } from 'vitest'
import { treeFromBlocks } from '../model/tree'
import { blocks, liftToSiblings, selectedBlocks } from './selection'
import { excerpt } from './strings'

const tree = treeFromBlocks([
  { id: 'p', type: 'x', attrs: {} },
  { id: 'l', type: 'x', attrs: {}, children: [
    { id: 'i1', type: 'x', attrs: {}, children: [] },
    { id: 'i2', type: 'x', attrs: {}, children: [{ id: 'm', type: 'x', attrs: {}, children: [{ id: 'd', type: 'x', attrs: {} }] }] },
  ] },
  { id: 'q', type: 'x', attrs: {} },
])

describe('block selection', () => {
  it('siblings stay siblings, in either direction', () => {
    expect(selectedBlocks(tree, blocks('i2', 'i1'))).toEqual(['i1', 'i2'])
  })

  it('crossing a container boundary selects the container', () => {
    expect(selectedBlocks(tree, blocks('d', 'q'))).toEqual(['l', 'q'])
    expect(liftToSiblings(tree, 'p', 'd')).toEqual({ parent: null, anchor: 'p', focus: 'l' })
  })

  it('a block and its ancestor select the ancestor', () => {
    expect(selectedBlocks(tree, blocks('l', 'd'))).toEqual(['l'])
  })

  it('missing blocks select nothing', () => {
    expect(selectedBlocks(tree, blocks('gone', 'p'))).toEqual([])
  })
})

describe('excerpt', () => {
  it('cuts at a word, drops object characters and collapses spaces', () => {
    expect(excerpt('Proza is a block editor written from scratch', 40)).toBe('Proza is a block editor written from…')
    expect(excerpt('a￼  b')).toBe('a b')
  })
})
