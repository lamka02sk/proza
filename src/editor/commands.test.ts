import { describe, expect, it } from 'vitest'
import { CORE_COMMANDS, Keymap, commandRegistry, keyboardHelp } from './commands'
import { en } from './locale-en'
import { sk } from './locale-sk'

const press = (k: string, code: string, mods: Partial<Record<'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey', boolean>> = {}): KeyboardEvent =>
  ({ key: k, code, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods }) as KeyboardEvent

describe('keymap', () => {
  const commands = commandRegistry(CORE_COMMANDS)

  it('finds a command by its keys, only in the mode it works in', () => {
    const map = new Keymap(commands, {}, false)
    expect(map.match(press('Escape', 'Escape'), 'text')?.name).toBe('selectBlock')
    expect(map.match(press('Escape', 'Escape'), 'blocks')).toBeNull()
    expect(map.match(press('Delete', 'Delete'), 'blocks')?.name).toBe('remove')
    expect(map.match(press('Delete', 'Delete'), 'text')).toBeNull()
  })

  it('takes platform bindings: Alt+Shift+Up elsewhere, Ctrl+Shift+Up on a Mac', () => {
    expect(new Keymap(commands, {}, false).match(press('ArrowUp', 'ArrowUp', { altKey: true, shiftKey: true }), 'text')?.name).toBe('moveUp')
    expect(new Keymap(commands, {}, true).match(press('ArrowUp', 'ArrowUp', { ctrlKey: true, shiftKey: true }), 'text')?.name).toBe('moveUp')
    expect(new Keymap(commands, {}, true).match(press('ArrowUp', 'ArrowUp', { altKey: true, shiftKey: true }), 'text')).toBeNull()
  })

  it('a host remaps a command or switches its keys off (WCAG 2.1.4)', () => {
    const map = new Keymap(commands, { duplicate: [{ keys: 'Mod+J' }], moveUp: null }, false)
    expect(map.match(press('j', 'KeyJ', { ctrlKey: true }), 'text')?.name).toBe('duplicate')
    expect(map.match(press('D', 'KeyD', { ctrlKey: true, shiftKey: true }), 'text')).toBeNull()
    expect(map.match(press('ArrowUp', 'ArrowUp', { altKey: true, shiftKey: true }), 'text')).toBeNull()
    expect(map.keysFor('moveUp')).toEqual([])
  })

  it('a command registered twice is an error', () => {
    expect(() => commandRegistry([...CORE_COMMANDS, CORE_COMMANDS[0]!])).toThrow(/twice/)
  })
})

describe('keyboard help', () => {
  it('is generated from the commands and field shortcuts, in the interface language', () => {
    const commands = commandRegistry(CORE_COMMANDS)
    const help = keyboardHelp(new Keymap(commands, {}, false), commands, en)
    const all = help.flatMap((g) => g.entries.map((e) => `${e.keys} = ${e.text}`))
    expect(all).toContain('Ctrl+B = Bold')
    expect(all).toContain('Alt+Shift+↑ = Move the part up')
    expect(all).toContain('Alt+0 = Keyboard help')
    // Undo and redo appear once.
    expect(all.filter((e) => e.endsWith('= Undo'))).toHaveLength(1)
    const skHelp = keyboardHelp(new Keymap(commands, {}, false), commands, sk)
    expect(skHelp.map((g) => g.title)).toEqual(['Text', 'Časti', 'Editor'])
    expect(skHelp.flatMap((g) => g.entries.map((e) => e.text))).toContain('Tučné')
  })

  it('every core command has a title in both locales', () => {
    for (const c of CORE_COMMANDS) {
      expect(en.commands[c.name], c.name).toBeTruthy()
      expect(sk.commands[c.name], c.name).toBeTruthy()
    }
    expect(Object.keys(sk.commands).sort()).toEqual(Object.keys(en.commands).sort())
    expect(Object.keys(sk.blockNames).sort()).toEqual(Object.keys(en.blockNames).sort())
  })
})

describe('Slovak plurals', () => {
  it('1, 2 to 4, 5 and more', () => {
    expect(sk.removed(1)).toBe('Časť odstránená')
    expect(sk.removed(3)).toBe('3 časti odstránené')
    expect(sk.removed(5)).toBe('5 častí odstránených')
    expect(sk.blocksSelected(2)).toBe('2 časti vybrané')
  })
})
