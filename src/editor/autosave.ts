/**
 * Draft recovery (TinyMCE `autosave`): the document is kept
 * in the browser's storage while the author writes, keyed by the editor
 * instance, so a crash or an accidental navigation loses nothing. On the next
 * load the interface offers the draft back.
 *
 * Storage is a trust boundary like loaded JSON: a restored draft is validated
 * by `replaceContent`. Storage may be missing or full (private windows,
 * quotas): autosave then does nothing, and the editor works as before.
 */
import type { StoredDoc } from '../model/schema'
import type { Editor } from './editor'

export interface AutosaveOptions {
  /** Names this instance: one draft per key (a page and a field name, a record id). */
  readonly key: string
  /** Where drafts live. Default `localStorage`. */
  readonly storage?: Storage
  /** Quiet time after a change before the draft is written, in ms. Default 1000. */
  readonly delay?: number
}

/** A draft found on load that differs from the content the editor opened with. */
export interface FoundDraft {
  /** When it was written, ms since the epoch. */
  readonly saved: number
  readonly doc: StoredDoc
}

interface Stored { readonly v: 1; readonly saved: number; readonly doc: unknown }

const PREFIX = 'proza:draft:'

export class Autosave {
  readonly #editor: Editor
  readonly #storage: Storage | null
  readonly #key: string
  readonly #delay: number
  /** The document as loaded or last saved by the host; equal to it means nothing to keep. */
  #base: string
  #timer: ReturnType<typeof setTimeout> | undefined
  #found: FoundDraft | null
  readonly #offs: (() => void)[] = []

  constructor(editor: Editor, options: AutosaveOptions) {
    this.#editor = editor
    this.#key = PREFIX + options.key
    this.#delay = options.delay ?? 1000
    this.#storage = options.storage ?? defaultStorage()
    this.#base = content(editor.getJSON())
    this.#found = this.#read()
    let generation = editor.generation
    this.#offs.push(editor.on('change', () => {
      // New content from the host (setContent: a value set, a form reset or restore) is the base, not a draft.
      if (editor.generation !== generation) { generation = editor.generation; this.#rebase(); return }
      this.#schedule()
    }))
    // Write at once when the page goes away: the quiet time may not have passed.
    const flush = (): void => { this.flush() }
    document.addEventListener('visibilitychange', flush)
    window.addEventListener('pagehide', flush)
    this.#offs.push(() => { document.removeEventListener('visibilitychange', flush); window.removeEventListener('pagehide', flush) })
  }

  /** The draft from an earlier visit, until it is restored or discarded. */
  get found(): FoundDraft | null { return this.#found }

  /** Put the found draft into the editor as one undo step. */
  restore(announce = ''): boolean {
    const draft = this.#found
    if (!draft) return false
    this.#found = null
    this.#editor.replaceContent(draft.doc, announce)
    return true
  }

  /** Forget the found draft; the content as loaded stays. */
  discard(): void {
    this.#found = null
    this.#remove()
  }

  /** The host stored the document (a save, a form submit): it is the new base, and no draft is needed. */
  saved(): void {
    clearTimeout(this.#timer)
    this.#timer = undefined
    this.#base = content(this.#editor.getJSON())
    this.#found = null
    this.#remove()
  }

  /** Write a pending change now. */
  flush(): void {
    if (this.#timer === undefined) return
    clearTimeout(this.#timer)
    this.#timer = undefined
    this.#write()
  }

  destroy(): void {
    this.flush()
    for (const off of this.#offs) off()
  }

  #rebase(): void {
    clearTimeout(this.#timer)
    this.#timer = undefined
    this.#base = content(this.#editor.getJSON())
    if (this.#found && content(this.#found.doc) === this.#base) this.#found = null
    // A draft of the content that was replaced: nothing of it is on screen to recover.
    if (!this.#found) this.#remove()
  }

  #schedule(): void {
    clearTimeout(this.#timer)
    this.#timer = setTimeout(() => { this.#timer = undefined; this.#write() }, this.#delay)
  }

  #write(): void {
    const doc = this.#editor.getJSON()
    // Back to what was loaded (everything undone): nothing to recover.
    if (content(doc) === this.#base) { this.#remove(); return }
    // A draft not yet answered stays until the author chooses; writing over it would lose it.
    if (this.#found) return
    try {
      this.#storage?.setItem(this.#key, JSON.stringify({ v: 1, saved: Date.now(), doc }))
    } catch { /* full or blocked: the editor goes on without a draft */ }
  }

  #read(): FoundDraft | null {
    let raw: string | null
    try { raw = this.#storage?.getItem(this.#key) ?? null } catch { return null }
    if (raw === null) return null
    let data: unknown
    try { data = JSON.parse(raw) } catch { this.#remove(); return null }
    if (!isStored(data)) { this.#remove(); return null }
    if (content(data.doc) === this.#base) { this.#remove(); return null }
    // Validated when restored (replaceContent); here only its shape.
    return { saved: data.saved, doc: data.doc as StoredDoc }
  }

  #remove(): void {
    try { this.#storage?.removeItem(this.#key) } catch { /* nothing stored, nothing to remove */ }
  }
}

/** The document without block ids: content loaded without ids gets new ones on every load. */
function content(doc: unknown): string {
  return JSON.stringify(doc, (k, v: unknown) => (k === 'id' ? undefined : v))
}

function isStored(v: unknown): v is Stored {
  if (typeof v !== 'object' || v === null) return false
  const s = v as Record<string, unknown>
  const doc = s.doc as Record<string, unknown> | null
  return s.v === 1 && typeof s.saved === 'number' && typeof doc === 'object' && doc !== null && Array.isArray(doc.blocks)
}

function defaultStorage(): Storage | null {
  try { return globalThis.localStorage } catch { return null }
}
