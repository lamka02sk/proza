/**
 * The accessibility checker's panel (ATAG B.3): the
 * problems of the content by group, in reading order. Up and Down move
 * through them (one Tab stop), Enter goes to one; under the list, the focused
 * problem says what to do, with Go to it and its repair when there is one.
 * While the panel is open the text of each problem is marked in the canvas
 * (Custom Highlight API), the focused one more strongly.
 */
import { computed, defineComponent, h, nextTick, onBeforeUnmount, ref, shallowRef, useId, watch, type Ref } from 'vue'
import { stopsIn } from '../editor/editing'
import { blocks as blockSelection, caret } from '../editor/selection'
import type { Editor, Finding } from '../editor/editor'
import { topLevel, useUi, type Ui } from './context'
import { icon } from './icons'

const MARK = 'pz-check'
const MARK_CURRENT = 'pz-check-current'
/** The rule groups in their order; a plugin's own groups follow. */
const GROUPS = ['media', 'structure', 'tables', 'links', 'text']

/**
 * The findings, kept fresh while the text changes: after a pause, so typing never runs the rules.
 * One per interface; the status line's count and the panel share it.
 */
export function useFindings(editor: Editor): { findings: Ref<readonly Finding[]>; refresh: () => void; stop: () => void } {
  const findings = shallowRef<readonly Finding[]>([])
  let timer: ReturnType<typeof setTimeout> | undefined
  const refresh = (): void => { clearTimeout(timer); timer = undefined; findings.value = editor.check({ current: true }) }
  const later = (): void => { clearTimeout(timer); timer = setTimeout(refresh, 600) }
  const offs = [editor.on('change', later), editor.on('selection', later)]
  refresh()
  return { findings, refresh, stop: () => { clearTimeout(timer); for (const off of offs) off() } }
}

/** Where a finding is: its text when it has some, else the first field of its part, else the part (with its options for a picture). */
export function goToFinding(ui: Ui, f: Finding): void {
  const { editor } = ui
  if (!editor.tree.nodes.has(f.blockId)) return
  if (f.attr !== undefined) {
    editor.select({ kind: 'text', blockId: f.blockId, field: f.attr, anchor: f.start ?? 0, focus: f.end ?? f.start ?? 0 })
    return
  }
  const node = editor.tree.nodes.get(f.blockId)!
  const stop = editor.editingFor(node.type)?.group ? undefined : stopsIn(editor.context(), f.blockId).find((s) => s.field !== null)
  if (stop?.field) { editor.select(caret(stop.blockId, stop.field, 0)); return }
  editor.select(blockSelection(f.blockId))
  // Descriptions, captions and titles are set in the part options; they open once the focus is on the part.
  ui.add.value = null
  void nextTick(() => nextTick(() => { ui.options.value = topLevel(editor.tree, f.blockId) }))
}

export const CheckPanel = defineComponent({
  name: 'ProzaCheckPanel',
  props: { findings: { type: Object as () => Ref<readonly Finding[]>, required: true }, refresh: { type: Function as unknown as () => () => void, required: true } },
  emits: ['go'],
  setup(props, { emit }) {
    const ui = useUi()
    const { editor, t } = ui
    const id = useId()
    const focus = ref(0)
    const listEl = ref<HTMLElement>()
    const emptyEl = ref<HTMLElement>()

    const issues = computed(() => props.findings.value.map((f) => editor.describe(f)))
    const groups = computed(() => {
      const by = new Map<string, number[]>()
      issues.value.forEach((issue, i) => { const g = by.get(issue.group) ?? []; g.push(i); by.set(issue.group, g) })
      const order = [...GROUPS.filter((g) => by.has(g)), ...[...by.keys()].filter((g) => !GROUPS.includes(g))]
      return order.map((g) => ({ group: g, items: by.get(g)! }))
    })
    /** Indexes in the order they are shown, for the arrow keys. */
    const shown = computed(() => groups.value.flatMap((g) => g.items))

    /** Mark the problems' text in the canvas; the fields painted last time are cleared first. */
    let painted = new Set<string>()
    const paint = (clear = false): void => {
      const by = new Map<string, { blockId: string; attr: string; all: { start: number; end: number }[]; current: { start: number; end: number }[] }>()
      const active = shown.value[focus.value]
      if (!clear) props.findings.value.forEach((f, i) => {
        if (f.attr === undefined || f.start === undefined || f.end === undefined) return
        const key = `${f.blockId}\u0000${f.attr}`
        let e = by.get(key)
        if (!e) by.set(key, (e = { blockId: f.blockId, attr: f.attr, all: [], current: [] }))
        ;(i === active ? e.current : e.all).push({ start: f.start, end: f.end })
      })
      for (const key of painted) {
        if (by.has(key)) continue
        const [b, a] = key.split('\u0000') as [string, string]
        editor.field(b, a)?.setHighlight(MARK, [])
        editor.field(b, a)?.setHighlight(MARK_CURRENT, [])
      }
      for (const e of by.values()) {
        editor.field(e.blockId, e.attr)?.setHighlight(MARK, e.all)
        editor.field(e.blockId, e.attr)?.setHighlight(MARK_CURRENT, e.current)
      }
      painted = new Set(by.keys())
    }
    watch([props.findings, focus], () => { paint() }, { immediate: true })
    onBeforeUnmount(() => { paint(true) })

    const focusRow = (): void => {
      const row = listEl.value?.querySelector<HTMLElement>(`[data-issue="${String(focus.value)}"]`)
      if (row) { row.focus(); return }
      emptyEl.value?.focus()
    }
    const show = (i: number): void => {
      const f = props.findings.value[i]
      if (f) editor.blockElement(f.blockId)?.scrollIntoView({ block: 'nearest' })
    }
    // Open on the first problem, and say how many there are, of the text as it is now.
    props.refresh()
    void nextTick(() => {
      focusRow()
      editor.announce(t.checkFound(props.findings.value.length))
    })

    const go = (i: number): void => {
      const f = props.findings.value[i]
      if (!f) return
      emit('go')
      void nextTick(() => { goToFinding(ui, f) })
    }
    const fix = (i: number): void => {
      const f = props.findings.value[i]
      if (!f || !editor.fix(f)) return
      props.refresh()
      // Focus is never lost: the problem now in the same place, or the empty message.
      focus.value = Math.min(focus.value, Math.max(0, shown.value.length - 1))
      void nextTick(focusRow)
    }

    const onKey = (e: KeyboardEvent): void => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
      const n = shown.value.length
      const to = (i: number): void => { e.preventDefault(); focus.value = Math.max(0, Math.min(n - 1, i)); void nextTick(() => { focusRow(); show(shown.value[focus.value]!) }) }
      switch (e.key) {
        case 'ArrowDown': to(focus.value + 1); return
        case 'ArrowUp': to(focus.value - 1); return
        case 'Home': to(0); return
        case 'End': to(n - 1); return
        case 'Enter': case ' ': e.preventDefault(); go(shown.value[focus.value]!); return
      }
    }

    return () => {
      const list = issues.value
      const errors = list.filter((i) => i.severity === 'error').length
      const active = shown.value[focus.value]
      const current = active === undefined ? undefined : list[active]
      const hintId = `${id}-hint`
      let pos = -1
      return h('div', { class: 'ck' }, [
        h('strong', { class: 'pop-title' }, t.check),
        list.length === 0
          ? h('div', { ref: emptyEl, class: 'ck-none', tabindex: -1 }, [
            h('span', { class: 'ck-ok', 'aria-hidden': 'true' }, icon('check')),
            h('span', null, [h('strong', null, t.checkNone), ' ', t.checkNoneHint]),
          ])
          : [
            h('p', { class: 'hint' }, [h('strong', { class: 'ck-sum' }, t.checkSummary(errors, list.length - errors)), ' ', t.checkHint]),
            h('div', { ref: listEl, role: 'listbox', class: 'ck-list', 'aria-label': t.check, onKeydown: onKey }, groups.value.map((g) => h('div', { role: 'group', class: 'ck-group', 'aria-labelledby': `${id}-${g.group}` }, [
              h('div', { class: 'ck-group-name', id: `${id}-${g.group}`, role: 'presentation' }, editor.strings.checkGroups[g.group] ?? g.group),
              ...g.items.map((i) => {
                const issue = list[i]!
                const at = ++pos
                const on = at === focus.value
                const error = issue.severity === 'error'
                return h('div', {
                  role: 'option', class: ['ck-row', on && 'is-on'], 'data-issue': at, 'data-rule': issue.rule,
                  tabindex: on ? 0 : -1, 'aria-selected': on ? 'true' : 'false',
                  ...(on ? { 'aria-describedby': hintId } : {}),
                  onClick: () => { focus.value = at; go(i) },
                  onFocus: () => { focus.value = at },
                }, [
                  h('span', { class: ['ck-mark', error ? 'is-error' : 'is-warning'], title: error ? t.checkError : t.checkWarning, 'aria-hidden': 'true' }),
                  h('span', { class: 'ck-text' }, [
                    h('span', { class: 'vh' }, `${error ? t.checkError : t.checkWarning}: `),
                    h('span', { class: 'ck-msg' }, issue.message),
                    h('span', { class: 'ck-part' }, issue.part),
                  ]),
                ])
              }),
            ]))),
            current ? h('div', { class: 'ck-detail' }, [
              h('p', { id: hintId, class: 'ck-hint' }, current.hint),
              h('div', { class: 'ck-actions' }, [
                h('button', { type: 'button', class: 'btn btn-s btn-line', onClick: () => { go(active!) } }, t.checkGoTo),
                current.fixable && !editor.readOnly.value
                  ? h('button', { type: 'button', class: 'btn btn-s btn-add', 'data-pz-fix': '', onClick: () => { fix(active!) } }, editor.strings.checkRules[current.rule]?.fix ?? '')
                  : null,
              ]),
            ]) : null,
          ],
      ])
    }
  },
})
