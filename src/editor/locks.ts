/**
 * Locked parts (TinyMCE `noneditable`).
 * `move`: the part stays where it is: it is not moved, removed or replaced.
 * `all`: neither is anything about it or inside it changed.
 * The editor checks every transaction here before applying it, so commands,
 * paste, drag and text across parts all obey the same rule.
 */
import type { Operation } from '../model/operations'
import { type Tree, parentOf } from '../model/tree'

export type Lock = '' | 'move' | 'all'

export function lockOf(tree: Tree, id: string): Lock {
  const v = tree.nodes.get(id)?.attrs.lock
  return v === 'move' || v === 'all' ? v : ''
}

/** Nothing in or about it may change: it or a part around it is locked `all`. */
export function frozen(tree: Tree, id: string | null): boolean {
  for (let cur = id; cur !== null && tree.nodes.has(cur); cur = parentOf(tree, cur)) if (lockOf(tree, cur) === 'all') return true
  return false
}

/** A part that may not go away or move: locked itself, frozen, or holding a locked part. */
function pinned(tree: Tree, id: string): boolean {
  if (lockOf(tree, id) !== '' || frozen(tree, parentOf(tree, id))) return true
  return (tree.children.get(id) ?? []).some((c) => pinned(tree, c))
}

/** What a transaction would break: `move` (a locked part moved or removed), `edit` (a frozen part changed), or null. */
export function lockViolation(tree: Tree, ops: readonly Operation[]): 'move' | 'edit' | null {
  for (const op of ops) {
    switch (op.type) {
      case 'setAttrs':
        // The lock itself may change (where the host lets authors lock); nothing else about a frozen part.
        if (frozen(tree, op.id) && Object.keys(op.patch).some((k) => k !== 'lock')) return 'edit'
        break
      case 'removeBlocks':
      case 'replaceBlocks':
        if (op.ids.some((id) => tree.nodes.has(id) && pinned(tree, id))) return 'move'
        break
      case 'moveBlocks':
        if (op.ids.some((id) => tree.nodes.has(id) && pinned(tree, id))) return 'move'
        if (frozen(tree, op.parentId)) return 'edit'
        break
      case 'insertBlocks':
        if (frozen(tree, op.parentId)) return 'edit'
        break
    }
  }
  return null
}
