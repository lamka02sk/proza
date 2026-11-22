/**
 * Rows of the part options for the media blocks:
 * width, the description a screen reader
 * reads (or an explicit "decorative"), captions and transcript for video and
 * audio, the title of an embed. Every change is one undo step.
 */
import { type PropType, type VNode, defineComponent, h, ref, useId } from 'vue'
import { embedFor, embedProviders } from '../model/embeds'
import { LANG_PATTERN } from '../model/richtext'
import { type BlockNode, childrenOf } from '../model/tree'
import { safeUrl } from '../model/url'
import { useUi } from '../ui/context'
import { Seg, TextInput, checkbox } from '../ui/controls'
import { icon } from '../ui/icons'
import { ACCEPT } from '../ui/upload'
import { RATIOS } from './media'
import { captionsPatch } from './media-patch'

const props = {
  id: { type: String, required: true },
  node: { type: Object as PropType<BlockNode>, required: true },
} as const

const str = (node: BlockNode, k: string): string => (typeof node.attrs[k] === 'string' ? node.attrs[k] : '')

function useRows() {
  const ui = useUi()
  const { editor, t } = ui
  const set = (id: string, patch: Record<string, unknown>, announce = ''): void => { editor.setAttrs(id, patch, announce) }
  const url = (label: string, id: string, attr: string, node: BlockNode, hint = ''): VNode => h(TextInput, {
    label, hint, type: 'url', value: str(node, attr), placeholder: t.addressPlaceholder,
    validate: (v: string) => (v === '' || safeUrl(v) !== null ? null : t.addressInvalid),
    onCommit: (v: string) => { set(id, { [attr]: v }) },
  })
  /** Empties the part, so its drop zone comes back; Undo returns the old file. */
  const replace = (label: string, id: string, patch: Record<string, unknown>): VNode => h('button', {
    type: 'button', class: 'btn', onClick: () => { set(id, patch) },
  }, [icon('swap'), label])
  return { ui, editor, t, set, url, replace }
}

/** Description and the decorative choice of one picture (also used per picture of a gallery). */
function describe(r: ReturnType<typeof useRows>, node: BlockNode, label: string, hintId: string): VNode[] {
  const decorative = node.attrs.decorative === true
  return [
    h(TextInput, {
      label, hint: r.t.descriptionHint, value: str(node, 'alt'), rows: 2, disabled: decorative, placeholder: r.t.descriptionPlaceholder,
      onCommit: (v: string) => { r.set(node.id, { alt: v }, v === '' ? '' : r.t.described) },
    }),
    checkbox(r.t.decorative, decorative, (v) => { r.set(node.id, { decorative: v }) }, r.t.decorativeHint, hintId),
  ]
}

export const ImageInspector = defineComponent({
  name: 'ProzaImageInspector',
  props,
  setup(p) {
    const r = useRows()
    const hintId = useId()
    return () => {
      const n = p.node
      if (str(n, 'src') === '') return h('div', { class: 'insp' }, h('p', { class: 'hint row' }, r.t.media.image.empty))
      return h('div', { class: 'insp' }, [
        h('div', { class: 'row' }, [
          h('span', { class: 'lab' }, r.t.width),
          h(Seg, {
            label: r.t.pictureWidth, value: str(n, 'width') || 'l',
            options: (['s', 'm', 'l'] as const).map((v) => ({ value: v, label: r.t.widthNames[v] })),
            // A smaller picture sits in the column: it is no longer wide or full.
            onPick: (v: string | number) => { r.set(p.id, v === 'l' ? { width: v } : { width: v, bleed: '' }) },
          }),
        ]),
        ...describe(r, n, r.t.description, hintId),
        r.url(r.t.linkTo, p.id, 'href', n, r.t.linkToHint),
        r.replace(r.t.media.image.replace, p.id, { src: '', srcset: '', naturalWidth: 0, naturalHeight: 0 }),
      ])
    }
  },
})

export const GalleryInspector = defineComponent({
  name: 'ProzaGalleryInspector',
  props,
  setup(p) {
    const r = useRows()
    const base = useId()
    return () => {
      const n = p.node
      const images = childrenOf(r.editor.tree, p.id).map((id) => r.editor.nodeRef(id).value).filter((x): x is BlockNode => x !== undefined && str(x, 'src') !== '')
      return h('div', { class: 'insp' }, [
        h('div', { class: 'row' }, [
          h('span', { class: 'lab' }, r.t.columns),
          h(Seg, {
            label: r.t.columns, value: n.attrs.columns as number,
            options: [2, 3, 4].map((c) => ({ value: c, label: String(c) })),
            onPick: (v: string | number) => { r.set(p.id, { columns: v }) },
          }),
        ]),
        images.length === 0 ? h('p', { class: 'hint row' }, r.t.media.image.empty) : null,
        ...images.map((img, i) => h('div', { class: 'insp-item', key: img.id }, [
          h('img', { class: 'insp-thumb', src: str(img, 'src'), alt: '' }),
          h('div', { class: 'insp-item-rows' }, describe(r, img, r.t.descriptionOf(i + 1, images.length), `${base}-${String(i)}`)),
        ])),
      ])
    }
  },
})

/** Captions: upload a WebVTT file or give its address, and its language. */
const Captions = defineComponent({
  name: 'ProzaCaptions',
  props,
  setup(p) {
    const r = useRows()
    const input = ref<HTMLInputElement>()
    return () => {
      const n = p.node
      const key = `${p.id}:captions`
      const state = r.ui.uploads.state.get(key)
      return h('div', { class: 'more' }, [
        r.url(r.t.captionsFile, p.id, 'captions', n, r.t.captionsHint),
        r.ui.uploads.available ? [
          h('input', {
            ref: input, type: 'file', class: 'vh', tabindex: -1, 'aria-hidden': 'true', accept: ACCEPT.captions,
            onChange: (e: Event) => {
              const f = (e.target as HTMLInputElement).files?.[0]
              if (f) r.ui.uploads.start(key, 'captions', f, captionsPatch, 'picker')
              ;(e.target as HTMLInputElement).value = ''
            },
          }),
          h('button', { type: 'button', class: 'btn', onClick: () => input.value?.click() }, [icon('plus'), r.t.uploadCaptions]),
          state ? h('p', { class: ['hint row', state.error && 'is-error'], role: state.error ? 'alert' : undefined }, state.error ?? r.t.uploading(state.name)) : null,
        ] : null,
        h(TextInput, {
          label: r.t.captionsLanguage, hint: r.t.languageHint, value: str(n, 'captionsLang'),
          validate: (v: string) => (v === '' || LANG_PATTERN.test(v) ? null : r.t.languageInvalid),
          onCommit: (v: string) => { r.set(p.id, { captionsLang: v }) },
        }),
      ])
    }
  },
})

export const VideoInspector = defineComponent({
  name: 'ProzaVideoInspector',
  props,
  setup(p) {
    const r = useRows()
    return () => {
      const n = p.node
      if (str(n, 'src') === '') return h('div', { class: 'insp' }, h('p', { class: 'hint row' }, r.t.media.video.empty))
      return h('div', { class: 'insp' }, [
        h('p', { class: 'hint row' }, r.t.captionsNote),
        h(Captions, { id: p.id, node: n }),
        r.url(r.t.poster, p.id, 'poster', n, r.t.posterHint),
        r.replace(r.t.media.video.replace, p.id, { src: '', naturalWidth: 0, naturalHeight: 0 }),
      ])
    }
  },
})

export const AudioInspector = defineComponent({
  name: 'ProzaAudioInspector',
  props,
  setup(p) {
    const r = useRows()
    return () => {
      const n = p.node
      if (str(n, 'src') === '') return h('div', { class: 'insp' }, h('p', { class: 'hint row' }, r.t.media.audio.empty))
      return h('div', { class: 'insp' }, [
        h('p', { class: 'hint row' }, r.t.transcriptNote),
        r.replace(r.t.media.audio.replace, p.id, { src: '' }),
      ])
    }
  },
})

export const EmbedInspector = defineComponent({
  name: 'ProzaEmbedInspector',
  props,
  setup(p) {
    const r = useRows()
    const hintId = useId()
    return () => {
      const n = p.node
      if (str(n, 'url') === '') return h('div', { class: 'insp' }, h('p', { class: 'hint row' }, r.t.embedProviders(r.t.either(embedProviders().map((x) => x.name)))))
      return h('div', { class: 'insp' }, [
        h(TextInput, {
          label: r.t.embedAddress, hint: r.t.embedProviders(r.t.either(embedProviders().map((x) => x.name))), type: 'url', value: str(n, 'url'),
          validate: (v: string) => (embedFor(v) ? null : r.t.embedUnsupported(r.t.either(embedProviders().map((x) => x.name)))),
          onCommit: (v: string) => { r.set(p.id, { url: v }) },
        }),
        h(TextInput, {
          label: r.t.embedTitle, hint: r.t.embedTitleHint, value: str(n, 'title'), placeholder: r.t.embedTitlePlaceholder,
          onCommit: (v: string) => { r.set(p.id, { title: v }) },
        }),
        h('div', { class: 'row row-col' }, [
          h('span', { class: 'lab' }, r.t.shape),
          h(Seg, {
            label: r.t.shape, value: str(n, 'ratio') || '16-9',
            options: RATIOS.map((v) => ({ value: v, label: r.t.ratioNames[v] })),
            onPick: (v: string | number) => { r.set(p.id, { ratio: v }) },
          }),
        ]),
        checkbox(r.t.facade, n.attrs.facade === true, (v) => { r.set(p.id, { facade: v }) }, r.t.facadeHint, hintId),
      ])
    }
  },
})

export const FileInspector = defineComponent({
  name: 'ProzaFileInspector',
  props,
  setup(p) {
    const r = useRows()
    return () => {
      const n = p.node
      if (str(n, 'href') === '') return h('div', { class: 'insp' }, h('p', { class: 'hint row' }, r.t.media.file.empty))
      return h('div', { class: 'insp' }, [
        h(TextInput, { label: r.t.fileName, hint: r.t.fileNameHint, value: str(n, 'name'), onCommit: (v: string) => { r.set(p.id, { name: v }) } }),
        r.url(r.t.fileAddress, p.id, 'href', n),
        r.replace(r.t.media.file.replace, p.id, { href: '', name: '', bytes: 0 }),
      ])
    }
  },
})
