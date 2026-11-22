/**
 * Command registry and keymap. Every action is a
 * named command; shortcuts, menus and toolbars only call commands. Shortcuts
 * are remappable and can be switched off (WCAG 2.1.4).
 */
import { FIELD_SHORTCUTS, type FieldShortcut } from '../richtext/field'
import { displayKeys, isMac, matchesKeys } from '../richtext/keys'
import type { Change, StructureContext } from './editing'
import type { EditorSelection } from './selection'
import { duplicateBlocks, moveBlocks, removeBlocks } from './structure'
import type { Strings } from './strings'

/** What a command can reach. The editor implements it. */
export interface CommandHost {
  readonly strings: Strings
  readonly selection: EditorSelection
  /** The structure context for the current document and selection. */
  context(): StructureContext
  /** The blocks block commands act on: the selected blocks, or the block with the caret. */
  targets(): string[]
  /** Apply a change as one undo step. False when there is none. `keepFocus`: leave the DOM focus where it is. */
  apply(change: Change | null, options?: { readonly keepFocus?: boolean }): boolean
  undo(): boolean
  redo(): boolean
  /** Select the block with the caret (select mode). */
  selectBlock(): boolean
  /** First all text of the field, then all blocks. */
  selectAll(): boolean
  /** Ask the interface to show something: keyboard help, the toolbar, the outline (`EditorEvents.ui`). */
  requestUi(name: UiRequest): void
  /** Tell the host the author wants to save (Mod+S, TinyMCE's `save`). */
  save(): boolean
  /** Type `text` at the caret, or over the selected text (special characters, a date). */
  insertText(text: string): boolean
}

/** What a command can ask the interface for. */
export type UiRequest = 'help' | 'toolbar' | 'outline' | 'find' | 'check'

export interface KeyBinding {
  readonly keys: string
  /** Only on Apple platforms (true) or only elsewhere (false). */
  readonly mac?: boolean
}

export interface Command {
  readonly name: string
  /** Default shortcuts. */
  readonly keys?: readonly KeyBinding[]
  /** Where the shortcut applies: in text (caret in a field), on selected blocks, or both. Default both. */
  readonly when?: 'text' | 'blocks' | 'any'
  /** Run it. True when it acted, so the key is taken. */
  run(host: CommandHost): boolean
  isEnabled?(host: CommandHost): boolean
  isActive?(host: CommandHost): boolean
  /** Help group: text, blocks (default) or editor. */
  readonly group?: 'text' | 'blocks' | 'editor'
}

export type CommandRegistry = ReadonlyMap<string, Command>

export function commandRegistry(commands: readonly Command[]): CommandRegistry {
  const map = new Map<string, Command>()
  for (const c of commands) {
    if (map.has(c.name)) throw new Error(`Command ${c.name} is registered twice`)
    map.set(c.name, c)
  }
  return map
}

/** The editor's own commands. Block libraries add theirs (`src/blocks/`). */
export const CORE_COMMANDS: readonly Command[] = [
  { name: 'undo', group: 'editor', when: 'blocks', keys: [{ keys: 'Mod+Z' }], run: (h) => h.undo() },
  { name: 'redo', group: 'editor', when: 'blocks', keys: [{ keys: 'Mod+Shift+Z' }, { keys: 'Mod+Y', mac: false }], run: (h) => h.redo() },
  { name: 'selectBlock', when: 'text', keys: [{ keys: 'Escape' }], run: (h) => h.selectBlock() },
  { name: 'selectAll', keys: [{ keys: 'Mod+A' }], run: (h) => h.selectAll() },
  {
    name: 'moveUp',
    keys: [{ keys: 'Alt+Shift+ArrowUp', mac: false }, { keys: 'Ctrl+Shift+ArrowUp', mac: true }],
    run: (h) => h.apply(moveBlocks(h.context(), h.targets(), -1, h.selection)),
  },
  {
    name: 'moveDown',
    keys: [{ keys: 'Alt+Shift+ArrowDown', mac: false }, { keys: 'Ctrl+Shift+ArrowDown', mac: true }],
    run: (h) => h.apply(moveBlocks(h.context(), h.targets(), 1, h.selection)),
  },
  { name: 'duplicate', keys: [{ keys: 'Mod+Shift+D' }], run: (h) => h.apply(duplicateBlocks(h.context(), h.targets(), h.selection)) },
  {
    name: 'remove',
    when: 'blocks',
    keys: [{ keys: 'Delete' }, { keys: 'Backspace' }],
    run: (h) => h.apply(removeBlocks(h.context(), h.targets())),
  },
  { name: 'help', group: 'editor', keys: [{ keys: 'Alt+0', mac: false }, { keys: 'Ctrl+Alt+H', mac: true }], run: (h) => { h.requestUi('help'); return true } },
  // Alt+F10 as in TinyMCE: the bubble over selected words, otherwise the tools of the part.
  { name: 'toolbar', group: 'editor', keys: [{ keys: 'Alt+F10' }], run: (h) => { h.requestUi('toolbar'); return true } },
  { name: 'save', group: 'editor', keys: [{ keys: 'Mod+S' }], run: (h) => h.save() },
  { name: 'find', group: 'editor', keys: [{ keys: 'Mod+F' }], run: (h) => { h.requestUi('find'); return true } },
  // Word's shortcut (TinyMCE `nonbreaking`): keeps two words on one line.
  { name: 'nonBreakingSpace', group: 'text', when: 'text', keys: [{ keys: 'Mod+Shift+Space' }], run: (h) => h.insertText('\u00A0') },
  { name: 'outline', group: 'editor', keys: [{ keys: 'Alt+Shift+O', mac: false }, { keys: 'Ctrl+Alt+O', mac: true }], run: (h) => { h.requestUi('outline'); return true } },
  { name: 'check', group: 'editor', keys: [{ keys: 'Alt+Shift+A', mac: false }, { keys: 'Ctrl+Alt+A', mac: true }], run: (h) => { h.requestUi('check'); return true } },
]

/** Shortcut overrides from the host: a list replaces a command's keys, null switches them off. */
export type KeyOverrides = Readonly<Record<string, readonly KeyBinding[] | null>>

/** Where a key was pressed: in text, on selected blocks, or on text across parts (only `any` commands apply there). */
export type KeyMode = 'text' | 'blocks' | 'range'

export class Keymap {
  readonly #commands: CommandRegistry
  readonly #keys = new Map<string, readonly KeyBinding[]>()
  readonly #mac: boolean

  constructor(commands: CommandRegistry, overrides: KeyOverrides = {}, mac = isMac()) {
    this.#commands = commands
    this.#mac = mac
    for (const c of commands.values()) {
      const keys = c.name in overrides ? overrides[c.name] : c.keys
      if (keys) this.#keys.set(c.name, keys)
    }
  }

  /** The bindings that apply on this platform. */
  keysFor(name: string): string[] {
    return (this.#keys.get(name) ?? []).filter((k) => k.mac === undefined || k.mac === this.#mac).map((k) => k.keys)
  }

  /** The command `e` asks for in this mode, if any. */
  match(e: KeyboardEvent, mode: KeyMode): Command | null {
    return this.matchAll(e, mode)[0] ?? null
  }

  /**
   * Every command `e` asks for in this mode, in registration order. Several may
   * share a key and decline where they do not apply (Tab indents a list item,
   * or moves to the next table cell): the first that acts takes the key.
   */
  matchAll(e: KeyboardEvent, mode: KeyMode): Command[] {
    const out: Command[] = []
    for (const [name, keys] of this.#keys) {
      const c = this.#commands.get(name)!
      const when = c.when ?? 'any'
      if (when !== 'any' && when !== mode) continue
      if (keys.some((k) => (k.mac === undefined || k.mac === this.#mac) && matchesKeys(k.keys, e, this.#mac))) out.push(c)
    }
    return out
  }

  /** Run the first command for `e` that acts. True when one did. */
  run(e: KeyboardEvent, mode: KeyMode, host: CommandHost, skip: (c: Command) => boolean = () => false): boolean {
    return this.matchAll(e, mode).some((c) => !skip(c) && (c.isEnabled?.(host) ?? true) && c.run(host))
  }

  get mac(): boolean { return this.#mac }
}

export interface HelpEntry { readonly keys: string; readonly text: string }
export interface HelpGroup { readonly title: string; readonly entries: readonly HelpEntry[] }

/**
 * Keyboard help, generated from the commands and the field shortcuts so it is
 * never out of date. The interface shows it.
 */
export function keyboardHelp(keymap: Keymap, commands: CommandRegistry, strings: Strings, fieldShortcuts: readonly FieldShortcut[] = FIELD_SHORTCUTS): HelpGroup[] {
  const show = (keys: string): string => displayKeys(keys, keymap.mac, strings.keyNames)
  const text: HelpEntry[] = []
  for (const s of fieldShortcuts) {
    if (s.mac !== undefined && s.mac !== keymap.mac) continue
    const name = typeof s.command === 'string' ? s.command : s.command.format
    // Undo and redo are listed once, with the editor.
    if (name === 'undo' || name === 'redo') continue
    text.push({ keys: show(s.keys), text: strings.commands[`field:${name}`] ?? name })
  }
  const byGroup = { text, blocks: [] as HelpEntry[], editor: [] as HelpEntry[] }
  for (const c of commands.values()) {
    const keys = keymap.keysFor(c.name)
    if (keys.length === 0) continue
    byGroup[c.group ?? 'blocks'].push({ keys: keys.map(show).join(', '), text: strings.commands[c.name] ?? c.name })
  }
  const undoKeys = fieldShortcuts.filter((s) => (s.command === 'undo' || s.command === 'redo') && (s.mac === undefined || s.mac === keymap.mac))
  for (const s of undoKeys) {
    const name = s.command as string
    if (!byGroup.editor.some((e) => e.text === strings.commands[name])) byGroup.editor.push({ keys: show(s.keys), text: strings.commands[name] ?? name })
  }
  return [
    { title: strings.help.text, entries: [...strings.help.navigation.map((n) => ({ keys: show(n.keys), text: n.text })), ...byGroup.text] },
    { title: strings.help.blocks, entries: byGroup.blocks },
    { title: strings.help.editor, entries: byGroup.editor },
  ]
}
