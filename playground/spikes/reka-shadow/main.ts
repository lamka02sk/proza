/**
 * Probe: do Reka UI popover, menu and toolbar primitives work inside the
 * editor's shadow root? Target of tests/e2e/reka-shadow.spec.ts.
 */
import { createApp, defineComponent, h, ref } from 'vue'
import {
  DropdownMenuContent, DropdownMenuItem, DropdownMenuRoot, DropdownMenuTrigger,
  PopoverContent, PopoverRoot, PopoverTrigger, ToolbarButton, ToolbarRoot,
} from 'reka-ui'

const log: string[] = []
;(window as unknown as { __log: string[] }).__log = log

const App = defineComponent({
  setup() {
    const open = ref(false)
    return () => h('div', [
      h('button', { 'data-t': 'outside' }, 'Outside'),
      h(PopoverRoot, { open: open.value, 'onUpdate:open': (v: boolean) => { open.value = v; log.push(`popover ${v ? 'open' : 'closed'}`) } }, () => [
        h(PopoverTrigger, { 'data-t': 'pop-trigger' }, () => 'Options'),
        h(PopoverContent, { 'data-t': 'pop', side: 'bottom', align: 'start' }, () => [
          h('input', { 'data-t': 'pop-input', 'aria-label': 'Name' }),
          h('button', { 'data-t': 'pop-btn' }, 'Inside'),
        ]),
      ]),
      h(DropdownMenuRoot, { 'onUpdate:open': (v: boolean) => log.push(`menu ${v ? 'open' : 'closed'}`) }, () => [
        h(DropdownMenuTrigger, { 'data-t': 'menu-trigger' }, () => 'Menu'),
        h(DropdownMenuContent, { 'data-t': 'menu' }, () => ['One', 'Two', 'Three'].map((t) =>
          h(DropdownMenuItem, { onSelect: () => log.push(`select ${t}`) }, () => t))),
      ]),
      h(ToolbarRoot, { 'data-t': 'toolbar', 'aria-label': 'Format' }, () => ['Bold', 'Italic', 'Link'].map((t) =>
        h(ToolbarButton, { 'data-t': `tb-${t}` }, () => t))),
    ])
  },
})

const host = document.querySelector('#host')!
const shadow = host.attachShadow({ mode: 'open' })
const mount = document.createElement('div')
shadow.append(mount)
createApp(App).mount(mount)
