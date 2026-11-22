/**
 * Keyboard shortcut matching, shared by the field and the editor keymap
 * (WCAG 2.1.4).
 *
 * A shortcut is written `Mod+Shift+X`. `Mod` is Ctrl, or Cmd on Apple
 * platforms. `Ctrl`, `Meta`, `Alt` and `Shift` name a key literally, so an
 * Apple-only binding can use Ctrl.
 */

export const isMac = (): boolean => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

/**
 * The key a shortcut names. Letters come from `code` on non-Latin layouts (so
 * Mod+B works with Cyrillic) and when Option changed the character on a Mac.
 * Digits always come from `code`: on Slovak and French layouts the digit row
 * needs Shift, and Shift+1 is `!` on a US layout.
 */
export function shortcutKey(e: KeyboardEvent): string {
  if (/^Digit\d$/.test(e.code)) return e.code.slice(5)
  if (e.code === 'Space' || e.key === ' ') return 'Space'
  if (/^[a-z]$/i.test(e.key)) return e.key.toUpperCase()
  if (/^Key[A-Z]$/.test(e.code) && e.key.length === 1 && !/[\x20-\x7e]/.test(e.key)) return e.code.slice(3)
  if (/^Key[A-Z]$/.test(e.code) && e.key === 'Dead') return e.code.slice(3)
  return e.key
}

/** True when `keys` (for example `Mod+Shift+ArrowUp`) is what `e` pressed. */
export function matchesKeys(keys: string, e: KeyboardEvent, mac: boolean): boolean {
  const parts = keys.split('+')
  // `Mod++` would be Mod and the plus key.
  const key = keys.endsWith('++') ? '+' : parts.pop()!
  if (keys.endsWith('++')) parts.splice(-1)
  const want = new Set(parts)
  const ctrl = want.has('Ctrl') || (want.has('Mod') && !mac)
  const meta = want.has('Meta') || (want.has('Mod') && mac)
  if (e.ctrlKey !== ctrl || e.metaKey !== meta || e.shiftKey !== want.has('Shift') || e.altKey !== want.has('Alt')) return false
  return shortcutKey(e).toUpperCase() === key.toUpperCase()
}

/** Shortcut text for people: `Ctrl+Shift+Z`, or `⌘⇧Z` on a Mac. */
export function displayKeys(keys: string, mac: boolean, names: Readonly<Record<string, string>> = {}): string {
  const parts = keys.endsWith('++') ? [...keys.slice(0, -2).split('+'), '+'] : keys.split('+')
  const symbol = (p: string): string => {
    if (mac) {
      const m: Record<string, string> = { Mod: '⌘', Meta: '⌘', Ctrl: '⌃', Alt: '⌥', Shift: '⇧' }
      if (m[p]) return m[p]
    } else if (p === 'Mod') return names.Ctrl ?? 'Ctrl'
    return names[p] ?? p
  }
  const out = parts.map(symbol)
  return mac ? out.join('') : out.join('+')
}
