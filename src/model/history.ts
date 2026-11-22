/**
 * Transactions and undo history.
 *
 * A transaction is a group of operations with the selection before and after
 * and an origin. `S` is the selection type, owned by the editor layer.
 */
import { type Operation, applyOperations } from './operations'
import type { Tree } from './tree'

export type Origin = 'typing' | 'paste' | 'command' | 'import'

export interface Typing {
  /** What is being typed into, for example `${blockId}:${attribute}`. Steps on different keys never merge. */
  readonly key: string
  /** Text the step inserted; empty for a deletion. */
  readonly inserted: string
}

export interface Transaction<S> {
  readonly ops: readonly Operation[]
  readonly inverse: readonly Operation[]
  readonly origin: Origin
  readonly before: S
  readonly after: S
  /** Milliseconds, from the caller's clock. */
  readonly time: number
  /** Set for origin "typing"; drives coalescing. */
  readonly typing?: Typing
}

export interface TransactionMeta<S> {
  readonly origin: Origin
  readonly before: S
  readonly after: S
  readonly time: number
  readonly typing?: Typing
}

/** Apply `ops` and wrap them, with their inverse, as one transaction. */
export function transact<S>(tree: Tree, ops: readonly Operation[], meta: TransactionMeta<S>): { tree: Tree; transaction: Transaction<S> } {
  const r = applyOperations(tree, ops)
  return { tree: r.tree, transaction: { ...meta, ops, inverse: r.inverse } }
}

// ---------------------------------------------------------------------------

export interface History<S> {
  /** Oldest first. */
  readonly done: readonly Transaction<S>[]
  /** Most recently undone last. */
  readonly undone: readonly Transaction<S>[]
}

export function emptyHistory<S>(): History<S> {
  return { done: [], undone: [] }
}

/** Typing steps further apart than this start a new undo step. */
export const TYPING_PAUSE_MS = 1000
/** Undo steps kept; older ones are forgotten, so a long session does not hold every value it ever had. */
const UNDO_STEPS = 1000

/** Record a transaction. Clears redo. Typing merges into the previous step unless a pause or a word boundary separates them. */
export function record<S>(history: History<S>, tx: Transaction<S>, pause = TYPING_PAUSE_MS): History<S> {
  if (tx.ops.length === 0) return history
  const prev = history.done.at(-1)
  const done = prev && continuesTyping(prev, tx, pause)
    ? [...history.done.slice(0, -1), merge(prev, tx)]
    : [...history.done, tx]
  return { done: done.length > UNDO_STEPS ? done.slice(-UNDO_STEPS) : done, undone: [] }
}

function continuesTyping<S>(prev: Transaction<S>, next: Transaction<S>, pause: number): boolean {
  const a = prev.typing, b = next.typing
  if (prev.origin !== 'typing' || next.origin !== 'typing' || !a || !b || a.key !== b.key) return false
  if (next.time - prev.time > pause) return false
  // Switching between inserting and deleting is a new step, as in word processors.
  if ((a.inserted === '') !== (b.inserted === '')) return false
  // A new word starts a new step: the previous step ended in a space, this one does not start with one.
  return !(/\s$/.test(a.inserted) && /^\S/.test(b.inserted))
}

function merge<S>(a: Transaction<S>, b: Transaction<S>): Transaction<S> {
  const [ops, inverse] = squash(a, b)
  return {
    ops, inverse, origin: a.origin, before: a.before, after: b.after, time: b.time,
    typing: { key: b.typing!.key, inserted: a.typing!.inserted + b.typing!.inserted },
  }
}

/**
 * Typing is one setAttrs per keystroke on the same block. Folding them keeps a
 * long typed paragraph as one operation instead of one full value per character.
 */
function squash<S>(a: Transaction<S>, b: Transaction<S>): [Operation[], Operation[]] {
  const [oa] = a.ops, [ob] = b.ops, [ia] = a.inverse, [ib] = b.inverse
  if (a.ops.length === 1 && b.ops.length === 1 && a.inverse.length === 1 && b.inverse.length === 1
    && oa?.type === 'setAttrs' && ob?.type === 'setAttrs' && ia?.type === 'setAttrs' && ib?.type === 'setAttrs' && oa.id === ob.id) {
    // The older step's previous values win: they are the state before both.
    return [[{ type: 'setAttrs', id: oa.id, patch: { ...oa.patch, ...ob.patch } }], [{ type: 'setAttrs', id: oa.id, patch: { ...ib.patch, ...ia.patch } }]]
  }
  return [[...a.ops, ...b.ops], [...b.inverse, ...a.inverse]]
}

export interface Stepped<S> {
  readonly history: History<S>
  readonly tree: Tree
  /** Selection to restore. */
  readonly selection: S
}

export function undo<S>(history: History<S>, tree: Tree): Stepped<S> | null {
  const tx = history.done.at(-1)
  if (!tx) return null
  return {
    tree: applyOperations(tree, tx.inverse).tree,
    history: { done: history.done.slice(0, -1), undone: [...history.undone, tx] },
    selection: tx.before,
  }
}

export function redo<S>(history: History<S>, tree: Tree): Stepped<S> | null {
  const tx = history.undone.at(-1)
  if (!tx) return null
  return {
    tree: applyOperations(tree, tx.ops).tree,
    history: { done: [...history.done, tx], undone: history.undone.slice(0, -1) },
    selection: tx.after,
  }
}
