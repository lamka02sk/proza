import { describe, expect, it } from 'vitest'
import { sanitizeElement, sanitizerPolicy } from './sanitize'

describe('sanitizeElement', () => {
  it('keeps what the renderer writes and drops the rest', () => {
    expect(sanitizeElement('A', { HREF: '/about', target: '_blank', onclick: 'x()', style: 'color:red' })).toEqual({ href: '/about', target: '_blank', rel: 'noopener' })
    expect(sanitizeElement('a', { href: 'javascript:alert(1)', class: 'pz-x' })).toEqual({ class: 'pz-x' })
    expect(sanitizeElement('img', { src: 'data:image/png;base64,AA', srcset: 'a.jpg 480w, javascript:x 960w', alt: 'A' })).toEqual({ alt: 'A' })
    expect(sanitizeElement('p', { 'aria-label': 'x', 'data-pz-id': 'y', 'data-other': 'z' })).toEqual({ 'aria-label': 'x', 'data-pz-id': 'y' })
  })

  it('keeps only new-window targets and never rel="opener" (reverse tabnabbing)', () => {
    expect(sanitizeElement('a', { href: '/x', target: 'other' })).toEqual({ href: '/x' })
    expect(sanitizeElement('a', { href: '/x', target: '_BLANK', rel: 'opener nofollow' })).toEqual({ href: '/x', target: '_blank', rel: 'nofollow noopener' })
    expect(sanitizeElement('a', { href: '/x', rel: 'OPENER' })).toEqual({ href: '/x' })
    expect(sanitizerPolicy().linkTarget).toBe('_blank')
  })

  it('removes elements that may not appear at all', () => {
    expect(sanitizeElement('script', {})).toBeNull()
    expect(sanitizeElement('input', { type: 'text' })).toBeNull()
    expect(sanitizeElement('input', { type: 'checkbox', checked: '' })).toEqual({ type: 'checkbox', checked: '' })
    expect(sanitizeElement('iframe', { src: 'https://evil.example/' })).toBeNull()
  })

  it('gives an allowed frame the fixed sandbox, whatever it asked for', () => {
    const out = sanitizeElement('iframe', { src: 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', sandbox: 'allow-top-navigation', title: 'T' })
    expect(out?.sandbox).not.toContain('allow-top-navigation')
    expect(out?.title).toBe('T')
  })

  it('has a policy that survives JSON', () => {
    const p = JSON.parse(JSON.stringify(sanitizerPolicy())) as ReturnType<typeof sanitizerPolicy>
    expect(new RegExp(p.url.pattern, p.url.flags).test('javascript:x')).toBe(false)
    expect(p.elements.a).toContain('href')
    expect(p.iframe.src.some((s) => new RegExp(s).test('https://player.vimeo.com/video/1?dnt=1'))).toBe(true)
  })
})
