/**
 * Interface icons: 18px inline stroke drawings on a
 * 24 grid, stroke 1.75, round caps and joins. Always decorative: the button
 * around an icon carries the name.
 */
import { type VNode, h } from 'vue'
import type { Drawing } from '../editor/editing'

const PATHS = {
  undo: ['M9 14 4 9l5-5', 'M4 9h10a6 6 0 0 1 0 12h-3'],
  redo: ['m15 14 5-5-5-5', 'M20 9H10a6 6 0 0 0 0 12h3'],
  plus: ['M12 5v14M5 12h14'],
  link: ['M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7', 'M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7'],
  alignStart: ['M4 6h16M4 12h10M4 18h13'],
  alignCenter: ['M4 6h16M7 12h10M5.5 18h13'],
  alignEnd: ['M4 6h16M10 12h10M7 18h13'],
  alignJustify: ['M4 6h16M4 12h16M4 18h16'],
  chevron: ['m6 9 6 6 6-6'],
  sliders: ['M4 7h9M17 7h3M4 17h3M11 17h9', 'M17 7a2 2 0 1 1-4 0 2 2 0 0 1 4 0', 'M11 17a2 2 0 1 1-4 0 2 2 0 0 1 4 0'],
  trash: ['M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3'],
  up: ['M12 19V5M6 11l6-6 6 6'],
  down: ['M12 5v14M6 13l6 6 6-6'],
  copy: ['M8 8h11v12H8z', 'M16 8V4H5v12h3'],
  tablet: ['M6 3h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2', 'M11 17.5h2'],
  left: ['M19 12H5M11 6l-6 6 6 6'],
  right: ['M5 12h14M13 6l6 6-6 6'],
  merge: ['M3 6h18v12H3z', 'M4 12h5M15 12h5', 'm7 9.5 2.5 2.5L7 14.5M17 9.5 14.5 12l2.5 2.5'],
  split: ['M3 6h18v12H3z', 'M12 6v12'],
  cols2: ['M4 5h7v14H4zM13 5h7v14h-7z'],
  cols3: ['M3 5h5v14H3zM9.5 5h5v14h-5zM16 5h5v14h-5z'],
  cols21: ['M3 5h11v14H3zM16 5h5v14h-5z'],
  cols12: ['M3 5h5v14H3zM10 5h11v14H10z'],
  cols4: ['M2.5 5h3.5v14H2.5zM7.5 5h3.5v14H7.5zM12.5 5h3.5v14h-3.5zM17.5 5h3.5v14h-3.5z'],
  phone: ['M9 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2', 'M11 17.5h2'],
  help: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0', 'M9.6 9.5a2.5 2.5 0 1 1 3.6 2.3c-.8.5-1.2 1-1.2 1.9M12 17v.01'],
  search: ['M17 11a6 6 0 1 1-12 0 6 6 0 0 1 12 0', 'm20 20-4.5-4.5'],
  outline: ['M4 6h4M4 12h4M4 18h4M11 6h9M14 12h6M14 18h6'],
  source: ['m8 7-5 5 5 5M16 7l5 5-5 5M13.5 5l-3 14'],
  expand: ['M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5'],
  collapse: ['M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5'],
  close: ['M6 6l12 12M18 6 6 18'],
  more: ['M5 12h.01M12 12h.01M19 12h.01'],
  check: ['m5 12.5 4.5 4.5L19 7'],
  /** The universal access figure in a circle: the accessibility check. */
  access: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0', 'M12 7.2v.01', 'M7.5 10.2 12 11l4.5-.8', 'M12 11v3l-2.4 3.8M12 14l2.4 3.8'],
  image: ['M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2', 'm3 16 5-5 4 4 3-3 6 6', 'M17 9.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0'],
  video: ['M4 6h11a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1', 'm16 10 5-3v10l-5-3'],
  audio: ['M9 18V6l11-2v12', 'M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0', 'M20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0'],
  file: ['M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z', 'M14 3v5h5'],
  external: ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'],
  swap: ['M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7'],
  play: ['M8 5v14l11-7z'],
  globe: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0', 'M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3'],
  lock: ['M6 11h12v9H6z', 'M8.5 11V8a3.5 3.5 0 0 1 7 0v3'],
  move: ['M12 3v18M3 12h18M12 3 9 6M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3'],
} as const

export type IconName = keyof typeof PATHS

export function icon(name: IconName): VNode {
  return h('svg', { class: 'ic', viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' }, PATHS[name].map((d) => h('path', { d })))
}

export function drawing(d: Drawing): VNode {
  return h('svg', { class: 'mini', viewBox: '0 0 96 48', 'aria-hidden': 'true', focusable: 'false' }, [
    ...(d.ink ?? []).map((p) => h('path', { d: p })),
    ...(d.accent ?? []).map((p) => h('path', { class: 'a', d: p })),
    ...(d.dots ?? []).map(([cx, cy, r]) => h('circle', { class: 'af', cx, cy, r })),
  ])
}
