/**
 * Motion that answers what the writer just did.
 * Web Animations only: no classes for Vue to drop on its next
 * patch, no inline style attribute under a strict CSP. Reduced motion turns
 * every one of these off.
 */

const EASE = 'cubic-bezier(.16, 1, .3, 1)'

export function reducedMotion(): boolean {
  return typeof matchMedia !== 'function' || matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** A new part opens the space it needs, then its content settles like ink. */
export function animateNew(el: HTMLElement | null): void {
  if (!el || reducedMotion() || typeof el.animate !== 'function') return
  const h = el.getBoundingClientRect().height
  el.animate([{ blockSize: '0px', overflow: 'clip' }, { blockSize: `${h}px`, overflow: 'clip' }], { duration: 500, easing: EASE })
  el.animate([{ opacity: 0, filter: 'blur(8px)' }, { opacity: 1, filter: 'blur(0)', offset: 0.55 }, { opacity: 1, filter: 'none' }], { duration: 700, easing: 'ease-out' })
}

/**
 * Moved parts glide to their new place (FLIP). `measure` before the change,
 * then `play` after the DOM has it. Only parts near the viewport are measured:
 * the rest would animate where nobody sees it.
 */
export function measureParts(canvas: HTMLElement | null): Map<string, number> {
  const out = new Map<string, number>()
  if (!canvas || reducedMotion()) return out
  const view = canvas.ownerDocument.defaultView
  const hView = view?.innerHeight ?? 0
  for (const el of canvas.querySelectorAll<HTMLElement>(':scope > [data-block]')) {
    const r = el.getBoundingClientRect()
    if (r.bottom < -hView || r.top > 2 * hView) continue
    out.set(el.dataset.block!, r.top)
  }
  return out
}

export function playParts(canvas: HTMLElement | null, before: Map<string, number>): void {
  if (!canvas || before.size === 0) return
  for (const el of canvas.querySelectorAll<HTMLElement>(':scope > [data-block]')) {
    const was = before.get(el.dataset.block!)
    if (was === undefined) continue
    const dy = was - el.getBoundingClientRect().top
    if (Math.abs(dy) < 1) continue
    // While a part glides it stays above the parts it passes.
    el.animate([{ transform: `translateY(${dy}px)`, zIndex: 7, position: 'relative' }, { transform: 'none', zIndex: 7, position: 'relative' }], { duration: 420, easing: EASE })
  }
}
