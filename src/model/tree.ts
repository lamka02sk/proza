/**
 * The block tree.
 *
 * `Block` is the nested JSON form. `Tree` is the form the editor works on: a
 * flat map of blocks plus child-order lists, so changing one block keeps every
 * other block object (and its rendered component) untouched.
 */

export type Attrs = Readonly<Record<string, unknown>>

export interface Block {
  /** Stable, unique within the document. */
  readonly id: string
  /** For example "core/paragraph". */
  readonly type: string
  readonly attrs: Attrs
  /** Present exactly on container blocks, possibly empty. */
  readonly children?: readonly Block[]
}

/** A block without its children. */
export interface BlockNode {
  readonly id: string
  readonly type: string
  readonly attrs: Attrs
}

/** null is the document root. */
export type ParentId = string | null

export interface Tree {
  readonly nodes: ReadonlyMap<string, BlockNode>
  /** Child order of the root (key null) and of every container block. A block without an entry is a leaf. */
  readonly children: ReadonlyMap<ParentId, readonly string[]>
  readonly parents: ReadonlyMap<string, ParentId>
}

export const EMPTY_TREE: Tree = { nodes: new Map(), children: new Map([[null, []]]), parents: new Map() }

export const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

/** A random block id. Unique enough for one document; operations still check. */
export function createId(): string {
  let id = ''
  while (id.length < 12) id += Math.random().toString(36).slice(2)
  return id.slice(0, 12)
}

export class TreeError extends Error {
  override name = 'TreeError'
}

// ---------------------------------------------------------------------------
// Conversion

/** Adds `blocks` (nested) to mutable maps under `parent`. Throws on a bad or repeated id. */
export function addBlocks(
  nodes: Map<string, BlockNode>, children: Map<ParentId, readonly string[]>, parents: Map<string, ParentId>,
  blocks: readonly Block[], parent: ParentId,
): string[] {
  return blocks.map((b) => {
    if (typeof b.id !== 'string' || !ID_PATTERN.test(b.id)) throw new TreeError(`Invalid block id ${JSON.stringify(b.id)}`)
    if (nodes.has(b.id)) throw new TreeError(`Duplicate block id ${b.id}`)
    nodes.set(b.id, { id: b.id, type: b.type, attrs: b.attrs })
    parents.set(b.id, parent)
    if (b.children) children.set(b.id, addBlocks(nodes, children, parents, b.children, b.id))
    return b.id
  })
}

export function treeFromBlocks(blocks: readonly Block[]): Tree {
  const nodes = new Map<string, BlockNode>()
  const children = new Map<ParentId, readonly string[]>()
  const parents = new Map<string, ParentId>()
  children.set(null, addBlocks(nodes, children, parents, blocks, null))
  return { nodes, children, parents }
}

/** The nested form of one block. */
export function getBlock(tree: Tree, id: string): Block {
  const node = tree.nodes.get(id)
  if (!node) throw new TreeError(`No block ${id}`)
  const kids = tree.children.get(id)
  return kids ? { ...node, children: kids.map((k) => getBlock(tree, k)) } : node
}

export function blocksFromTree(tree: Tree, parent: ParentId = null): Block[] {
  return childrenOf(tree, parent).map((id) => getBlock(tree, id))
}

// ---------------------------------------------------------------------------
// Queries

export function childrenOf(tree: Tree, parent: ParentId): readonly string[] {
  const kids = tree.children.get(parent)
  if (!kids) throw new TreeError(parent === null ? 'Tree has no root' : `Block ${parent} is not a container`)
  return kids
}

export function parentOf(tree: Tree, id: string): ParentId {
  const p = tree.parents.get(id)
  if (p === undefined) throw new TreeError(`No block ${id}`)
  return p
}

export function isContainer(tree: Tree, id: ParentId): boolean {
  return tree.children.has(id)
}

/** True when `ancestor` is `id` itself or contains it. */
export function isSelfOrAncestor(tree: Tree, ancestor: string, id: string): boolean {
  for (let cur: ParentId = id; cur !== null; cur = parentOf(tree, cur)) if (cur === ancestor) return true
  return false
}

/** Child indexes from the root down to `id`. Comparing paths compares document order. */
export function pathOf(tree: Tree, id: string): number[] {
  const path: number[] = []
  for (let cur: ParentId = id; cur !== null;) {
    const p = parentOf(tree, cur)
    path.unshift(childrenOf(tree, p).indexOf(cur))
    cur = p
  }
  return path
}

export function comparePaths(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i]! - b[i]!
  return a.length - b.length
}

/**
 * `ids` without repeats and without blocks inside another listed block, in
 * document order. This is what remove and move act on. Throws on an unknown id.
 */
export function topmost(tree: Tree, ids: readonly string[]): string[] {
  const set = new Set(ids)
  const kept = [...set].filter((id) => {
    for (let p = parentOf(tree, id); p !== null; p = parentOf(tree, p)) if (set.has(p)) return false
    return true
  })
  const paths = new Map(kept.map((id) => [id, pathOf(tree, id)]))
  return kept.sort((a, b) => comparePaths(paths.get(a)!, paths.get(b)!))
}

/** Every id in the subtree of `id`, itself included. */
export function subtreeIds(tree: Tree, id: string): string[] {
  const out: string[] = []
  // Depth first without spreading each child's list into push(): a group of 200,000 parts passes the argument limit.
  const walk = (at: string): void => { out.push(at); for (const k of tree.children.get(at) ?? []) walk(k) }
  walk(id)
  return out
}
