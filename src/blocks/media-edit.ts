/**
 * Canvas components and editing of the core media blocks.
 * A media part is a named group selected as a whole; its caption (and
 * a transcript) are optional fields that appear while you are on it.
 *
 * Empty parts show where the file comes from: dropped, chosen and uploaded
 * through the host's adapter, or a web address. The prompts ATAG B asks for
 * sit on the part itself: a picture without a description, a video without
 * captions or transcript, an embed without a title.
 */
import { checksFor } from './checks'
import { type Component, type PropType, type VNode, computed, defineComponent, h, nextTick, onMounted, ref } from 'vue'
import type { BlockDefinition, BlockEditing, InserterItem } from '../editor/editing'
import { caret } from '../editor/selection'
import { excerpt } from '../editor/strings'
import { newBlock } from '../editor/structure'
import type { ToPatch } from '../editor/upload'
import { embedFor, embedProviders, isPlayerUrl } from '../model/embeds'
import { formatBytes } from '../render/render'
import type { RenderableBlock } from '../render/render'
import { type BlockNode, childrenOf, parentOf } from '../model/tree'
import { safeUrl } from '../model/url'
import { BlockList, RichTextView, type WrapperProps, useEditor } from '../ui/canvas'
import { topLevel, useUi } from '../ui/context'
import { icon } from '../ui/icons'
import { ACCEPT, type MediaKind, type UploadSource, measureImage } from '../ui/upload'
import { audioPatch, filePatch, imagePatch, videoPatch } from './media-patch'
import { galleryTransforms, imageTransforms } from './transforms'
import { defineBlock } from './define'
import { mediaParse } from './media-parse'
import { AUDIO, EMBED, FILE, GALLERY, IMAGE, VIDEO, audio, decodeName, embed, file, fileType, gallery, image, video } from './media'
import { AudioInspector, EmbedInspector, FileInspector, GalleryInspector, ImageInspector, VideoInspector } from './media-inspector'

const props = {
  id: { type: String, required: true },
  node: { type: Object as PropType<BlockNode>, required: true },
  wrapper: { type: Object as PropType<WrapperProps>, required: true },
} as const

const str = (node: BlockNode, k: string): string => (typeof node.attrs[k] === 'string' ? node.attrs[k] : '')
const num = (node: BlockNode, k: string): number => (typeof node.attrs[k] === 'number' ? node.attrs[k] : 0)

/** Controls inside a part are in the Tab order only while you are on that part: the canvas stays one Tab stop. */
function useReach(id: () => string): () => 0 | -1 {
  const editor = useEditor()
  return () => (editor.isCurrent(id()) || editor.isSelected(id()) ? 0 : -1)
}

// ---------------------------------------------------------------------------
// Where a file comes from: drop, choose, or a web address

/**
 * The empty state of a media part:
 * drop a file, choose one (when the host can store it), or give a web address.
 * While a file uploads it shows progress and Cancel; a failed upload says so
 * and offers Try again.
 */
export const MediaSource = defineComponent({
  name: 'ProzaMediaSource',
  props: {
    blockId: { type: String, required: true },
    kind: { type: String as PropType<MediaKind>, required: true },
    patch: { type: Function as PropType<ToPatch>, required: true },
    /** Several files at once (a gallery). */
    multiple: { type: Boolean, default: false },
    /** Key in the upload state; default the block id. */
    uploadKey: { type: String, default: '' },
    /** A smaller tile (inside a gallery). */
    compact: { type: Boolean, default: false },
  },
  emits: { files: (f: File[], source: UploadSource) => f.length > 0 && (source === 'picker' || source === 'drop'), url: (u: string) => u !== '' },
  setup(p, { emit }) {
    const ui = useUi()
    const { t } = ui
    const input = ref<HTMLInputElement>()
    const urlInput = ref<HTMLInputElement>()
    const library = computed(() => ui.attachments.available && !p.multiple && (p.kind === 'image' || p.kind === 'file'))
    const byAddress = ref(!ui.uploads.available && !library.value)
    const address = ref('')
    const error = ref(false)
    const over = ref(false)
    const reach = useReach(() => p.blockId)
    const key = computed(() => p.uploadKey || p.blockId)
    const words = computed(() => t.media[p.kind])

    const take = (list: FileList | null | undefined, source: UploadSource): void => {
      const files = [...(list ?? [])]
      if (files.length > 0) emit('files', p.multiple ? files : files.slice(0, 1), source)
    }
    /** The host's library: the answer fills this part, if it is still as it was. */
    const fromLibrary = (e: MouseEvent): void => {
      const opener = e.currentTarget as HTMLElement
      const editor = ui.editor
      const id = p.blockId
      const was = editor.tree.nodes.get(id)
      const generation = editor.generation
      const back = (): void => { if (opener.isConnected) opener.focus(); else ui.focusText() }
      ui.attachments.request(p.kind as 'image' | 'file', (picked) => {
        if (!picked) { back(); return }
        void (async () => {
          let patch: Readonly<Record<string, unknown>>
          try { patch = await p.patch(picked.result, picked.file) } catch { editor.announce(t.attachmentInvalid, 'assertive'); back(); return }
          const now = editor.tree.nodes.get(id)
          if (editor.generation !== generation || !now || !was || Object.keys(patch).some((k) => now.attrs[k] !== was.attrs[k])) {
            editor.announce(t.attachmentStale, 'assertive')
            back()
            return
          }
          editor.setAttrs(id, patch, words.value.added)
          ui.focusText()
        })()
      })
    }
    const submit = (): void => {
      const url = safeUrl(address.value)
      if (url === null || address.value.trim() === '') { error.value = true; return }
      emit('url', url)
    }
    const dropHandlers = {
      onDragover: (e: DragEvent) => {
        if (!ui.uploads.available || !e.dataTransfer?.types.includes('Files')) return
        e.preventDefault()
        e.stopPropagation()
        over.value = true
      },
      onDragleave: () => { over.value = false },
      onDrop: (e: DragEvent) => {
        over.value = false
        if (!ui.uploads.available || !e.dataTransfer?.files.length) return
        e.preventDefault()
        e.stopPropagation()
        take(e.dataTransfer.files, 'drop')
      },
    }

    return () => {
      const tab = reach()
      const state = ui.uploads.state.get(key.value)
      if (state && state.error === null) {
        const pct = state.progress === null ? null : Math.round(state.progress * 100)
        return h('div', { class: ['pz-upload', p.compact && 'is-compact'] }, [
          h('span', { class: 'pz-upload-name' }, [icon(p.kind === 'captions' ? 'file' : p.kind), h('span', null, state.name), pct === null ? null : h('span', { class: 'pz-upload-pct' }, `${pct} %`)]),
          h('div', {
            class: ['pz-meter', pct === null && 'is-waiting'], role: 'progressbar', 'aria-label': t.uploading(state.name),
            'aria-valuemin': 0, 'aria-valuemax': 100, ...(pct === null ? {} : { 'aria-valuenow': pct, 'aria-valuetext': `${pct} %` }),
          }, h('span', { style: pct === null ? {} : { inlineSize: `${pct}%` } })),
          h('button', { type: 'button', class: 'btn btn-s btn-line', tabindex: tab, onClick: () => { ui.uploads.cancel(key.value) } }, t.cancel),
        ])
      }
      const chooser = ui.uploads.available ? [
        h('input', {
          ref: input, type: 'file', class: 'vh', tabindex: -1, 'aria-hidden': 'true', accept: ACCEPT[p.kind] || undefined, multiple: p.multiple,
          onChange: (e: Event) => { take((e.target as HTMLInputElement).files, 'picker'); (e.target as HTMLInputElement).value = '' },
        }),
        h('button', { type: 'button', class: 'btn btn-line', tabindex: tab, onClick: () => input.value?.click() }, [icon('plus'), library.value ? t.fromDevice : words.value.choose]),
      ] : []
      if (library.value) chooser.unshift(h('button', { type: 'button', class: 'btn btn-line', tabindex: tab, onClick: fromLibrary }, [icon('plus'), t.fromLibrary]))
      const failed = state?.error ?? null
      return h('div', { class: ['drop', over.value && 'is-over', p.compact && 'is-compact', failed !== null && 'is-error'], ...dropHandlers }, [
        failed !== null
          ? [h('p', { class: 'drop-error', role: 'alert' }, failed), state && state.kind === p.kind
            ? h('button', { type: 'button', class: 'btn btn-line', tabindex: tab, onClick: () => { ui.uploads.retry(key.value, p.patch) } }, t.tryAgain) : null]
          : [icon(p.kind === 'captions' ? 'file' : p.kind), p.compact || (library.value && !ui.uploads.available) ? null : h('span', null, ui.uploads.available ? words.value.drop : words.value.noUpload)],
        ...chooser,
        (ui.uploads.available || library.value) && !byAddress.value
          ? h('button', { type: 'button', class: 'btn btn-s', tabindex: tab, onClick: () => { byAddress.value = true; void nextTick(() => urlInput.value?.focus()) } }, t.useAddress)
          : null,
        byAddress.value ? h('form', {
          class: 'drop-url',
          onSubmit: (e: Event) => { e.preventDefault(); submit() },
        }, [
          h('input', {
            // Text, not url: relative addresses (/media/a.jpg) are fine, and the browser's url check would block the form.
            ref: urlInput, class: 'field', type: 'text', inputmode: 'url', tabindex: tab, value: address.value, placeholder: t.addressPlaceholder,
            'aria-label': words.value.address, autocomplete: 'off', spellcheck: 'false',
            'aria-invalid': error.value ? 'true' : undefined, 'aria-describedby': error.value ? `${p.blockId}-url-err` : undefined,
            onInput: (e: Event) => { address.value = (e.target as HTMLInputElement).value; error.value = false },
          }),
          h('button', { type: 'submit', class: 'btn btn-add', tabindex: tab }, t.addAddress),
          error.value ? h('p', { class: 'hint is-error', id: `${p.blockId}-url-err` }, t.addressInvalid) : null,
        ]) : null,
      ])
    }
  },
})

/** A prompt on the part (ATAG B.3): what it still needs, and the way to give it. */
function notice(label: string, tabindex: 0 | -1, onClick: () => void): VNode {
  return h('button', { type: 'button', class: 'pz-notice', tabindex, onClick }, label)
}

/** Open the part options of the part holding `id` (a picture in a gallery opens the gallery's). */
function useOpenOptions(): (id: string) => void {
  const ui = useUi()
  return (id) => { ui.add.value = null; ui.options.value = topLevel(ui.editor.tree, id) }
}

/** A caption (or transcript) field, shown while you are on the part or when it has text. */
function optionalField(editor: ReturnType<typeof useEditor>, node: BlockNode, attr: string, placeholder: string, classes: string): VNode | null {
  if (!editor.fieldShown(node, attr)) return null
  return h(RichTextView, { blockId: node.id, attr, tag: 'div', key: attr, classes, 'data-placeholder': placeholder })
}

// ---------------------------------------------------------------------------
// Picture

const ImageEdit = defineComponent({
  name: 'ProzaImage',
  props,
  setup(p) {
    const ui = useUi()
    const { editor, t } = ui
    const reach = useReach(() => p.id)
    const open = useOpenOptions()
    const fromAddress = async (url: string): Promise<void> => {
      const was = editor.tree.nodes.get(p.id)
      const generation = editor.generation
      const size = await measureImage(url)
      const patch = { src: url, naturalWidth: size?.width ?? 0, naturalHeight: size?.height ?? 0, srcset: '' }
      // Measuring can take seconds: an upload may have filled the part, or new content taken the document, meanwhile.
      const now = editor.tree.nodes.get(p.id)
      if (editor.generation !== generation || !now || !was || Object.keys(patch).some((k) => now.attrs[k] !== was.attrs[k])) {
        editor.announce(t.attachmentStale, 'assertive')
        return
      }
      editor.setAttrs(p.id, patch, t.media.image.added)
    }
    return () => {
      const n = p.node
      const w = p.wrapper
      const parent = parentOf(editor.tree, n.id)
      const inGallery = parent !== null && editor.tree.nodes.get(parent)?.type === GALLERY
      const src = str(n, 'src')
      const cls = [...w.class, 'pz-image', !inGallery && `pz-width-${str(n, 'width') || 'l'}`]
      const described = str(n, 'alt') !== '' || n.attrs.decorative === true
      const body = src === ''
        ? h(MediaSource, {
          blockId: n.id, kind: 'image', patch: imagePatch, compact: inGallery,
          onFiles: (files: File[], source: UploadSource) => { ui.uploads.start(n.id, 'image', files[0]!, imagePatch, source) },
          onUrl: (url: string) => { void fromAddress(url) },
        })
        : h('div', { class: 'pz-frame' }, [
          h('img', {
            src, alt: n.attrs.decorative === true ? '' : str(n, 'alt'), draggable: 'false', class: 'pz-img',
            ...(num(n, 'naturalWidth') > 0 ? { width: num(n, 'naturalWidth'), height: num(n, 'naturalHeight') } : {}),
          }),
          described ? null : notice(t.needsDescription, reach(), () => { open(n.id) }),
        ])
      return h('figure', { ...w, role: 'group', class: cls }, [body, src === '' ? null : optionalField(editor, n, 'caption', t.captionPlaceholder, 'pz-caption')])
    }
  },
})

// ---------------------------------------------------------------------------
// Gallery

const GalleryEdit = defineComponent({
  name: 'ProzaGallery',
  props,
  setup(p) {
    const ui = useUi()
    const { editor, t } = ui
    /** New pictures at the end of the gallery, one undo step, then their uploads. */
    const addImages = (files: File[], source: UploadSource): void => {
      const ctx = editor.context()
      const blocks = files.map(() => newBlock(ctx, IMAGE))
      if (!editor.apply({ ops: [{ type: 'insertBlocks', parentId: p.id, index: childrenOf(editor.tree, p.id).length, blocks }], selection: editor.selection }, { keepFocus: true })) return
      files.forEach((f, i) => { ui.uploads.start(blocks[i]!.id, 'image', f, imagePatch, source) })
    }
    const addAddress = async (url: string): Promise<void> => {
      const generation = editor.generation
      const size = await measureImage(url)
      if (editor.generation !== generation || !editor.tree.nodes.has(p.id)) { editor.announce(t.attachmentStale, 'assertive'); return }
      const ctx = editor.context()
      const b = newBlock(ctx, IMAGE, { src: url, naturalWidth: size?.width ?? 0, naturalHeight: size?.height ?? 0 })
      editor.apply({ ops: [{ type: 'insertBlocks', parentId: p.id, index: childrenOf(editor.tree, p.id).length, blocks: [b] }], selection: editor.selection, announce: t.media.image.added }, { keepFocus: true })
    }
    return () => {
      const n = p.node
      const w = p.wrapper
      return h('figure', { ...w, role: 'group', class: [...w.class, 'pz-gallery', `pz-cols-${String(n.attrs.columns)}`] }, [
        h('div', { class: 'pz-gallery-grid' }, [
          h(BlockList, { parent: n.id }),
          h(MediaSource, {
            key: 'add', blockId: n.id, kind: 'image', patch: imagePatch, multiple: true, compact: childrenOf(editor.tree, n.id).length > 0,
            onFiles: addImages, onUrl: (url: string) => { void addAddress(url) },
          }),
        ]),
        optionalField(editor, n, 'caption', t.captionPlaceholder, 'pz-caption'),
      ])
    }
  },
})

// ---------------------------------------------------------------------------
// Video and audio

const VideoEdit = defineComponent({
  name: 'ProzaVideo',
  props,
  setup(p) {
    const ui = useUi()
    const { editor, t } = ui
    const reach = useReach(() => p.id)
    const open = useOpenOptions()
    return () => {
      const n = p.node
      const w = p.wrapper
      const src = str(n, 'src')
      const captioned = str(n, 'captions') !== '' || (n.attrs.transcript as { text: string }).text !== ''
      const body = src === ''
        ? h(MediaSource, {
          blockId: n.id, kind: 'video', patch: videoPatch,
          onFiles: (files: File[], source: UploadSource) => { ui.uploads.start(n.id, 'video', files[0]!, videoPatch, source) },
          onUrl: (url: string) => { editor.setAttrs(n.id, { src: url }, t.media.video.added) },
        })
        : h('div', { class: 'pz-frame' }, [
          h('video', {
            src, controls: true, preload: 'metadata', class: 'pz-media', tabindex: reach(), 'aria-label': editor.labelFor(n),
            ...(str(n, 'poster') ? { poster: str(n, 'poster') } : {}),
          }, str(n, 'captions') ? h('track', { kind: 'captions', src: str(n, 'captions'), srclang: str(n, 'captionsLang') || undefined, label: t.captions, default: true }) : []),
          captioned ? null : notice(t.needsCaptions, reach(), () => { open(n.id) }),
        ])
      return h('figure', { ...w, role: 'group', class: [...w.class, 'pz-video'] }, [
        body,
        src === '' ? null : optionalField(editor, n, 'caption', t.captionPlaceholder, 'pz-caption'),
        src === '' ? null : optionalField(editor, n, 'transcript', t.transcriptPlaceholder, 'pz-transcript-field'),
      ])
    }
  },
})

const AudioEdit = defineComponent({
  name: 'ProzaAudio',
  props,
  setup(p) {
    const ui = useUi()
    const { editor, t } = ui
    const reach = useReach(() => p.id)
    return () => {
      const n = p.node
      const w = p.wrapper
      const src = str(n, 'src')
      const transcribed = (n.attrs.transcript as { text: string }).text !== ''
      const body = src === ''
        ? h(MediaSource, {
          blockId: n.id, kind: 'audio', patch: audioPatch,
          onFiles: (files: File[], source: UploadSource) => { ui.uploads.start(n.id, 'audio', files[0]!, audioPatch, source) },
          onUrl: (url: string) => { editor.setAttrs(n.id, { src: url }, t.media.audio.added) },
        })
        : h('div', { class: 'pz-frame pz-frame-audio' }, [
          h('audio', { src, controls: true, preload: 'metadata', class: 'pz-media', tabindex: reach(), 'aria-label': editor.labelFor(n) }),
          // Audio has no captions: the transcript is the text alternative (WCAG 1.2.1).
          transcribed ? null : notice(t.needsTranscript, reach(), () => { editor.select(caret(n.id, 'transcript', 0)) }),
        ])
      return h('figure', { ...w, role: 'group', class: [...w.class, 'pz-audio'] }, [
        body,
        src === '' ? null : optionalField(editor, n, 'caption', t.captionPlaceholder, 'pz-caption'),
        src === '' ? null : optionalField(editor, n, 'transcript', t.transcriptPlaceholder, 'pz-transcript-field'),
      ])
    }
  },
})

// ---------------------------------------------------------------------------
// Embed

const EmbedEdit = defineComponent({
  name: 'ProzaEmbed',
  props,
  setup(p) {
    const ui = useUi()
    const { editor, t } = ui
    const reach = useReach(() => p.id)
    const open = useOpenOptions()
    const address = ref('')
    const title = ref('')
    const error = ref(false)
    const preview = ref(false)
    const first = ref<HTMLInputElement>()
    onMounted(() => { if (str(p.node, 'url') === '' && editor.isSelected(p.id)) first.value?.focus() })
    const submit = (): void => {
      if (!embedFor(address.value)) { error.value = true; return }
      editor.setAttrs(p.id, { url: address.value.trim(), title: title.value.trim() }, t.embedAdded)
    }
    return () => {
      const n = p.node
      const w = p.wrapper
      const url = str(n, 'url')
      const tab = reach()
      const hit = url === '' ? null : embedFor(url)
      // The canvas frames only what output may frame: a provider whose player address fails its own pattern is refused here too.
      const found = hit && isPlayerUrl(hit.player) ? hit : null
      let body: VNode
      if (url === '') {
        const errId = `${n.id}-embed-err`
        body = h('form', { class: 'drop drop-form', onSubmit: (e: Event) => { e.preventDefault(); submit() } }, [
          h('label', { class: 'lab', for: `${n.id}-embed-url` }, t.embedAddress),
          h('input', {
            ref: first, id: `${n.id}-embed-url`, class: 'field', type: 'text', inputmode: 'url', tabindex: tab, value: address.value, placeholder: 'https://www.youtube.com/watch?v=…',
            autocomplete: 'off', spellcheck: 'false', 'aria-invalid': error.value ? 'true' : undefined, 'aria-describedby': `${n.id}-embed-hint${error.value ? ` ${errId}` : ''}`,
            onInput: (e: Event) => { address.value = (e.target as HTMLInputElement).value; error.value = false },
          }),
          h('p', { class: 'hint', id: `${n.id}-embed-hint` }, t.embedProviders(t.either(embedProviders().map((x) => x.name)))),
          error.value ? h('p', { class: 'hint is-error', id: errId }, t.embedUnsupported(t.either(embedProviders().map((x) => x.name)))) : null,
          h('label', { class: 'lab', for: `${n.id}-embed-title` }, t.embedTitle),
          h('input', {
            id: `${n.id}-embed-title`, class: 'field', type: 'text', tabindex: tab, value: title.value, placeholder: t.embedTitlePlaceholder,
            onInput: (e: Event) => { title.value = (e.target as HTMLInputElement).value },
          }),
          h('button', { type: 'submit', class: 'btn btn-add', tabindex: tab }, t.embedSubmit),
        ])
      } else if (!found) {
        body = h('div', { class: 'drop is-error' }, [h('p', { class: 'drop-error' }, t.embedUnsupported(t.either(embedProviders().map((x) => x.name)))), h('span', { class: 'pz-embed-url' }, url)])
      } else if (preview.value) {
        // Only on request: the editor loads nothing from the provider before the author asks (privacy).
        body = h('div', { class: `pz-embed-frame pz-ratio-${str(n, 'ratio') || '16-9'}` }, h('iframe', {
          src: found.player, title: str(n, 'title') || found.provider.name, tabindex: tab,
          sandbox: 'allow-scripts allow-same-origin allow-presentation', allow: 'fullscreen; picture-in-picture; encrypted-media', allowfullscreen: true, referrerpolicy: 'strict-origin-when-cross-origin',
        }))
      } else {
        body = h('div', { class: `pz-embed-card pz-ratio-${str(n, 'ratio') || '16-9'}` }, [
          h('button', { type: 'button', class: 'pz-embed-play', tabindex: tab, 'aria-label': t.embedPreview(found.provider.name), onClick: () => { preview.value = true } }, icon('play')),
          h('span', { class: 'pz-embed-meta' }, [
            h('strong', null, str(n, 'title') || t.embedUntitled),
            h('span', null, `${found.provider.name} · ${excerpt(url, 60)}`),
          ]),
          str(n, 'title') === '' ? notice(t.needsTitle, tab, () => { open(n.id) }) : null,
        ])
      }
      return h('figure', { ...w, role: 'group', class: [...w.class, 'pz-embed'] }, [body, url === '' ? null : optionalField(editor, n, 'caption', t.captionPlaceholder, 'pz-caption')])
    }
  },
})

// ---------------------------------------------------------------------------
// File

const FileEdit = defineComponent({
  name: 'ProzaFile',
  props,
  setup(p) {
    const ui = useUi()
    const { editor, t } = ui
    return () => {
      const n = p.node
      const w = p.wrapper
      const href = str(n, 'href')
      if (href === '') {
        return h('div', { ...w, role: 'group', class: [...w.class, 'pz-file'] }, h(MediaSource, {
          blockId: n.id, kind: 'file', patch: filePatch,
          onFiles: (files: File[], source: UploadSource) => { ui.uploads.start(n.id, 'file', files[0]!, filePatch, source) },
          onUrl: (url: string) => { editor.setAttrs(n.id, { href: url, name: decodeName(url) }, t.media.file.added) },
        }))
      }
      const name = str(n, 'name') || decodeName(href)
      const meta = [fileType(name) || fileType(href), num(n, 'bytes') > 0 ? formatBytes(num(n, 'bytes')) : ''].filter(Boolean).join(', ')
      // Not a live link in the canvas: a click selects the part, as on a picture.
      return h('div', { ...w, role: 'group', class: [...w.class, 'pz-file'] }, h('div', { class: 'pz-file-card' }, [
        icon('file'), h('span', { class: 'pz-file-name' }, name), meta ? h('span', { class: 'pz-file-meta' }, meta) : null,
      ]))
    }
  },
})

// ---------------------------------------------------------------------------
// Definitions

const name = (type: string) => (_n: BlockNode, s: { blockNames: Readonly<Record<string, string>> }): string => s.blockNames[type] ?? type

const mediaItem = (type: string, drawing: InserterItem['drawing'], keywords: readonly string[], create?: InserterItem['create']): InserterItem => ({
  id: type, category: 'media', drawing, keywords: [type.replace('core/', ''), ...keywords],
  title: (s) => s.blockNames[type] ?? type,
  create: create ?? ((ctx) => [newBlock(ctx, type)]),
})

const caption = { attr: 'caption', optional: true } as const
const transcript = { attr: 'transcript', optional: true, multiline: true, inputRules: false } as const

const imageEditing: BlockEditing = {
  name: IMAGE,
  fields: [caption],
  group: true,
  title: name(IMAGE),
  label: (n, s) => s.blockLabel(s.blockNames[IMAGE] ?? IMAGE, n.attrs.decorative === true ? s.decorativePicture : excerpt(str(n, 'alt')) || s.noDescription),
  fieldLabel: (_n, attr, s) => s.fieldNames[attr] ?? attr,
  media: { kind: 'image', patch: imagePatch },
  inserter: [mediaItem(IMAGE, { ink: ['M6 4h84v40H6z', 'm8 40 22-20 14 12 12-9 30 17'], dots: [[70, 15, 5]] }, ['image', 'img', 'photo'])],
}

const galleryEditing: BlockEditing = {
  name: GALLERY,
  fields: [{ ...caption, after: true }],
  group: true,
  title: name(GALLERY),
  label: (n, s) => s.blockLabel(s.blockNames[GALLERY] ?? GALLERY, excerpt((n.attrs.caption as { text: string }).text)),
  fieldLabel: (_n, attr, s) => s.fieldNames[attr] ?? attr,
  inserter: [mediaItem(GALLERY, { ink: ['M6 4h26v18H6zM36 4h26v18H36zM66 4h24v18H66zM6 26h26v18H6zM36 26h26v18H36z'], accent: ['M66 26h24v18H66z'] }, ['images', 'photos', 'grid'])],
}

const videoEditing: BlockEditing = {
  name: VIDEO,
  fields: [caption, transcript],
  group: true,
  title: name(VIDEO),
  label: (n, s) => s.blockLabel(s.blockNames[VIDEO] ?? VIDEO, excerpt((n.attrs.caption as { text: string }).text)),
  fieldLabel: (_n, attr, s) => s.fieldNames[attr] ?? attr,
  media: { kind: 'video', patch: videoPatch },
  inserter: [mediaItem(VIDEO, { ink: ['M6 4h84v40H6z'], accent: ['M42 15v18l15-9z'] }, ['movie', 'mp4', 'film'])],
}

const audioEditing: BlockEditing = {
  name: AUDIO,
  fields: [caption, transcript],
  group: true,
  title: name(AUDIO),
  label: (n, s) => s.blockLabel(s.blockNames[AUDIO] ?? AUDIO, excerpt((n.attrs.caption as { text: string }).text)),
  fieldLabel: (_n, attr, s) => s.fieldNames[attr] ?? attr,
  media: { kind: 'audio', patch: audioPatch },
  inserter: [mediaItem(AUDIO, { ink: ['M6 24h6M18 14v20M26 8v32M34 18v12M42 12v24M50 20v8M58 10v28M66 16v16M74 22v4M82 14v20M90 24h0'], accent: ['M26 8v32M58 10v28'] }, ['sound', 'podcast', 'mp3', 'music'])],
}

const embedEditing: BlockEditing = {
  name: EMBED,
  fields: [caption],
  group: true,
  title: name(EMBED),
  label: (n, s) => s.blockLabel(s.blockNames[EMBED] ?? EMBED, excerpt(str(n, 'title'))),
  fieldLabel: (_n, attr, s) => s.fieldNames[attr] ?? attr,
  inserter: [mediaItem(EMBED, { ink: ['M6 4h84v40H6z', 'M14 36h30'], accent: ['M44 14v14l12-7z'] }, ['embed', 'youtube', 'vimeo', 'iframe'])],
}

const fileEditing: BlockEditing = {
  name: FILE,
  fields: [],
  title: name(FILE),
  label: (n, s) => s.blockLabel(s.blockNames[FILE] ?? FILE, str(n, 'name') || (str(n, 'href') ? decodeName(str(n, 'href')) : '')),
  media: { kind: 'file', patch: filePatch },
  inserter: [mediaItem(FILE, { ink: ['M30 4h24l12 12v28H30z', 'M54 4v12h12'], accent: ['M38 30h20M38 37h14'] }, ['download', 'pdf', 'attachment', 'document'])],
}

const join = (schema: RenderableBlock, def: BlockEditing, edit: Component, inspector: Component): BlockDefinition =>
  defineBlock({ ...schema, ...def, edit, inspector, a11y: checksFor(schema.name), parse: mediaParse[schema.name] ?? [] })

/** The core media blocks. */
export const mediaBlockDefinitions: readonly BlockDefinition[] = [
  join(image, { ...imageEditing, transforms: imageTransforms }, ImageEdit, ImageInspector),
  join(gallery, { ...galleryEditing, transforms: galleryTransforms }, GalleryEdit, GalleryInspector),
  join(video, videoEditing, VideoEdit, VideoInspector),
  join(audio, audioEditing, AudioEdit, AudioInspector),
  join(embed, embedEditing, EmbedEdit, EmbedInspector),
  join(file, fileEditing, FileEdit, FileInspector),
]
