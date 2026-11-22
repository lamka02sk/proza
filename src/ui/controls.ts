/**
 * Small controls shared by the part options and the block libraries'
 * settings: a labelled row, a
 * segmented control, a text input that commits on change, a checkbox.
 */
import { type PropType, type VNode, defineComponent, h, ref, useId, watch } from 'vue'
import { type IconName, icon } from './icons'

export interface SegOption<T extends string | number> {
  readonly value: T
  readonly label: string
  /** Icon-only buttons keep the label as their name. */
  readonly icon?: IconName
  readonly disabled?: boolean
  /** Id of a warning this choice would cause (a heading level that skips one). */
  readonly describedBy?: string
}

/** A label above or beside its control. `column` stacks them (inputs, wide segments). */
export function row(label: string, control: VNode | (VNode | null)[], options: { column?: boolean; labelFor?: string; id?: string } = {}): VNode {
  const lab = options.labelFor
    ? h('label', { class: 'lab', for: options.labelFor }, label)
    : h('span', { class: 'lab', id: options.id }, label)
  return h('div', { class: ['row', options.column && 'row-col'] }, [lab, ...(Array.isArray(control) ? control : [control])])
}

/** Segmented control: a group of toggle buttons, the pressed one is the value. */
export const Seg = defineComponent({
  name: 'ProzaSeg',
  props: {
    label: { type: String, required: true },
    options: { type: Array as PropType<readonly SegOption<string | number>[]>, required: true },
    value: { type: [String, Number] as PropType<string | number | null>, default: null },
  },
  emits: { pick: (v: string | number) => v !== '' },
  setup(props, { emit }) {
    return () => h('div', { class: 'seg', role: 'group', 'aria-label': props.label }, props.options.map((o) => h('button', {
      type: 'button',
      class: ['btn', o.value === props.value && 'is-on', o.icon && 'btn-icon'],
      'aria-pressed': o.value === props.value ? 'true' : 'false',
      disabled: o.disabled === true,
      ...(o.icon ? { 'aria-label': o.label, title: o.label } : {}),
      ...(o.describedBy ? { 'aria-describedby': o.describedBy } : {}),
      onClick: () => { emit('pick', o.value) },
    }, o.icon ? icon(o.icon) : o.label)))
  },
})

/**
 * A text input that commits on change (blur or Enter) after validation. An
 * invalid value shows its error under the input and is not committed.
 */
export const TextInput = defineComponent({
  name: 'ProzaTextInput',
  props: {
    label: { type: String, required: true },
    value: { type: String, required: true },
    hint: { type: String, default: '' },
    type: { type: String, default: 'text' },
    placeholder: { type: String, default: '' },
    /** Returns the error text, or null when the value is fine. */
    validate: { type: Function as PropType<(v: string) => string | null>, default: () => null },
    inputmode: { type: String as PropType<'text' | 'numeric'>, default: 'text' },
    /** More than 0: a text area of that many rows (a picture's description). */
    rows: { type: Number, default: 0 },
    disabled: { type: Boolean, default: false },
  },
  emits: { commit: (v: string) => typeof v === 'string' },
  setup(props, { emit }) {
    const id = useId()
    const draft = ref(props.value)
    const error = ref<string | null>(null)
    watch(() => props.value, (v) => { draft.value = v; error.value = null })
    const commit = (): void => {
      const v = draft.value.trim()
      error.value = props.validate(v)
      if (error.value === null && v !== props.value) emit('commit', v)
    }
    return () => {
      const describedBy = [props.hint && `${id}-hint`, error.value && `${id}-err`].filter(Boolean).join(' ')
      return h('div', { class: 'row row-col' }, [
        h('label', { class: 'lab', for: id }, props.label),
        h(props.rows > 0 ? 'textarea' : 'input', {
          id, class: 'field', value: draft.value, placeholder: props.placeholder || undefined, disabled: props.disabled,
          ...(props.rows > 0 ? { rows: props.rows } : { type: props.type, inputmode: props.inputmode, spellcheck: 'false', autocomplete: 'off' }),
          'aria-invalid': error.value ? 'true' : undefined,
          'aria-describedby': describedBy || undefined,
          onInput: (e: Event) => { draft.value = (e.target as HTMLInputElement).value },
          onChange: commit,
          // In a text area Enter commits too: a description is one paragraph, read aloud.
          onKeydown: (e: KeyboardEvent) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit() } },
        }),
        props.hint ? h('p', { class: 'hint', id: `${id}-hint` }, props.hint) : null,
        error.value ? h('p', { class: 'hint is-error', id: `${id}-err` }, error.value) : null,
      ])
    }
  },
})

export function checkbox(label: string, checked: boolean, onChange: (v: boolean) => void, hint = '', hintId = ''): VNode {
  return h('label', { class: ['row check', hint && 'has-hint'] }, [
    h('input', { type: 'checkbox', checked, 'aria-describedby': hint && hintId ? hintId : undefined, onChange: (e: Event) => { onChange((e.target as HTMLInputElement).checked) } }),
    hint ? h('span', { class: 'check-text' }, [label, h('span', { class: 'hint', id: hintId || undefined }, hint)]) : label,
  ])
}
