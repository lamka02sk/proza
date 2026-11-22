import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { cssRules, withoutComments } from './cleanup'

describe('stylesheet scanning', () => {
  it('finds the rules the old regex found', () => {
    const css = fc.string({ unit: fc.constantFrom('a', '.', 'x', ' ', '{', '}', '@', ':', ';', ','), maxLength: 60 })
    fc.assert(fc.property(css, (text) => {
      const want = [...text.matchAll(/([^{}@]+)\{([^{}]*)\}/g)].map((m) => [m[1]!, m[2]!])
      expect(cssRules(text)).toEqual(want)
    }), { numRuns: 2000 })
  })

  it('removes comments as the old regex did', () => {
    const css = fc.string({ unit: fc.constantFrom('a', '/', '*', ' '), maxLength: 40 })
    fc.assert(fc.property(css, (text) => {
      // The regex left an unclosed comment in; the scanner drops it, as a browser does.
      if (/\/\*(?![\s\S]*\*\/)/.test(text.replace(/\/\*[\s\S]*?\*\//g, ''))) return
      expect(withoutComments(text)).toBe(text.replace(/\/\*[\s\S]*?\*\//g, ''))
    }), { numRuns: 2000 })
  })

  it('stays fast on text a regex would backtrack over', () => {
    const start = performance.now()
    cssRules('a'.repeat(200_000))
    withoutComments('/*'.repeat(100_000))
    expect(performance.now() - start).toBeLessThan(200)
  })
})
