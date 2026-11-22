/**
 * Operations: the only way to change a document.
 *
 * Each operation applied to a tree returns a new tree and its inverse: a list
 * of operations that, applied in order to the new tree, give back the old one.
 * Operations check structure (ids, containers, positions), not the schema.
 */
import {
  type Attrs, type Block, type BlockNode, type ParentId, type Tree, TreeError,
  addBlocks, childrenOf, getBlock, isContainer, isSelfOrAncestor, parentOf, subtreeIds, topmost,
} from './tree'

export type Operation =
  /** Add `blocks` (nested) into `parentId` before the child at `index`. */
  | { readonly type: 'insertBlocks'; readonly parentId: ParentId; readonly index: number; readonly blocks: readonly Block[] }
  /** Delete blocks with their children. */
  | { readonly type: 'removeBlocks'; readonly ids: readonly string[] }
  /** Take the blocks out, keeping their document order, then insert them into `parentId` at `index` of what is left. */
  | { readonly type: 'moveBlocks'; readonly ids: readonly string[]; readonly parentId: ParentId; readonly index: number }
  /** Shallow merge into the attributes. A key set to undefined is removed. */
  | { readonly type: 'setAttrs'; readonly id: string; readonly patch: Attrs }
  /** Remove `ids`, then insert `blocks` where the first of them was (transform, split, merge). */
  | { readonly type: 'replaceBlocks'; readonly ids: readonly string[]; readonly blocks: readonly Block[] }

export interface Applied {
  readonly tree: Tree
  readonly inverse: readonly Operation[]
}

export class OperationError extends Error {
  override name = 'OperationError'
}

export function applyOperation(tree: Tree, op: Operation): Applied {
  try {
    switch (op.type) {
      case 'insertBlocks': return insert(tree, op.parentId, op.index, op.blocks)
      case 'removeBlocks': return remove(tree, op.ids)
      case 'moveBlocks': return move(tree, op.ids, op.parentId, op.index)
      case 'setAttrs': return setAttrs(tree, op.id, op.patch)
      case 'replaceBlocks': return replace(tree, op.ids, op.blocks)
    }
  } catch (e) {
    if (e instanceof TreeError) throw new OperationError(`${op.type}: ${e.message}`, { cause: e })
    throw e
  }
}

/** Apply in order. The inverse undoes all of them: the last operation's inverse comes first. */
export function applyOperations(tree: Tree, ops: readonly Operation[]): Applied {
  let t = tree
  const inverses: (readonly Operation[])[] = []
  for (const op of ops) {
    const r = applyOperation(t, op)
    t = r.tree
    inverses.push(r.inverse)
  }
  return { tree: t, inverse: inverses.reverse().flat() }
}

// ---------------------------------------------------------------------------

/** Mutable copies of the maps an operation changes. Never escape before being frozen into a Tree. */
// shortcut: copies whole maps, O(blocks) per operation; measure against the 2,000-block budget and switch to a persistent map if it shows.
function draft(tree: Tree) {
  return { nodes: new Map(tree.nodes), children: new Map(tree.children), parents: new Map(tree.parents) }
}

function checkIndex(index: number, length: number): void {
  if (!Number.isInteger(index) || index < 0 || index > length) throw new TreeError(`Index ${index} outside 0..${length}`)
}

function checkContainer(tree: Tree, parentId: ParentId): void {
  if (!isContainer(tree, parentId)) throw new TreeError(parentId === null ? 'Tree has no root' : `Block ${parentId} is not a container`)
}

function insert(tree: Tree, parentId: ParentId, index: number, blocks: readonly Block[]): Applied {
  checkContainer(tree, parentId)
  const siblings = childrenOf(tree, parentId)
  checkIndex(index, siblings.length)
  const d = draft(tree)
  const ids = addBlocks(d.nodes, d.children, d.parents, blocks, parentId)
  d.children.set(parentId, [...siblings.slice(0, index), ...ids, ...siblings.slice(index)])
  return { tree: d, inverse: ids.length > 0 ? [{ type: 'removeBlocks', ids }] : [] }
}

function remove(tree: Tree, ids: readonly string[]): Applied {
  const order = topmost(tree, ids)
  // Positions before anything is removed. Re-inserting in document order at these
  // indexes is exact: every earlier sibling is back by the time a block returns.
  const places = order.map((id) => {
    const parentId = parentOf(tree, id)
    return { id, parentId, index: childrenOf(tree, parentId).indexOf(id), block: getBlock(tree, id) }
  })
  const d = draft(tree)
  for (const { id, parentId } of places) {
    d.children.set(parentId, d.children.get(parentId)!.filter((k) => k !== id))
    for (const k of subtreeIds(tree, id)) { d.nodes.delete(k); d.children.delete(k); d.parents.delete(k) }
  }
  // One insert per run of adjacent siblings.
  const inverse: { type: 'insertBlocks'; parentId: ParentId; index: number; blocks: Block[] }[] = []
  for (const p of places) {
    const last = inverse.at(-1)
    if (last && last.parentId === p.parentId && last.index + last.blocks.length === p.index) last.blocks.push(p.block)
    else inverse.push({ type: 'insertBlocks', parentId: p.parentId, index: p.index, blocks: [p.block] })
  }
  return { tree: d, inverse }
}

function move(tree: Tree, ids: readonly string[], parentId: ParentId, index: number): Applied {
  const order = topmost(tree, ids)
  // Where each block came from, as the sibling it followed.
  const origins = order.map((id) => {
    const from = parentOf(tree, id)
    const siblings = childrenOf(tree, from)
    return { id, from, after: siblings[siblings.indexOf(id) - 1] ?? null }
  })
  const result = relocate(tree, order, parentId, index)

  // Inverse: send each block back after its old predecessor, in old document order.
  // The predecessor is either unmoved or already back, so each step is exact.
  const inverse: Operation[] = []
  let t = result
  for (const { id, from, after } of origins) {
    const rest = childrenOf(t, from).filter((k) => k !== id)
    const back = after === null ? 0 : rest.indexOf(after) + 1
    inverse.push({ type: 'moveBlocks', ids: [id], parentId: from, index: back })
    t = relocate(t, [id], from, back)
  }
  return { tree: result, inverse }
}

/** Move `order` (topmost, in document order) into `parentId` at `index` of the remaining children. */
function relocate(tree: Tree, order: readonly string[], parentId: ParentId, index: number): Tree {
  checkContainer(tree, parentId)
  if (parentId !== null && order.some((id) => isSelfOrAncestor(tree, id, parentId))) {
    throw new TreeError(`Cannot move a block into itself (${parentId})`)
  }
  const moved = new Set(order)
  const children = new Map(tree.children)
  const parents = new Map(tree.parents)
  for (const id of order) {
    const from = parentOf(tree, id)
    children.set(from, children.get(from)!.filter((k) => !moved.has(k)))
  }
  const target = children.get(parentId)!
  checkIndex(index, target.length)
  children.set(parentId, [...target.slice(0, index), ...order, ...target.slice(index)])
  for (const id of order) parents.set(id, parentId)
  return { nodes: tree.nodes, children, parents }
}

function setAttrs(tree: Tree, id: string, patch: Attrs): Applied {
  const node = tree.nodes.get(id)
  if (!node) throw new TreeError(`No block ${id}`)
  const undo: Record<string, unknown> = {}
  for (const k of Object.keys(patch)) undo[k] = node.attrs[k]
  const merged = Object.entries({ ...node.attrs, ...patch }).filter(([, v]) => v !== undefined)
  const attrs = Object.fromEntries(merged)
  const nodes = new Map(tree.nodes)
  nodes.set(id, { ...node, attrs } satisfies BlockNode)
  return { tree: { ...tree, nodes }, inverse: [{ type: 'setAttrs', id, patch: undo }] }
}

function replace(tree: Tree, ids: readonly string[], blocks: readonly Block[]): Applied {
  const order = topmost(tree, ids)
  const first = order[0]
  if (first === undefined) throw new TreeError('Nothing to replace')
  const parentId = parentOf(tree, first)
  // No removed block precedes the first one in its parent, so its index survives the removal.
  const index = childrenOf(tree, parentId).indexOf(first)
  const removed = remove(tree, order)
  const inserted = insert(removed.tree, parentId, index, blocks)
  return { tree: inserted.tree, inverse: [...inserted.inverse, ...removed.inverse] }
}
