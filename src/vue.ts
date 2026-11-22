/**
 * `<ProzaEditor v-model="doc" />` for Vue hosts. The
 * model is the stored JSON; HTML given as the model goes through the import
 * pipeline once, and the model then becomes JSON.
 */
import { type PropType, defineComponent, h, onBeforeUnmount, onMounted, ref, toRaw, watch } from 'vue'
import type { StoredDoc } from './model/schema'
import { type CreateEditorOptions, type ProzaEditor as Instance, createEditor } from './index'

export const ProzaEditor = defineComponent({
  name: 'ProzaEditorField',
  props: {
    modelValue: { type: [Object, String] as PropType<StoredDoc | string | null>, default: null },
    /** Everything `createEditor` takes except the target and the content. Read once, at mount. */
    options: { type: Object as PropType<Omit<CreateEditorOptions, 'target' | 'content'>>, default: () => ({}) },
    readOnly: { type: Boolean, default: false },
  },
  emits: {
    'update:modelValue': (doc: StoredDoc) => typeof doc === 'object',
    save: (doc: StoredDoc) => typeof doc === 'object',
    ready: (instance: Instance) => typeof instance === 'object',
  },
  setup(props, { emit, expose }) {
    const el = ref<HTMLElement>()
    let proza: Instance | null = null
    /** The model as last emitted, so the watcher can tell the host's own change from an echo. */
    let last: unknown = null
    let frame = 0
    const offs: (() => void)[] = []

    const emitModel = (): void => {
      frame = 0
      if (!proza) return
      last = proza.editor.getJSON()
      emit('update:modelValue', last as StoredDoc)
    }

    onMounted(() => {
      proza = createEditor({
        ...props.options,
        target: el.value!,
        ...(props.modelValue !== null ? { content: props.modelValue } : {}),
        readOnly: props.readOnly || props.options.readOnly === true,
      })
      const { editor } = proza
      // One serialisation per frame, not per keystroke.
      offs.push(editor.on('change', () => { if (!frame) frame = requestAnimationFrame(emitModel) }))
      offs.push(editor.on('save', () => { emit('save', editor.getJSON()) }))
      if (typeof props.modelValue === 'string') emitModel()
      emit('ready', proza)
    })

    watch(() => props.modelValue, (v) => {
      // A host's ref() hands back the emitted object wrapped in a proxy: unwrapped, an echo is not new content
      // (setContent would empty the undo history and cancel uploads on every frame).
      const raw = v === null ? null : toRaw(v)
      if (!proza || raw === last || raw === null) return
      last = raw
      proza.editor.setContent(raw)
    })
    watch(() => props.readOnly, (v) => { proza?.editor.setReadOnly(v) })

    onBeforeUnmount(() => {
      // The last edits still reach the model when the host unmounts within the frame.
      if (frame) { cancelAnimationFrame(frame); emitModel() }
      for (const off of offs) off()
      proza?.destroy()
      proza = null
    })

    expose({ instance: () => proza })
    return () => h('div', { ref: el, class: 'proza-host' })
  },
})
