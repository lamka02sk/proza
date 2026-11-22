/**
 * The tools beside a part (settings button, stems,
 * plus) and moving a part by dragging its stems, with a drop line.
 * One set follows the part with the caret, one
 * the part under the pointer, so 2,000 parts do not carry 6,000 buttons.
 *
 * The stems are drawn here too, one pair beside the part with the caret or
 * along the selected parts, so no part paints outside its box (which would
 * stop the canvas skipping it off screen) and selecting 2,000 parts animates
 * one element, not 4,000. The handle is the target over them.
 */
import { type ComponentPublicInstance, type PropType, type VNode, computed, defineComponent, h, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { ToolbarButton, ToolbarRoot } from 'reka-ui'
import { moveBlocksTo } from '../editor/structure'
import { selectedBlocks } from '../editor/selection'
import { childrenOf, parentOf } from '../model/tree'
import { useUi } from './context'
import { icon } from './icons'

export interface Box { top: number; height: number; start: number; end: number; visible: boolean }

/** Where a part sits inside the work area, in logical terms (start is the reading start). */
export function measure(el: HTMLElement, work: HTMLElement): Box {
  const r = el.getBoundingClientRect(), w = work.getBoundingClientRect()
  const rtl = getComputedStyle(work).direction === 'rtl'
  return {
    top: r.top - w.top + work.scrollTop,
    height: r.height,
    start: rtl ? w.right - r.right : r.left - w.left,
    end: rtl ? w.right - r.left : r.right - w.left,
    visible: true,
  }
}

export const PartTools = defineComponent({
  name: 'ProzaPartTools',
  props: {
    id: { type: String, required: true },
    /** The set under the pointer: a pointer convenience, hidden from assistive technology and the Tab order. */
    hover: { type: Boolean, default: false },
  },
  setup(props) {
    const ui = useUi()
    const { editor, t } = ui
    const box = reactive<Box>({ top: 0, height: 0, start: 0, end: 0, visible: false })
    /** Where the stems run: the part, or the first to the last selected part. */
    const stems = reactive({ top: 0, height: 0 })
    const last = ref(false)
    let ro: ResizeObserver | null = null

    /** Selected top-level parts other than this one: the stems run along all of them. */
    const range = computed((): [string, string] | null => {
      if (props.hover) return null
      const s = editor.selectionRef.value
      if (s.kind !== 'blocks') return null
      const ids = selectedBlocks(editor.tree, s)
      const first = ids[0], end = ids.at(-1)
      return first !== undefined && end !== undefined && ids.length > 1 && parentOf(editor.tree, first) === null ? [first, end] : null
    })

    const update = (): void => {
      const el = editor.blockElement(props.id), work = ui.work.value
      if (!el || !work) { box.visible = false; return }
      Object.assign(box, measure(el, work))
      const r = range.value
      const a = r ? editor.blockElement(r[0]) : null, b = r ? editor.blockElement(r[1]) : null
      if (a && b) {
        const top = measure(a, work).top, end = measure(b, work)
        Object.assign(stems, { top, height: end.top + end.height - top })
      } else Object.assign(stems, { top: box.top, height: box.height })
      last.value = childrenOf(editor.tree, null).at(-1) === props.id
    }
    // Geometry comes from ResizeObserver, which reports after the frame's own layout: the tools never
    // force a layout while the editor handles a key. Its first report measures a new part.
    const observe = ([el, a, b]: (HTMLElement | null)[]): void => {
      ro?.disconnect()
      const work = ui.work.value
      if (!el || !work || typeof ResizeObserver !== 'function') { box.visible = false; return }
      ro = new ResizeObserver(update)
      for (const target of [el, a, b, work]) if (target) ro.observe(target)
    }
    watch(() => {
      const r = range.value
      return [editor.blockElement(props.id), r ? editor.blockElement(r[0]) : null, r ? editor.blockElement(r[1]) : null]
    }, observe, { immediate: true, flush: 'post' })
    // A part moved without changing any size (Move up): measure in the next frame.
    let frame = 0
    watch(editor.kidsRef(null), () => {
      if (frame) return
      frame = requestAnimationFrame(() => { frame = 0; update() })
    })
    onBeforeUnmount(() => { ro?.disconnect(); cancelAnimationFrame(frame) })

    // --- Dragging by the stems -------------------------------------------
    const dropAt = ref<number | null>(null)
    let dragged = false

    /** The gap nearest to y among the other top-level parts: the part to go before, or null for the end. */
    const gapAt = (y: number): { before: string | null; line: number } | null => {
      const work = ui.work.value
      if (!work) return null
      const ids = childrenOf(editor.tree, null).filter((id) => id !== props.id)
      const w = work.getBoundingClientRect()
      // Binary search: parts run top to bottom.
      let lo = 0, hi = ids.length
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        const r = editor.blockElement(ids[mid]!)?.getBoundingClientRect()
        if (r && r.top + r.height / 2 < y) lo = mid + 1
        else hi = mid
      }
      const before = ids[lo] ?? null
      const ref = before !== null ? editor.blockElement(before) : editor.blockElement(ids.at(-1) ?? '')
      if (!ref) return null
      const r = ref.getBoundingClientRect()
      return { before, line: (before !== null ? r.top - 4 : r.bottom + 2) - w.top + work.scrollTop }
    }

    const onPointerDown = (e: PointerEvent): void => {
      if (e.button !== 0) return
      const handle = e.currentTarget as HTMLElement
      const el = editor.blockElement(props.id)
      if (!el) return
      const y0 = e.clientY, x0 = e.clientX
      let on = false
      let target: { before: string | null; line: number } | null = null
      dragged = false
      handle.setPointerCapture(e.pointerId)
      const move = (ev: PointerEvent): void => {
        if (!on && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return
        if (!on) {
          on = true
          ui.dragging.value = props.id
          // Not a class: Vue owns the part's class and would drop it on its next patch.
          el.setAttribute('data-drag', '')
        }
        el.style.setProperty('translate', `0 ${String(ev.clientY - y0)}px`)
        target = gapAt(ev.clientY)
        dropAt.value = target?.line ?? null
      }
      const end = (ev: PointerEvent): void => {
        handle.removeEventListener('pointermove', move)
        handle.removeEventListener('pointerup', end)
        handle.removeEventListener('pointercancel', end)
        if (handle.hasPointerCapture(ev.pointerId)) handle.releasePointerCapture(ev.pointerId)
        if (!on) return
        dragged = true
        el.removeAttribute('data-drag')
        el.style.removeProperty('translate')
        ui.dragging.value = null
        dropAt.value = null
        if (target && ev.type === 'pointerup') {
          editor.apply(moveBlocksTo(editor.context(), [props.id], null, target.before, editor.selection))
        }
      }
      handle.addEventListener('pointermove', move)
      handle.addEventListener('pointerup', end)
      handle.addEventListener('pointercancel', end)
    }

    const toggleOptions = (): void => {
      // A drag ends in a click on the handle: that is not a request for the options.
      if (dragged) { dragged = false; return }
      ui.add.value = null
      ui.options.value = ui.options.value === props.id ? null : props.id
    }
    const toggleAdd = (): void => {
      ui.options.value = null
      const open = ui.add.value?.kind === 'part' && ui.add.value.id === props.id
      ui.add.value = open ? null : { kind: 'part', id: props.id }
    }
    const setSettingsButton = (instance: Element | ComponentPublicInstance | null): void => {
      const el: unknown = (instance as ComponentPublicInstance | null)?.$el
      ui.settingsButton.value = el instanceof HTMLElement ? el : null
    }

    return () => {
      if (!box.visible) return null
      const optionsOpen = ui.options.value === props.id
      const addOpen = ui.add.value?.kind === 'part' && ui.add.value.id === props.id
      const hidden = props.hover
      const btn = (attrs: Record<string, unknown>, content: VNode | null = null): VNode => (hidden
        ? h('button', { ...attrs, tabindex: -1 }, content ? [content] : [])
        : h(ToolbarButton, attrs, () => (content ? [content] : [])))
      const children = [
        btn({
          type: 'button', class: ['cfg', optionsOpen && 'is-on'], 'data-pz-cfg': props.id,
          ref: hidden ? undefined : setSettingsButton,
          'aria-label': t.partSettings, title: t.partSettingsTitle, 'aria-haspopup': 'dialog', 'aria-expanded': optionsOpen ? 'true' : 'false',
          onClick: toggleOptions,
        }, icon('sliders')),
        btn({
          type: 'button', class: 'legs', 'data-pz-legs': props.id,
          'aria-label': t.partHandle, title: t.partHandleTitle, 'aria-haspopup': 'dialog', 'aria-expanded': optionsOpen ? 'true' : 'false',
          onPointerdown: onPointerDown, onClick: toggleOptions,
        }),
        last.value ? null : btn({
          type: 'button', class: 'plus', 'data-pz-plus': props.id,
          'aria-label': t.addBelow, title: t.addBelowTitle, 'aria-haspopup': 'dialog', 'aria-expanded': addOpen ? 'true' : 'false',
          style: { insetBlockStart: `${String(box.height - 15)}px`, insetInlineStart: `${String(box.end - box.start + 32)}px` },
          onClick: toggleAdd,
        }),
      ]
      const style = { insetBlockStart: `${String(box.top)}px`, blockSize: `${String(box.height)}px`, insetInlineStart: `${String(box.start - 50)}px` }
      const tools = hidden
        ? h('div', { class: 'gut is-hover', style, 'aria-hidden': 'true' }, children)
        : h(ToolbarRoot, { class: 'gut', style, 'aria-label': t.partTools, dir: t.dir, loop: true }, () => children)
      const r = range.value
      return [
        // Keyed by what they mark, so they draw down again for a new part or selection.
        props.hover ? null : h('div', {
          key: r ? r.join() : props.id,
          class: 'stems', 'aria-hidden': 'true',
          style: { insetBlockStart: `${String(stems.top)}px`, blockSize: `${String(stems.height)}px`, insetInlineStart: `${String(box.start - 22)}px` },
        }, [h('span'), h('span')]),
        tools,
        dropAt.value !== null ? h('div', { class: 'dropline', 'aria-hidden': 'true', style: { insetBlockStart: `${String(dropAt.value)}px` } }) : null,
      ]
    }
  },
})

/** The Add button under the last part (design: "Appender"). */
export const Appender = defineComponent({
  name: 'ProzaAppender',
  props: { label: { type: String as PropType<string>, required: true } },
  setup(props) {
    const ui = useUi()
    return () => {
      const open = ui.add.value?.kind === 'end'
      return h('div', { class: 'appender' }, h('button', {
        type: 'button', class: ['btn', 'btn-end', open && 'is-on'], 'data-pz-appender': '',
        'aria-haspopup': 'dialog', 'aria-expanded': open ? 'true' : 'false',
        onClick: () => { ui.options.value = null; ui.add.value = open ? null : { kind: 'end' } },
      }, [h('span', { class: 'plus-chip', 'aria-hidden': 'true' }), props.label]))
    }
  },
})
