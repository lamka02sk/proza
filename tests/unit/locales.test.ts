import { describe, expect, it } from 'vitest'
import { locales } from '../../src/index'
import { cs } from '../../src/locales/cs'
import { de } from '../../src/locales/de'
import { es } from '../../src/locales/es'
import { fr } from '../../src/locales/fr'
import { hu } from '../../src/locales/hu'
import { sk } from '../../src/locales/sk'
import { RENDER_LABELS } from '../../src/render/render'

const en = locales.en!
const all = { sk, cs, de, es, fr, hu }

type Tree = Readonly<Record<string, unknown>>
const isTree = (v: unknown): v is Tree => typeof v === 'object' && v !== null

/** Every leaf of a locale with its path: strings, functions, arrays. */
function* leaves(t: unknown, path: string[] = []): Generator<[string[], unknown]> {
  if (isTree(t) && !Array.isArray(t)) for (const [k, v] of Object.entries(t)) yield* leaves(v, [...path, k])
  else yield [path, t]
}
const at = (t: unknown, path: readonly string[]): unknown => path.reduce<unknown>((v, k) => (isTree(v) ? v[k] : undefined), t)

describe('interface languages', () => {
  it('only English is built in', () => {
    expect(Object.keys(locales)).toEqual(['en'])
  })

  for (const [lang, locale] of Object.entries(all)) {
    it(`${lang}: names itself, has every string, and every message renders for any count`, () => {
      expect(locale.lang).toBe(lang)
      expect(RENDER_LABELS[lang]).toBeDefined()
      for (const [path, value] of leaves(en)) {
        const ours = at(locale, path)
        expect(typeof ours, path.join('.')).toBe(typeof value)
        if (typeof value !== 'function' || typeof ours !== 'function') continue
        // Counts are where translations break (plural forms); numbers stand in for every argument.
        for (const n of [0, 1, 2, 5, 22]) {
          const args = Array.from({ length: value.length }, () => n)
          let expected: unknown
          try { expected = (value as (...a: unknown[]) => unknown)(...args) } catch { continue }
          if (typeof expected !== 'string' || /undefined|NaN/.test(expected)) continue
          const out = (ours as (...a: unknown[]) => unknown)(...args)
          expect(typeof out, path.join('.')).toBe('string')
          expect(out, `${path.join('.')}(${String(n)})`).not.toMatch(/undefined|NaN|\[object/)
          if (expected !== '') expect(out, path.join('.')).not.toBe('')
        }
      }
    })
  }
})
