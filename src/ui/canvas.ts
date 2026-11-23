/**
 * The canvas: the block list drawn from the editor's reactive state.
 * Render functions, no templates: the runtime build of Vue has no
 * template compiler, so there is no eval under a strict CSP.
 *
 * Vue renders each field's element and never its children: the field owns
 * that subtree. Vue sets no `class` on a field element,
 * because patching `class` would remove the field's own.
 */
import { type InjectionKey, type PropType, type VNode, computed, defineComponent, getCurrentInstance, h, inject, onBeforeUnmount, onMounted, onUpdated, ref } from 'vue'
import { type Editor, fieldKey } from '../editor/editor'
import { parseStyle } from '../model/css'
import { cleanStyle, keepClasses } from '../model/legacy'
import { type ParentId, childrenOf, parentOf } from '../model/tree'
import { supportClasses } from '../render/render'
import type { RichTextField } from '../richtext/field'
import { uiKey } from './context'

export const EDITOR: InjectionKey<Editor> = Symbol('proza-editor')

/** Id of the description every selected block points at. */
export const ACTIONS_ID = 'pz-block-actions'

export function useEditor(): Editor {
  const editor = inject(EDITOR)
  if (!editor) throw new Error('Proza canvas component outside an editor')
  return editor
}

/** Attributes the block's root element must carry: identity, state, focus and name. */
export interface WrapperProps {
  readonly 'data-block': string
  readonly 'data-type': string
  readonly class: (string | false)[]
  readonly tabindex: number
  readonly 'aria-label'?: string
  readonly 'aria-describedby'?: string
  readonly contenteditable?: 'false'
  /** A legacy part's own look (decision 0020), set through the CSSOM. */
  readonly style?: Readonly<Record<string, string>>
}

/** A legacy part's style and classes as the canvas shows them, by the same policy the page uses. */
function legacyLook(editor: Editor, attrs: Readonly<Record<string, unknown>>): { style?: Record<string, string>; classes: string[] } {
  const rules = editor.legacy
  if (!rules) return { classes: [] }
  const css = cleanStyle(typeof attrs.htmlStyle === 'string' ? attrs.htmlStyle : '', rules.style)
  const cls = keepClasses(typeof attrs.htmlClass === 'string' ? attrs.htmlClass : '', rules.className)
  return { ...(css !== '' ? { style: Object.fromEntries(parseStyle(css)) } : {}), classes: cls === '' ? [] : cls.split(' ') }
}

/** The children of a container (or of the document), in order. */
export const BlockList = defineComponent({
  name: 'ProzaBlockList',
  props: { parent: { type: String as PropType<ParentId>, default: null } },
  setup(props) {
    const editor = useEditor()
    const kids = editor.kidsRef(props.parent)
    return () => kids.value.map((id) => h(BlockView, { id, key: id }))
  },
})

/** One block: its editing component with the wrapper attributes, or a placeholder. */
export const BlockView = defineComponent({
  name: 'ProzaBlock',
  props: { id: { type: String, required: true } },
  setup(props) {
    const editor = useEditor()
    const ui = inject(uiKey, null)
    const node = editor.nodeRef(props.id)
    // Report the root element, so the editor finds it without searching the canvas and the tools follow a remount.
    const self = getCurrentInstance()
    const report = (): void => { const el: unknown = self?.proxy?.$el; editor.setBlockElement(props.id, el instanceof HTMLElement ? el : null) }
    onMounted(report)
    onUpdated(report)
    onBeforeUnmount(() => { if (editor.blockElement(props.id) === self?.proxy?.$el) editor.setBlockElement(props.id, null) })
    return (): VNode | null => {
      const n = node.value
      if (!n) return null
      const def = editor.editingFor(n.type)
      const selected = editor.isSelected(n.id)
      // Blocks without text are always focusable groups; text blocks only while selected.
      const named = selected || !def || def.fields.length === 0 || def.group === true
      // While text is selected across parts the canvas is editable: parts without
      // text of their own stay out of it, so their controls work and the selection passes over them.
      // Only these read \`spanning\`, so text parts do not re-render when it changes.
      const island = (!def || def.fields.length === 0 || def.group === true) && !(editor.tree.children.get(n.id)?.length) ? editor.spanning.value : false
      const look = legacyLook(editor, n.attrs)
      const wrapper: WrapperProps = {
        'data-block': n.id,
        'data-type': n.type,
        class: ['pz-block', selected && 'is-selected', editor.isCurrent(n.id) && 'is-current', n.attrs.lock === 'move' || n.attrs.lock === 'all' ? 'is-locked' : false, `pz-t-${n.type.replace(/^core\//, '')}`, ...supportClasses(n.attrs, parentOf(editor.tree, n.id) === null), ...look.classes],
        ...(look.style ? { style: look.style } : {}),
        tabindex: editor.isTabStop(n.id) ? 0 : -1,
        ...(named ? { 'aria-label': editor.labelFor(n), 'aria-describedby': ACTIONS_ID } : {}),
        ...(island ? { contenteditable: 'false' } : {}),
      }
      if (!def?.edit) {
        return h('div', { ...wrapper, role: 'group', class: [...wrapper.class, 'pz-unsupported'] }, [
          h('strong', null, editor.strings.unsupported(n.type)),
          ui ? h('span', null, ui.t.unsupportedHint) : null,
        ])
      }
      return h(def.edit, { id: n.id, node: n, wrapper })
    }
  },
})

/**
 * The element of one rich-text field. The editor mounts a RichTextField on
 * it; a change of tag (heading level) needs a new element, so parents key this by tag.
 */
export const RichTextView = defineComponent({
  name: 'ProzaRichText',
  props: {
    blockId: { type: String, required: true },
    attr: { type: String, required: true },
    tag: { type: String, required: true },
    /** Classes of the field element, set once at mount (Vue never patches `class` here). */
    classes: { type: String, default: '' },
  },
  setup(props) {
    const editor = useEditor()
    const el = ref<HTMLElement>()
    const node = editor.nodeRef(props.blockId)
    let field: RichTextField | null = null
    onMounted(() => {
      if (props.classes) el.value!.classList.add(...props.classes.split(' '))
      field = editor.mountField(el.value!, props.blockId, props.attr)
    })
    onBeforeUnmount(() => { if (field) editor.unmountField(field) })
    const ui = inject(uiKey, null)
    /** What an empty field says. Optional fields carry their own. */
    const placeholder = (): string | undefined => {
      const n = node.value
      if (!ui || !n || props.attr !== 'content') return undefined
      if (n.type === 'core/paragraph') {
        const top = childrenOf(editor.tree, null)
        if (top.length === 1 && top[0] === n.id) return ui.t.placeholder
        return editor.isCurrent(n.id) ? ui.t.emptyLine : undefined
      }
      if (n.type === 'core/heading' && editor.isCurrent(n.id)) return ui.t.headingPlaceholder
      return undefined
    }
    // Only the field the menu speaks for re-renders when its attributes change, not every field.
    const aria = computed(() => {
      const a = ui?.fieldAria.value
      return a && a.blockId === props.blockId ? a.attrs : null
    })
    return () => {
      const n = node.value
      const empty = n ? editor.fieldShown(n, props.attr) && isEmpty(n.attrs[props.attr]) : false
      const ph = empty ? placeholder() : undefined
      return h(props.tag, {
        ref: el,
        'data-field': props.attr,
        tabindex: editor.isTabStop(fieldKey(props.blockId, props.attr)) ? 0 : -1,
        'aria-label': n ? editor.fieldLabel(n, props.attr) : undefined,
        'data-empty': empty ? '' : undefined,
        ...(ph ? { 'data-placeholder': ph, 'aria-placeholder': ph } : {}),
        ...aria.value,
      })
    }
  },
})

function isEmpty(v: unknown): boolean {
  return typeof v === 'object' && v !== null && (v as { text?: unknown }).text === ''
}
