/**
 * The host's attachment manager (`hooks.requestAttachment`):
 * the author picks a stored file in the host's own window instead of uploading.
 * One request per editor at a time; the answer comes back as an event on the
 * editor's host element and is checked like any data from the page.
 */
import { watch } from 'vue'
import type { Editor } from '../editor/editor'
import { ATTACHMENT_RESULT, type RequestAttachment, type UploadResult, readAttachment } from '../editor/upload'
import { createId } from '../model/tree'

export interface Picked {
  readonly result: UploadResult
  readonly file: { readonly name: string; readonly size: number; readonly type: string }
}

export interface AttachmentMessages {
  readonly invalid: string
  readonly failed: string
}

export class Attachments {
  readonly #editor: Editor
  readonly #handler: RequestAttachment | null
  readonly #target: EventTarget | null
  readonly #t: AttachmentMessages
  #pending: AbortController | null = null
  readonly #offs: (() => void)[] = []

  constructor(editor: Editor, handler: RequestAttachment | null, target: EventTarget | null, messages: AttachmentMessages) {
    this.#editor = editor
    this.#handler = handler
    this.#target = target
    this.#t = messages
    let generation = editor.generation
    // New content: the destination the request was for is gone, even if an id repeats.
    this.#offs.push(editor.on('change', () => { if (editor.generation !== generation) { generation = editor.generation; this.cancel() } }))
    watch(editor.readOnly, (on) => { if (on) this.cancel() })
  }

  get available(): boolean { return this.#handler !== null && this.#target !== null }

  /**
   * Ask the host for a file of `kind`. `done` gets the checked answer, or null when the author
   * cancelled, the answer was unusable, or the host failed (each said to the author here).
   * A request still open is aborted first.
   */
  request(kind: 'image' | 'file', done: (picked: Picked | null) => void): void {
    const handler = this.#handler
    const target = this.#target
    if (!handler || !target) return
    this.cancel()
    const abort = new AbortController()
    this.#pending = abort
    const requestId = createId()
    const finish = (picked: Picked | null): void => {
      if (abort.signal.aborted) return
      this.#pending = null
      abort.abort()
      done(picked)
    }
    const onResult = (e: Event): void => {
      // Only an answer sent to this editor's host, for this request.
      if (e.target !== target || !(e instanceof CustomEvent)) return
      const detail: unknown = e.detail
      if (typeof detail !== 'object' || detail === null || (detail as { requestId?: unknown }).requestId !== requestId) return
      const data = (detail as { attachment?: unknown }).attachment
      if (data === null || data === undefined) { finish(null); return }
      const picked = readAttachment(data, kind)
      if (!picked) this.#editor.announce(this.#t.invalid, 'assertive')
      finish(picked)
    }
    target.addEventListener(ATTACHMENT_RESULT, onResult)
    abort.signal.addEventListener('abort', () => { target.removeEventListener(ATTACHMENT_RESULT, onResult) }, { once: true })
    const failed = (e: unknown): void => {
      if (abort.signal.aborted) return
      if (typeof reportError === 'function') reportError(e)
      this.#editor.announce(this.#t.failed, 'assertive')
      finish(null)
    }
    try {
      const r = handler({ requestId, kind, accept: kind === 'image' ? 'image/*' : '', signal: abort.signal, replyTarget: target })
      if (r instanceof Promise) r.catch(failed)
    } catch (e) { failed(e) }
  }

  /** The open request, if any, is no longer wanted. */
  cancel(): void {
    this.#pending?.abort()
    this.#pending = null
  }

  destroy(): void {
    this.cancel()
    for (const off of this.#offs) off()
  }
}
