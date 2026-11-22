/**
 * Uploads through the host's adapter. The
 * adapter validates and stores; the checks here (file type) are only a
 * convenience. Progress lives in the interface, never in the document: a part
 * being uploaded is an empty part until the address comes back, and then one
 * undo step fills it.
 */
import { shallowReactive, watch } from 'vue'
import type { Editor } from '../editor/editor'
import { createId } from '../model/tree'
import { safeUrl } from '../model/url'
import { type MediaKind, type ToPatch, type UploadAdapter, type UploadEvent, type UploadSource, accepts } from '../editor/upload'

export { ACCEPT, accepts, type MediaKind, type ToPatch, type UploadAdapter, type UploadResult, type UploadSource } from '../editor/upload'

export interface UploadState {
  readonly name: string
  readonly kind: MediaKind
  /** 0 to 1, or null while the adapter reports nothing. */
  readonly progress: number | null
  readonly error: string | null
  readonly file: File
  readonly abort: AbortController
  readonly source: UploadSource
  readonly attempt: string
}

export interface UploadMessages {
  uploading(name: string): string
  uploaded(name: string): string
  failed(name: string): string
  cancelled: string
  wrongType(kind: MediaKind): string
}

type StopReason = NonNullable<UploadEvent['reason']>

/** Uploads talking to the adapter at once; the others wait their turn (a paste of fifty pictures is not fifty requests). */
const PARALLEL = 4

export class Uploads {
  /** By block id (and `:captions` for a video's captions). Reactive, for the parts that show progress. */
  readonly state = shallowReactive(new Map<string, UploadState>())
  readonly #editor: Editor
  readonly #adapter: UploadAdapter | null
  readonly #t: UploadMessages
  readonly #offs: (() => void)[] = []
  #running = 0
  readonly #waiting: (() => void)[] = []

  constructor(editor: Editor, adapter: UploadAdapter | null, messages: UploadMessages) {
    this.#editor = editor
    this.#adapter = adapter
    this.#t = messages
    let generation = editor.generation
    this.#offs.push(editor.on('change', () => {
      // New content may reuse the ids of the old: nothing started for the old document lands in it.
      if (editor.generation !== generation) { generation = editor.generation; for (const key of [...this.state.keys()]) this.#stop(key, 'reset'); return }
      // A part removed (or undone away) while its file uploads: the upload stops.
      for (const key of [...this.state.keys()]) if (!editor.tree.nodes.has(blockOf(key))) this.#stop(key, 'removed')
    }))
    // Created in the interface's setup, so the watcher ends with it.
    watch(editor.readOnly, (on) => { if (on) for (const key of [...this.state.keys()]) this.#stop(key, 'readOnly') })
  }

  get available(): boolean { return this.#adapter !== null }

  /** Upload `file` for block `id`; on success its attributes become `toPatch(result)` in one undo step. */
  start(key: string, kind: MediaKind, file: File, toPatch: ToPatch, source: UploadSource): void {
    const adapter = this.#adapter
    if (!adapter) return
    const editor = this.#editor
    const blockId = blockOf(key)
    const attempt = createId()
    const report = (status: UploadEvent['status'], more: Partial<UploadEvent> = {}): void => {
      editor.reportUpload({ attempt, status, blockId, kind, source, file, ...more })
    }
    this.#stop(key, 'replaced')
    if (!accepts(kind, file)) {
      this.#set(key, { name: file.name, kind, progress: null, error: this.#t.wrongType(kind), file, abort: new AbortController(), source, attempt })
      report('failed', { reason: 'type' })
      editor.announce(this.#t.wrongType(kind), 'assertive')
      return
    }
    const abort = new AbortController()
    const entry: UploadState = { name: file.name, kind, progress: null, error: null, file, abort, source, attempt }
    // What the part held when the file was chosen: a result that would overwrite something put there since is stale.
    const was = editor.tree.nodes.get(blockId)?.attrs ?? {}
    const generation = editor.generation
    this.#set(key, entry)
    report('started')
    editor.announce(this.#t.uploading(file.name))
    const current = (): boolean => !abort.signal.aborted && this.state.get(key)?.abort === abort
    const onProgress = (fraction: number): void => {
      const now = this.state.get(key)
      if (now?.abort !== abort || !Number.isFinite(fraction)) return
      const progress = Math.max(0, Math.min(1, fraction))
      this.#set(key, { ...now, progress })
      report('progress', { progress })
    }
    const fail = (reason: 'adapter' | 'result'): void => {
      if (!current()) return
      this.#set(key, { ...entry, progress: null, error: this.#t.failed(file.name) })
      report('failed', { reason })
      editor.announce(this.#t.failed(file.name), 'assertive')
    }
    void (async () => {
      await this.#turn()
      let result
      try {
        // Stopped while it waited: its turn goes to the next.
        if (!current()) return
        result = await adapter(file, { onProgress, signal: abort.signal, kind, blockId, source })
      } catch { fail('adapter'); return } finally { this.#done() }
      // The adapter's address is data from the host's server: it passes the same allow-list as any URL.
      if (typeof result !== 'object' || typeof result.url !== 'string' || safeUrl(result.url) === null) { fail('adapter'); return }
      let patch
      try { patch = await toPatch(result, file) } catch { fail('result'); return }
      if (!current()) return
      this.state.delete(key)
      const node = editor.tree.nodes.get(blockId)
      if (editor.generation !== generation || !node) { report('cancelled', { reason: editor.generation !== generation ? 'reset' : 'removed' }); return }
      if (Object.keys(patch).some((k) => node.attrs[k] !== was[k])) { report('cancelled', { reason: 'replaced' }); return }
      const same = Object.entries(patch).every(([k, v]) => node.attrs[k] === v)
      if (!same && !editor.setAttrs(blockId, patch, this.#t.uploaded(file.name))) { report('cancelled', { reason: 'readOnly' }); return }
      report('succeeded', { result })
    })()
  }

  retry(key: string, toPatch: ToPatch): void {
    const s = this.state.get(key)
    if (s) this.start(key, s.kind, s.file, toPatch, s.source)
  }

  cancel(key: string): void {
    if (!this.state.has(key)) return
    this.#stop(key, 'author')
    this.#editor.announce(this.#t.cancelled)
  }

  #turn(): Promise<void> {
    if (this.#running < PARALLEL) { this.#running++; return Promise.resolve() }
    return new Promise((resolve) => { this.#waiting.push(resolve) })
  }

  /** A finished upload hands its place straight to the next one waiting, so no new one can slip in between. */
  #done(): void {
    const next = this.#waiting.shift()
    if (next) next()
    else this.#running--
  }

  /** Every running upload stops: the interface is going away. */
  destroy(): void {
    for (const key of [...this.state.keys()]) this.#stop(key, 'destroyed')
    for (const off of this.#offs) off()
  }

  /** Forget the upload at `key`; a running one is aborted and reported. A failed one already ended. */
  #stop(key: string, reason: StopReason): void {
    const s = this.state.get(key)
    if (!s) return
    this.state.delete(key)
    if (s.error !== null) return
    s.abort.abort()
    this.#editor.reportUpload({ attempt: s.attempt, status: 'cancelled', blockId: blockOf(key), kind: s.kind, source: s.source, file: s.file, reason })
  }

  #set(key: string, s: UploadState): void { this.state.set(key, s) }
}

const blockOf = (key: string): string => key.split(':')[0]!

/** The pixel size of a picture at `url`, or null when it does not load within a few seconds. */
export function measureImage(url: string, timeout = 8000): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image()
    const timer = setTimeout(() => { resolve(null) }, timeout)
    img.onload = () => { clearTimeout(timer); resolve(img.naturalWidth > 0 ? { width: img.naturalWidth, height: img.naturalHeight } : null) }
    img.onerror = () => { clearTimeout(timer); resolve(null) }
    img.src = url
  })
}
