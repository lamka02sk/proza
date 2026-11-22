/**
 * Upload types (`upload`): the host's adapter and what a
 * block does with its result. The interface runs uploads (`src/ui/upload.ts`).
 */
import { safeUrl } from '../model/url'

export interface UploadResult {
  /** Where the file now lives. Must pass the URL allow-list. */
  readonly url: string
  /** Pixel size of a picture or video, when the host knows it. Otherwise the editor measures a picture. */
  readonly width?: number
  readonly height?: number
  /** Smaller copies of a picture for `srcset`. */
  readonly variants?: readonly { readonly url: string; readonly width: number }[]
}

/** What a part accepts: a picture, a video, an audio file, captions, any file. */
export type MediaKind = 'image' | 'video' | 'audio' | 'captions' | 'file'

/**
 * Where the file came from: the part's file chooser, a drop on the part or the canvas, a paste,
 * a picture in imported content, or a picture copied from another site (`import.rehostImages`).
 */
export type UploadSource = 'picker' | 'drop' | 'paste' | 'import' | 'rehost'

export interface UploadContext {
  readonly onProgress: (fraction: number) => void
  readonly signal: AbortSignal
  readonly kind: MediaKind
  /** The part the file is for. */
  readonly blockId: string
  readonly source: UploadSource
}

export type UploadAdapter = (file: File, options: UploadContext) => Promise<UploadResult>

/**
 * One upload attempt, for hosts (`on('upload')`, `hooks.upload`). Each attempt has its own id,
 * a retry is a new attempt with the same source. `started` comes first, then `progress` when the
 * adapter reports it, then exactly one of `succeeded` (the part already holds the file),
 * `failed` or `cancelled`. A file the part does not take fails without reaching the adapter.
 */
export interface UploadEvent {
  readonly attempt: string
  readonly status: 'started' | 'progress' | 'succeeded' | 'failed' | 'cancelled'
  readonly blockId: string
  readonly kind: MediaKind
  readonly source: UploadSource
  readonly file: File
  /** 0 to 1, on `progress`. */
  readonly progress?: number
  /** On `succeeded`. */
  readonly result?: UploadResult
  /**
   * On `failed`: `type` (the part does not take this file), `adapter` (the adapter threw or
   * returned no usable address), `result` (the result could not be used).
   * On `cancelled`: `author`, `removed` (the part is gone), `replaced` (another file or address
   * took its place), `reset` (new content), `readOnly`, `destroyed`.
   */
  readonly reason?: 'type' | 'adapter' | 'result' | 'author' | 'removed' | 'replaced' | 'reset' | 'readOnly' | 'destroyed'
}

export const ACCEPT: Readonly<Record<MediaKind, string>> = {
  image: 'image/*',
  video: 'video/*',
  audio: 'audio/*',
  captions: '.vtt,text/vtt',
  file: '',
}

/** The file looks like what the part takes (by its type, or for captions its extension). */
export function accepts(kind: MediaKind, file: File): boolean {
  switch (kind) {
    case 'image': case 'video': case 'audio': return file.type.startsWith(`${kind}/`)
    case 'captions': return file.type === 'text/vtt' || /\.vtt$/i.test(file.name)
    case 'file': return true
  }
}

/**
 * Turns the adapter's result into the attributes the part gets; may measure
 * (a picture's size) first. Throws to report that the result is unusable.
 */
export type ToPatch = (result: UploadResult, file: { readonly name: string; readonly size: number; readonly type: string }) => Promise<Readonly<Record<string, unknown>>> | Readonly<Record<string, unknown>>


/** A stored file the host's attachment manager returned (`hooks.requestAttachment`). */
export interface Attachment {
  /** Must pass the URL allow-list. */
  readonly url: string
  readonly name: string
  readonly mimeType: string
  readonly bytes?: number
  /** Pixel size of a picture. */
  readonly width?: number
  readonly height?: number
  /** Smaller copies of a picture for `srcset`. */
  readonly variants?: readonly { readonly url: string; readonly width: number }[]
}

/** The event a host dispatches on `replyTarget` to answer a request: `detail` is `{ requestId, attachment }`, `attachment` null when the author cancelled. */
export const ATTACHMENT_RESULT = 'proza:attachment-result'

/**
 * The editor asks the host's attachment manager for a stored file. Sent from
 * the author's action, so the host may open a window. The host answers once, with a
 * `proza:attachment-result` CustomEvent dispatched on `replyTarget`; `signal` aborts when the
 * editor no longer wants the answer (another request, new content, read-only, teardown).
 */
export interface AttachmentRequest {
  readonly requestId: string
  readonly kind: 'image' | 'file'
  /** The file chooser's `accept` filter: `image/*` for a picture, empty for any file. */
  readonly accept: string
  readonly signal: AbortSignal
  readonly replyTarget: EventTarget
}

export type RequestAttachment = (request: AttachmentRequest) => void | Promise<void>

const positive = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0

/**
 * A host's answer as an upload result and the file facts a part keeps, or null when it is not
 * usable for `kind` (data from the host's page: checked like any loaded value).
 */
export function readAttachment(data: unknown, kind: 'image' | 'file'): { readonly result: UploadResult; readonly file: { readonly name: string; readonly size: number; readonly type: string } } | null {
  if (typeof data !== 'object' || data === null) return null
  const a = data as Record<string, unknown>
  if (typeof a.url !== 'string' || safeUrl(a.url) === null || typeof a.mimeType !== 'string' || typeof a.name !== 'string') return null
  if (kind === 'image' && !a.mimeType.startsWith('image/')) return null
  const variants = Array.isArray(a.variants)
    ? a.variants.filter((v): v is { url: string; width: number } => typeof v === 'object' && v !== null && typeof (v as { url?: unknown }).url === 'string' && safeUrl((v as { url: string }).url) !== null && positive((v as { width?: unknown }).width))
    : []
  const result: UploadResult = {
    url: a.url,
    ...(positive(a.width) && positive(a.height) ? { width: a.width, height: a.height } : {}),
    ...(variants.length > 0 ? { variants: variants.map((v) => ({ url: v.url, width: v.width })) } : {}),
  }
  const size = typeof a.bytes === 'number' && Number.isFinite(a.bytes) && a.bytes >= 0 ? a.bytes : 0
  return { result, file: { name: a.name.slice(0, 255), size, type: a.mimeType } }
}
