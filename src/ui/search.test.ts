import { describe, expect, it } from 'vitest'
import type { InserterItem } from '../editor/editing'
import { keyboardInset, search } from './search'

const item = (id: string, title: string, keywords: string[] = []): InserterItem => ({
  id, title: () => title, keywords, category: 'text', drawing: {}, create: () => [],
})
const items = [item('p', 'Text', ['paragraph']), item('h', 'Heading'), item('q', 'Citát', ['blockquote']), item('n', 'Numbered list', ['ol'])]
const run = (q: string): string[] => search(items, q, (i) => (i.keywords ?? []).join(' '), (i) => i.title({} as never)).map((i) => i.id)

describe('inserter search', () => {
  it('matches word starts in titles and keywords, folding case and diacritics', () => {
    expect(run('')).toEqual(['p', 'h', 'q', 'n'])
    expect(run('cit')).toEqual(['q'])
    expect(run('CITAT')).toEqual(['q'])
    expect(run('quote')).toEqual([])
    expect(run('blockq')).toEqual(['q'])
    expect(run('list')).toEqual(['n'])
    expect(run('num li')).toEqual(['n'])
    expect(run('ext')).toEqual([])
  })

  it('puts titles that start with the query first', () => {
    const list = [item('a', 'Paragraph text'), item('b', 'Text')]
    expect(search(list, 'text', () => '', (i) => i.title({} as never)).map((i) => i.id)).toEqual(['b', 'a'])
  })
})

describe('keyboard inset', () => {
  it('is the layout viewport below the visual viewport, never negative', () => {
    expect(keyboardInset(800, null)).toBe(0)
    expect(keyboardInset(800, { height: 800, offsetTop: 0 })).toBe(0)
    expect(keyboardInset(800, { height: 500, offsetTop: 0 })).toBe(300)
    expect(keyboardInset(800, { height: 500, offsetTop: 100 })).toBe(200)
    expect(keyboardInset(800, { height: 900, offsetTop: 0 })).toBe(0)
  })
})
