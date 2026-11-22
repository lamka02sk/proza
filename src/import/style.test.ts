import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { colorDistance, fontElementSizePx, fontSizePx, isDefaultInk, isMonospace, nearestColor, parseColor, parseLength, parseStyle, sizePreset, widthPreset } from './style'
import { words } from './inline'

describe('parseStyle', () => {
  it('reads declarations as Word writes them, quotes and all', () => {
    const s = parseStyle(`font-family:"Calibri",sans-serif;mso-list:l0 level2 lfo1;COLOR: Red !important; background:url("a;b.png")`)
    expect(s.get('font-family')).toBe('"Calibri",sans-serif')
    expect(s.get('mso-list')).toBe('l0 level2 lfo1')
    expect(s.get('color')).toBe('Red')
    expect(s.get('background')).toBe('url("a;b.png")')
  })
  it('never throws, and every name it gives is a property name', () => {
    fc.assert(fc.property(fc.string(), (t) => [...parseStyle(t).keys()].every((k) => /^-?[a-z][a-z0-9-]*$/.test(k))))
  })
})

describe('colours', () => {
  it('parses the forms foreign HTML uses', () => {
    expect(parseColor('#f00')).toEqual([255, 0, 0])
    expect(parseColor('#4472C4')).toEqual([68, 114, 196])
    expect(parseColor('rgb(0, 128, 0)')).toEqual([0, 128, 0])
    expect(parseColor('rgb(0 128 0 / 50%)')).toEqual([0, 128, 0])
    expect(parseColor('hsl(0, 100%, 50%)')).toEqual([255, 0, 0])
    expect(parseColor('windowtext')).toBe('default')
    expect(parseColor('rgba(0,0,0,0)')).toBe('transparent')
    expect(parseColor('#00000000')).toBe('transparent')
    expect(parseColor('nonsense')).toBeNull()
  })
  it('black and near-black are the default ink', () => {
    expect(isDefaultInk([0, 0, 0])).toBe(true)
    expect(isDefaultInk([34, 34, 34])).toBe(true)
    expect(isDefaultInk([200, 0, 0])).toBe(false)
  })
  it('maps to the nearest palette colour only when it is close', () => {
    const palette = [{ name: 'orange', color: '#B93E0C' }, { name: 'blue', color: '#1D4ED8' }]
    expect(nearestColor([224, 62, 45], palette)).toBe('orange')
    expect(nearestColor([29, 78, 216], palette)).toBe('blue')
    expect(nearestColor([0, 160, 0], palette)).toBeNull()
  })
  it('distance is a metric on equal colours', () => {
    fc.assert(fc.property(fc.tuple(fc.nat(255), fc.nat(255), fc.nat(255)), (c) => colorDistance(c, c) === 0))
  })
})

describe('sizes', () => {
  it('reads lengths and font sizes', () => {
    expect(parseLength('12pt')).toEqual({ px: 16 })
    expect(parseLength('50%')).toEqual({ percent: 50 })
    expect(parseLength('auto')).toBeNull()
    expect(fontSizePx('2em', 10)).toBe(20)
    expect(fontSizePx('large', 16)).toBe(18)
    expect(fontElementSizePx('5')).toBe(24)
    expect(fontElementSizePx('+1')).toBe(18)
  })
  it('a preset only for a clear difference from the body', () => {
    expect(sizePreset(12, 16)).toBe('s')
    expect(sizePreset(18.67, 16)).toBe('l')
    expect(sizePreset(16, 16)).toBe('')
    expect(sizePreset(14.67, 14.67)).toBe('')
  })
  it('picture widths as a share of the column', () => {
    expect(widthPreset({ px: 240 })).toBe('s')
    expect(widthPreset({ px: 480 })).toBe('m')
    expect(widthPreset({ percent: 100 })).toBe('l')
  })
  it('knows monospace families', () => {
    expect(isMonospace('"Courier New", monospace')).toBe(true)
    expect(isMonospace('Calibri')).toBe(false)
  })
})

describe('foreign style text cannot stall the import', () => {
  it('reads long values in linear time', () => {
    const start = performance.now()
    parseLength(`${'1'.repeat(40_000)}x`)
    parseColor(`rgb(${' '.repeat(40_000)}x`)
    expect(parseStyle(`width: ${'1'.repeat(40_000)}x; color: red`).get('width')).toBeUndefined()
    expect(words(`${'a '.repeat(40_000)}red`)).toHaveLength(40_001)
    expect(performance.now() - start).toBeLessThan(300)
  })

  it('splits values at spaces outside parentheses', () => {
    expect(words('url(a b.png) rgb(1, 2, 3)  red')).toEqual(['url(a b.png)', 'rgb(1, 2, 3)', 'red'])
  })
})
