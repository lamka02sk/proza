import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { treeChanges } from './changes'
import { applyOperations, type Operation } from './operations'
import type { ParentId, Tree } from './tree'
import { arbSeed, arbTree, counter, opFrom } from '../../tests/unit/tree-arbitraries'

/** The same answer by comparing every block of both trees. */
function fullDiff(a: Tree, b: Tree): { added: string[]; removed: string[]; updated: string[]; order: string[] } {
  const ids = new Set([...a.nodes.keys(), ...b.nodes.keys()])
  const added = [...ids].filter((id) => !a.nodes.has(id))
  const removed = [...ids].filter((id) => !b.nodes.has(id))
  const updated = [...ids].filter((id) => a.nodes.has(id) && b.nodes.has(id) && a.nodes.get(id) !== b.nodes.get(id))
  const parents = new Set<ParentId>([...a.children.keys(), ...b.children.keys()])
  const order = [...parents].filter((p) => (p === null || b.nodes.has(p))
    && JSON.stringify(p === null || a.nodes.has(p) ? a.children.get(p) ?? [] : []) !== JSON.stringify(b.children.get(p) ?? []))
  return { added, removed, updated, order: order.map(String) }
}

describe('treeChanges', () => {
  it('finds from the operations what a full comparison of the trees finds', () => {
    fc.assert(fc.property(arbTree, fc.array(arbSeed, { minLength: 1, maxLength: 6 }), (start, seeds) => {
      const fresh = counter('n')
      const ops: Operation[] = []
      let tree = start
      for (const seed of seeds) {
        const op = opFrom(tree, seed, fresh)
        if (!op) continue
        ops.push(op)
        tree = applyOperations(tree, [op]).tree
      }
      const got = treeChanges(start, tree, ops)
      const want = fullDiff(start, tree)
      const sorted = (xs: readonly string[]): string[] => [...xs].sort()
      expect(sorted(got.added.map((n) => n.id))).toEqual(sorted(want.added))
      expect(sorted(got.removed.map((n) => n.id))).toEqual(sorted(want.removed))
      expect(sorted(got.updated.map((u) => u.id))).toEqual(sorted(want.updated))
      expect(sorted(got.order.map((o) => String(o.parent)))).toEqual(sorted(want.order))
      for (const o of got.order) expect(o.after).toEqual(tree.children.get(o.parent) ?? [])
    }), { numRuns: 1000 })
  })
})
