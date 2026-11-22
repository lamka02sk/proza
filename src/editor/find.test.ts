import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { applyOperations } from '../model/operations'
import { type RichTextValue, createValue } from '../model/richtext'
import { type Block, treeFromBlocks } from '../model/tree'
import { editingRegistry, fieldValue } from './editing'
import { findMatches, findPattern, matchAfter, matchesIn, replaceMatches } from './find'
import { en } from './locale-en'

const editing = editingRegistry([
  { name: 'core/paragraph', fields: [{ attr: 'content' }], title: () => 'Text' },
  { name: 'core/quote', fields: [{ attr: 'citation', after: true, optional: true }], title: () => 'Quote' },
])
const p = (id: string, text: string | RichTextValue): Block => ({ id, type: 'core/paragraph', attrs: { content: typeof text === 'string' ? createValue(text) : text } })
const ctx = (blocks: Block[]) => ({ tree: treeFromBlocks(blocks), editing, current: null, strings: en })

describe('find', () => {
  it('ignores case but not accents by default', () => {
    expect(matchesIn('Kôň a kon, KON', findPattern('kon')!)).toEqual([{ start: 6, end: 9 }, { start: 11, end: 14 }])
    expect(matchesIn('Kon kon', findPattern('Kon', { matchCase: true })!)).toEqual([{ start: 0, end: 3 }])
  })

  it('whole words: letters of any script and digits are word characters', () => {
    expect(matchesIn('art party art3 žart art', findPattern('art', { wholeWords: true })!)).toEqual([{ start: 0, end: 3 }, { start: 20, end: 23 }])
  })

  it('treats the query as text, not a pattern', () => {
    expect(matchesIn('a.b axb (c)', findPattern('a.b')!)).toEqual([{ start: 0, end: 3 }])
    expect(matchesIn('a.b axb (c)', findPattern('(c)')!)).toEqual([{ start: 8, end: 11 }])
  })

  it('lists matches in reading order, citations after the quote text', () => {
    const quote: Block = { id: 'q', type: 'core/quote', attrs: { citation: createValue('one more') }, children: [p('qp', 'one')] }
    const found = findMatches(ctx([p('a', 'one two one'), quote, p('b', 'none')]), 'one')
    expect(found.map((m) => `${m.blockId}:${m.field}:${m.start}`)).toEqual(['a:content:0', 'a:content:8', 'qp:content:0', 'q:citation:0', 'b:content:1'])
  })

  it('starts after the caret', () => {
    const c = ctx([p('a', 'x x'), p('b', 'x')])
    const found = findMatches(c, 'x')
    expect(matchAfter(c, found, { kind: 'text', blockId: 'a', field: 'content', anchor: 1, focus: 1 })).toBe(1)
    expect(matchAfter(c, found, { kind: 'text', blockId: 'b', field: 'content', anchor: 1, focus: 1 })).toBe(0)
  })
})

describe('replace', () => {
  it('replaces every match as one change, keeping the formats of the replaced text', () => {
    const bold: RichTextValue = { text: 'cat and cat', formats: [{ type: 'bold', start: 8, end: 11 }] }
    const c = ctx([p('a', bold), p('b', 'a cat')])
    const change = replaceMatches(c, findMatches(c, 'cat'), 'dog', () => true)!
    const tree = applyOperations(c.tree, change.ops).tree
    expect(fieldValue(tree.nodes.get('a')!, 'content')).toEqual({ text: 'dog and dog', formats: [{ type: 'bold', start: 8, end: 11 }] })
    expect(fieldValue(tree.nodes.get('b')!, 'content').text).toBe('a dog')
    expect(change.announce).toBe('Replaced 3 matches')
    expect(change.selection).toEqual({ kind: 'text', blockId: 'b', field: 'content', anchor: 5, focus: 5 })
  })

  it('skips a match whose text changed since it was found', () => {
    const c = ctx([p('a', 'cat cow')])
    expect(replaceMatches(c, [{ blockId: 'a', field: 'content', start: 4, end: 7 }], 'dog', (s) => s === 'cat')).toBeNull()
  })

  it('property: replacing every match leaves no match of a query the replacement does not contain', () => {
    fc.assert(fc.property(fc.array(fc.stringMatching(/^[ab ]{0,8}$/), { minLength: 1, maxLength: 4 }), fc.stringMatching(/^[ab]{1,2}$/), (texts, query) => {
      const c = ctx(texts.map((t, i) => p(`p${i}`, t)))
      const found = findMatches(c, query)
      const change = replaceMatches(c, found, 'X', () => true)
      if (found.length === 0) { expect(change).toBeNull(); return }
      const after = { ...c, tree: applyOperations(c.tree, change!.ops).tree }
      expect(findMatches(after, query)).toEqual([])
      expect(findMatches(after, 'X')).toHaveLength(found.length)
    }), { numRuns: 300 })
  })
})
