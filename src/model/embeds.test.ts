import { describe, expect, it } from 'vitest'
import { type EmbedProvider, embedFor, isPlayerUrl, registerEmbedProvider } from './embeds'

describe('embed providers', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'],
    ['https://m.youtube.com/shorts/dQw4w9WgXcQ', 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'],
    ['https://vimeo.com/76979871', 'https://player.vimeo.com/video/76979871?dnt=1'],
    ['https://player.vimeo.com/video/76979871', 'https://player.vimeo.com/video/76979871?dnt=1'],
  ])('%s plays from %s', (page, player) => {
    expect(embedFor(page)?.player).toBe(player)
    expect(isPlayerUrl(player)).toBe(true)
  })

  it.each(['https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=short', 'javascript:alert(1)', 'https://vimeo.com/channels/x', 'not an address'])(
    '%s is no embed', (page) => { expect(embedFor(page)).toBeNull() })

  it('refuses provider patterns that do not hold their anchors', () => {
    const provider = (src: RegExp): EmbedProvider => ({ name: `p${src.source}`, src, player: () => null, page: (p) => p })
    expect(() => { registerEmbedProvider(provider(/^https:\/\/a\.example\/x|.*$/)) }).toThrow()
    expect(() => { registerEmbedProvider(provider(/^https:\/\/a\.example\/\d+$/g)) }).toThrow()
    expect(() => { registerEmbedProvider(provider(/^https:\/\/a\.example\/x\$/)) }).toThrow()
    expect(() => { registerEmbedProvider(provider(/^https:\/\/a\.example\/(?:x|y)[|]$/)) }).not.toThrow()
  })

  it('only exact player addresses may be framed', () => {
    expect(isPlayerUrl('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1')).toBe(false)
    expect(isPlayerUrl('https://www.youtube.com/embed/dQw4w9WgXcQ')).toBe(false)
  })
})
