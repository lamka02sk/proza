/**
 * Parse rules of the layout blocks:
 * Proza's own output exactly, and the same layouts from WordPress block markup.
 * Foreign `div`s and `section`s stay unwrapped: only markup that says it is a
 * layout becomes one.
 */
import type { ParseRule } from '../import/rules'
import { BUTTON, BUTTONS, COLUMN, COLUMNS, DETAILS, GROUP, RATIOS, SPACER, SPACES, ratioFor } from './layout'

const classValue = (el: Element, prefix: string, values: readonly string[]): string | undefined => {
  for (const c of el.classList) if (c.startsWith(prefix) && values.includes(c.slice(prefix.length))) return c.slice(prefix.length)
  return undefined
}

const COLUMN_SELECTOR = '.pz-column, .wp-block-column'

export const layoutParse: Readonly<Record<string, readonly ParseRule[]>> = {
  [COLUMNS]: [{ selector: '.pz-columns, .wp-block-columns', priority: 100, parse: (el, ctx) => {
    const cols = [...el.children].filter((c) => c.matches(COLUMN_SELECTOR))
    if (cols.length === 0) return null
    return { attrs: { ...ctx.supports(el), ratio: classValue(el, 'pz-layout-', RATIOS) ?? ratioFor(cols.length) }, children: cols }
  } }],
  [COLUMN]: [{ selector: COLUMN_SELECTOR, priority: 100, parse: (el) => ({ attrs: {}, children: el.childNodes }) }],
  [GROUP]: [{ selector: '.pz-group, .wp-block-group', priority: 100, parse: (el, ctx) => {
    const tag = el.localName === 'section' || el.localName === 'aside' ? el.localName : 'div'
    // A WordPress group wraps its content once more.
    const inner = el.querySelector(':scope > .wp-block-group__inner-container') ?? el
    return { attrs: { ...ctx.supports(el), tag, look: classValue(el, 'pz-look-', ['panel', 'line']) ?? (el.classList.contains('has-background') ? 'panel' : '') }, children: inner.childNodes }
  } }],
  [DETAILS]: [{ selector: 'details:not(.pz-transcript):not(.pz-embed-facade)', priority: 60, parse: (el, ctx) => {
    const summary = el.querySelector(':scope > summary')
    const body = el.querySelector(':scope > .pz-details-body')
    const children = body ? [...body.childNodes] : [...el.childNodes].filter((n) => n !== summary)
    return { attrs: { ...ctx.supports(el), summary: summary ? ctx.richText(summary.childNodes) : { text: '', formats: [] }, open: el.hasAttribute('open') }, children }
  } }],
  [BUTTONS]: [{ selector: '.pz-buttons, .wp-block-buttons', priority: 100, parse: (el, ctx) => ({ attrs: ctx.supports(el), children: [...el.children] }) }],
  [BUTTON]: [{
    selector: '.pz-buttons > a.pz-button, .wp-block-buttons > .wp-block-button',
    priority: 100,
    block: true,
    parse: (el, ctx) => {
      const a = el.localName === 'a' ? el : el.querySelector('a')
      if (!a) return null
      const outline = el.classList.contains('pz-button-line') || el.classList.contains('is-style-outline')
      return { attrs: { ...ctx.supports(a), text: ctx.richText(a.childNodes), href: ctx.url(a.getAttribute('href')), look: outline ? 'line' : 'fill', newWindow: a.getAttribute('target') === '_blank' } }
    },
  }],
  [SPACER]: [{ selector: '.pz-spacer, .wp-block-spacer', priority: 100, parse: (el) => ({ attrs: { height: classValue(el, 'pz-space-', SPACES) ?? 'm' } }) }],
}
