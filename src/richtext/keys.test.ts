import { describe, expect, it } from 'vitest'
import { displayKeys, matchesKeys } from './keys'

const key = (k: string, code: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey', boolean>> = {}): KeyboardEvent =>
  ({ key: k, code, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods }) as KeyboardEvent

describe('matchesKeys', () => {
  it('Mod is Ctrl elsewhere and Cmd on a Mac; extra modifiers do not match', () => {
    expect(matchesKeys('Mod+B', key('b', 'KeyB', { ctrlKey: true }), false)).toBe(true)
    expect(matchesKeys('Mod+B', key('b', 'KeyB', { metaKey: true }), true)).toBe(true)
    expect(matchesKeys('Mod+B', key('b', 'KeyB', { ctrlKey: true }), true)).toBe(false)
    expect(matchesKeys('Mod+B', key('B', 'KeyB', { ctrlKey: true, shiftKey: true }), false)).toBe(false)
  })

  it('Ctrl names Ctrl literally, also on a Mac', () => {
    expect(matchesKeys('Ctrl+Shift+ArrowUp', key('ArrowUp', 'ArrowUp', { ctrlKey: true, shiftKey: true }), true)).toBe(true)
  })

  it('digits come from the key position: Shift+1 is "!" on a US layout, Option changes the character on a Mac', () => {
    expect(matchesKeys('Alt+Shift+2', key('@', 'Digit2', { altKey: true, shiftKey: true }), false)).toBe(true)
    expect(matchesKeys('Ctrl+Alt+2', key('™', 'Digit2', { ctrlKey: true, altKey: true }), true)).toBe(true)
  })

  it('letters on a Cyrillic layout and dead keys come from the key position', () => {
    expect(matchesKeys('Mod+B', key('и', 'KeyB', { ctrlKey: true }), false)).toBe(true)
    expect(matchesKeys('Ctrl+Alt+H', key('Dead', 'KeyH', { ctrlKey: true, altKey: true }), true)).toBe(true)
  })
})

describe('displayKeys', () => {
  it('spells shortcuts per platform', () => {
    expect(displayKeys('Mod+Shift+Z', false)).toBe('Ctrl+Shift+Z')
    expect(displayKeys('Mod+Shift+Z', true)).toBe('⌘⇧Z')
    expect(displayKeys('Alt+Shift+ArrowUp', false, { ArrowUp: '↑' })).toBe('Alt+Shift+↑')
  })
})
