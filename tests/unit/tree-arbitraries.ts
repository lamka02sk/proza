/** Generators and checks for block trees, shared by model property tests. */
import { expect } from 'vitest'
import fc from 'fast-check'
import type { Operation } from '../../src/model/operations'
import { type Block, type ParentId, type Tree, childrenOf, topmost, treeFromBlocks } from '../../src/model/tree'

// Shapes first, ids after, so every generated tree is valid.

export interface Shape { readonly container: boolean; readonly children: readonly Shape[] }

const { shapes } = fc.letrec<{ shape: Shape; shapes: Shape[] }>((tie) => ({
  shape: fc.oneof(
    { depthSize: 'small', withCrossShrink: true },
    fc.constant<Shape>({ container: false, children: [] }),
    fc.array(tie('shape'), { maxLength: 3 }).map((children): Shape => ({ container: true, children })),
  ),
  shapes: fc.array(tie('shape'), { maxLength: 5 }),
}))

export function build(list: readonly Shape[], next: () => string): Block[] {
  return list.map((s) => {
    const id = next()
    const attrs = { n: id }
    return s.container ? { id, type: 'c', attrs, children: build(s.children, next) } : { id, type: 'l', attrs }
  })
}

export function counter(prefix: string): () => string {
  let n = 0
  return () => `${prefix}${++n}`
}

export const arbTree: fc.Arbitrary<Tree> = shapes.map((s) => treeFromBlocks(build(s, counter('b'))))

/** Numbers that pick an operation against whatever the tree is at that point. */
export interface Seed { kind: number; a: number; b: number; c: number; d: number; shapes: Shape[] }
export const arbSeed: fc.Arbitrary<Seed> = fc.record({
  kind: fc.nat(4), a: fc.nat(), b: fc.nat(), c: fc.nat(), d: fc.nat(),
  shapes,
})

export function allIds(tree: Tree, parent: ParentId = null): string[] {
  return childrenOf(tree, parent).flatMap((id) => [id, ...(tree.children.has(id) ? allIds(tree, id) : [])])
}

/** A valid operation for `tree`, or null when the tree is too small for this kind. */
export function opFrom(tree: Tree, s: Seed, fresh: () => string): Operation | null {
  const ids = allIds(tree)
  const containers: ParentId[] = [null, ...ids.filter((id) => tree.children.has(id))]
  const pick = (n: number): string => ids[n % ids.length]!
  const some = (): string[] => [pick(s.a), pick(s.b), pick(s.c)].slice(0, 1 + (s.d % 3))
  switch (s.kind) {
    case 0: {
      const parentId = containers[s.a % containers.length]!
      return { type: 'insertBlocks', parentId, index: s.b % (childrenOf(tree, parentId).length + 1), blocks: build(s.shapes, fresh) }
    }
    case 1: return ids.length === 0 ? null : { type: 'removeBlocks', ids: some() }
    case 2: {
      if (ids.length === 0) return null
      const moving = topmost(tree, some())
      const inside = new Set(moving.flatMap((id) => [id, ...(tree.children.has(id) ? allIds(tree, id) : [])]))
      const targets = containers.filter((c) => c === null || !inside.has(c))
      const parentId = targets[s.b % targets.length]!
      const rest = childrenOf(tree, parentId).filter((k) => !moving.includes(k))
      return { type: 'moveBlocks', ids: some(), parentId, index: s.c % (rest.length + 1) }
    }
    case 3: return ids.length === 0 ? null : { type: 'setAttrs', id: pick(s.a), patch: { n: s.b % 2 === 0 ? undefined : s.c, x: s.d } }
    default: return ids.length === 0 ? null : { type: 'replaceBlocks', ids: some(), blocks: build(s.shapes, fresh) }
  }
}

/** Structural invariants of a Tree. */
export function checkTree(tree: Tree): void {
  expect(tree.children.has(null)).toBe(true)
  const seen = new Map<string, ParentId>()
  for (const [parent, kids] of tree.children) {
    if (parent !== null) expect(tree.nodes.has(parent)).toBe(true)
    for (const k of kids) {
      expect(seen.has(k)).toBe(false)
      seen.set(k, parent)
    }
  }
  expect(seen.size).toBe(tree.nodes.size)
  expect(tree.parents.size).toBe(tree.nodes.size)
  for (const [id, node] of tree.nodes) {
    expect(node.id).toBe(id)
    expect(tree.parents.get(id)).toBe(seen.get(id))
  }
  // Every block is reachable from the root, so there are no cycles.
  expect(allIds(tree).length).toBe(tree.nodes.size)
}

