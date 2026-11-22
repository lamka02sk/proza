import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { type History, type Origin, type Transaction, emptyHistory, record, redo, transact, undo } from './history'
import type { Operation } from './operations'
import { type Tree, blocksFromTree, treeFromBlocks } from './tree'
import { arbSeed, arbTree, counter, opFrom } from '../../tests/unit/tree-arbitraries'

const arbOrigin = fc.constantFrom<Origin>('typing', 'paste', 'command', 'import')

describe('history', () => {
  it('undo walks back through every recorded step, redo walks forward again', () => {
    fc.assert(fc.property(arbTree, fc.array(fc.tuple(arbSeed, arbOrigin, fc.nat(3000), fc.constantFrom('', 'a', ' ', 'b ')), { maxLength: 12 }), (start, steps) => {
      const fresh = counter('n')
      let tree = start
      let history: History<number> = emptyHistory()
      let time = 0
      // states[i] is the tree before done[i]; selections are step numbers.
      const states: Tree[] = []
      steps.forEach(([seed, origin, gap, inserted], i) => {
        const op = opFrom(tree, seed, fresh)
        if (!op) return
        time += gap
        const typing = origin === 'typing' && op.type === 'setAttrs' ? { key: op.id, inserted } : undefined
        const r = transact(tree, [op], { origin, before: i, after: i + 1, time, ...(typing ? { typing } : {}) })
        const before = history.done.length
        history = record(history, r.transaction)
        if (history.done.length > before) states.push(tree)
        tree = r.tree
      })
      const end = tree
      for (let i = states.length - 1; i >= 0; i--) {
        const u = undo(history, tree)!
        expect(blocksFromTree(u.tree)).toEqual(blocksFromTree(states[i]!))
        ;({ tree, history } = u)
      }
      expect(undo(history, tree)).toBeNull()
      for (;;) {
        const r = redo(history, tree)
        if (!r) break
        ;({ tree, history } = r)
      }
      expect(blocksFromTree(tree)).toEqual(blocksFromTree(end))
    }))
  })

  const base = treeFromBlocks([{ id: 'p', type: 'l', attrs: { text: '' } }, { id: 'q', type: 'l', attrs: { text: '' } }])

  /** Type `chunks` into p (or the given block), one transaction each, at the given times. */
  function typeInto(chunks: [string, number, string?][]): { tree: Tree; history: History<string> } {
    let tree = base
    let history = emptyHistory<string>()
    let text = ''
    for (const [chunk, time, id = 'p'] of chunks) {
      text = chunk === '\b' ? text.slice(0, -1) : text + chunk
      const op: Operation = { type: 'setAttrs', id, patch: { text } }
      const r = transact(tree, [op], { origin: 'typing', before: `${time}<`, after: `${time}>`, time, typing: { key: id, inserted: chunk === '\b' ? '' : chunk } })
      history = record(history, r.transaction)
      tree = r.tree
    }
    return { tree, history }
  }

  const steps = (h: { readonly done: readonly unknown[] }): number => h.done.length

  it('merges typing within a word into one step of one operation', () => {
    const { history } = typeInto([['h', 0], ['e', 100], ['y', 200]])
    expect(steps(history)).toBe(1)
    const tx = history.done[0]!
    expect(tx.ops).toEqual([{ type: 'setAttrs', id: 'p', patch: { text: 'hey' } }])
    expect(tx.inverse).toEqual([{ type: 'setAttrs', id: 'p', patch: { text: '' } }])
    expect([tx.before, tx.after]).toEqual(['0<', '200>'])
  })

  it('starts a new step at a word boundary', () => {
    const { history } = typeInto([['a', 0], [' ', 100], ['b', 200], ['c', 300]])
    expect(steps(history)).toBe(2)
    expect(history.done.map((t) => t.typing?.inserted)).toEqual(['a ', 'bc'])
  })

  it('starts a new step after a pause', () => {
    expect(steps(typeInto([['a', 0], ['b', 1001]]).history)).toBe(2)
    expect(steps(typeInto([['a', 0], ['b', 1000]]).history)).toBe(1)
  })

  it('starts a new step when switching between typing and deleting', () => {
    expect(steps(typeInto([['a', 0], ['b', 100], ['\b', 200], ['\b', 300], ['c', 400]]).history)).toBe(3)
  })

  it('does not merge typing in different blocks', () => {
    expect(steps(typeInto([['a', 0, 'p'], ['b', 100, 'q']]).history)).toBe(2)
  })

  it('does not merge other origins', () => {
    let h = emptyHistory<null>()
    for (const origin of ['command', 'command'] as const) {
      const { transaction } = transact(base, [{ type: 'setAttrs', id: 'p', patch: { text: 'x' } }], { origin, before: null, after: null, time: 0 })
      h = record(h, transaction)
    }
    expect(steps(h)).toBe(2)
  })

  it('keeps the last 1,000 steps', () => {
    let h = emptyHistory<null>()
    for (let i = 0; i < 1005; i++) {
      const { transaction } = transact(base, [{ type: 'setAttrs', id: 'p', patch: { text: String(i) } }], { origin: 'command', before: null, after: null, time: i })
      h = record(h, transaction)
    }
    expect(steps(h)).toBe(1000)
    expect(h.done[0]!.time).toBe(5)
  })

  it('recording clears redo; empty transactions are ignored', () => {
    const { tree, history } = typeInto([['a', 0]])
    const u = undo(history, tree)!
    expect(u.history.undone).toHaveLength(1)
    const empty: Transaction<string> = { ops: [], inverse: [], origin: 'command', before: '', after: '', time: 0 }
    expect(record(u.history, empty)).toBe(u.history)
    const { transaction } = transact(u.tree, [{ type: 'setAttrs', id: 'q', patch: { text: 'z' } }], { origin: 'command', before: '', after: '', time: 5 })
    expect(record(u.history, transaction).undone).toEqual([])
  })

  it('undo returns the selection before, redo the selection after', () => {
    const { tree, history } = typeInto([['a', 0]])
    const u = undo(history, tree)!
    expect(u.selection).toBe('0<')
    expect(redo(u.history, u.tree)!.selection).toBe('0>')
  })
})
