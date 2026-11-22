/**
 * What one transaction did to the tree (`blocksChange`):
 * blocks added, removed and updated, and the child order of each parent whose
 * children changed. Found from the operations, so a keystroke looks at one
 * block and never walks the document.
 */
import type { Operation } from './operations'
import type { Block, BlockNode, ParentId, Tree } from './tree'

export interface BlockUpdate {
  readonly id: string
  readonly before: BlockNode
  readonly after: BlockNode
}

/** A parent whose children changed; `parent` null is the document. An insertion shows here as the new order. */
export interface OrderChange {
  readonly parent: ParentId
  readonly before: readonly string[]
  readonly after: readonly string[]
}

export interface TreeChanges {
  readonly added: readonly BlockNode[]
  readonly removed: readonly BlockNode[]
  readonly updated: readonly BlockUpdate[]
  readonly order: readonly OrderChange[]
}

const sameList = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i])

/**
 * The changes from `before` to `after`, where `ops` (applied in order) took one
 * to the other. A block added and removed again within `ops` is in neither tree
 * and not reported. A block that kept its id is an update, whatever changed.
 */
export function treeChanges(before: Tree, after: Tree, ops: readonly Operation[]): TreeChanges {
  const ids = new Set<string>()
  const parents = new Set<ParentId>()
  const walk = (tree: Tree, id: string): void => {
    if (!tree.nodes.has(id)) return
    ids.add(id)
    const kids = tree.children.get(id)
    if (kids) { parents.add(id); for (const k of kids) walk(tree, k) }
  }
  const walkBoth = (id: string): void => { walk(before, id); walk(after, id) }
  const walkBlocks = (blocks: readonly Block[]): void => {
    for (const b of blocks) { ids.add(b.id); if (b.children) { parents.add(b.id); walkBlocks(b.children) } }
  }
  for (const op of ops) {
    switch (op.type) {
      case 'setAttrs': ids.add(op.id); break
      case 'insertBlocks': parents.add(op.parentId); walkBlocks(op.blocks); break
      case 'removeBlocks': for (const id of op.ids) walkBoth(id); break
      case 'moveBlocks': parents.add(op.parentId); for (const id of op.ids) ids.add(id); break
      case 'replaceBlocks': for (const id of op.ids) walkBoth(id); walkBlocks(op.blocks); break
    }
  }
  // A block removed with a container it was moved into within `ops`: its own children went with it.
  for (const id of [...ids]) if (!after.nodes.has(id)) walk(before, id)
  // A block that came, went or moved changed its parent's order, in either tree.
  for (const id of ids) {
    const was = before.parents.get(id)
    const is = after.parents.get(id)
    if (was !== undefined) parents.add(was)
    if (is !== undefined) parents.add(is)
  }

  const added: BlockNode[] = []
  const removed: BlockNode[] = []
  const updated: BlockUpdate[] = []
  for (const id of ids) {
    const a = before.nodes.get(id)
    const b = after.nodes.get(id)
    if (a && b) { if (a !== b) updated.push({ id, before: a, after: b }) } else if (b) added.push(b)
    else if (a) removed.push(a)
  }
  const order: OrderChange[] = []
  for (const parent of parents) {
    // A parent that is gone takes its children with it: its removal says enough.
    if (parent !== null && !after.nodes.has(parent)) continue
    const was = parent === null || before.nodes.has(parent) ? before.children.get(parent) ?? [] : []
    const is = after.children.get(parent) ?? []
    if (!sameList(was, is)) order.push({ parent, before: was, after: is })
  }
  return { added, removed, updated, order }
}
