import { describe, expect, it } from 'vitest'
import { createValue } from '../model/richtext'
import { treeFromBlocks } from '../model/tree'
import { editingRegistry } from './editing'
import { countDocument, countText } from './stats'

describe('counts', () => {
  it('counts words and characters as a reader does', () => {
    expect(countText('Príliš žluťoučký kôň.', 'sk')).toEqual({ words: 3, characters: 21, charactersNoSpaces: 19 })
    // One emoji with a skin tone is one character; punctuation is not a word.
    expect(countText('Hi 👋🏽 — ok!')).toEqual({ words: 2, characters: 10, charactersNoSpaces: 7 })
    expect(countText('')).toEqual({ words: 0, characters: 0, charactersNoSpaces: 0 })
  })

  it('leaves out inline pictures and footnote references', () => {
    expect(countText('a￼b')).toEqual({ words: 1, characters: 2, charactersNoSpaces: 2 })
  })

  it('adds up every field, and counts the parts of the page', () => {
    const editing = editingRegistry([
      { name: 'core/paragraph', fields: [{ attr: 'content' }], title: () => 'Text' },
      { name: 'core/separator', fields: [], title: () => 'Separator' },
    ])
    const tree = treeFromBlocks([
      { id: 'a', type: 'core/paragraph', attrs: { content: createValue('One two') } },
      { id: 's', type: 'core/separator', attrs: {} },
      { id: 'b', type: 'core/paragraph', attrs: { content: createValue('three') } },
    ])
    expect(countDocument({ tree, editing, current: null })).toEqual({ words: 3, characters: 12, charactersNoSpaces: 11, parts: 3 })
  })
})
