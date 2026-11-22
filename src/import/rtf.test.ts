import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { rtfPictures } from './rtf'

const PNG = '89504e470d0a1a0a'

describe('pictures from RTF', () => {
  it('takes Word pictures in order, once each, and keeps the place of formats a page cannot show', () => {
    const rtf = `{\\rtf1{\\*\\shppict{\\pict{\\*\\picprop{\\sp{\\sn a}{\\sv 1}}}\\picwgoal3600\\pichgoal2400\\pngblip\\bliptag1{\\*\\blipuid ab}${PNG}}}`
      + `{\\nonshppict{\\pict\\wmetafile8 0102}}{\\pict\\emfblip 0304}{\\pict\\jpegblip\\picscalex50\\picwgoal1500 ffd8}}`
    const pics = rtfPictures(rtf)
    expect(pics.map((p) => p.type)).toEqual(['image/png', null, 'image/jpeg'])
    expect([...pics[0]!.bytes.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47])
    expect(pics[0]).toMatchObject({ width: 240, height: 160 })
    expect(pics[2]).toMatchObject({ width: 50 })
    expect([...pics[2]!.bytes]).toEqual([0xff, 0xd8])
  })
  it('not RTF: nothing', () => { expect(rtfPictures('<p>x</p>')).toEqual([]) })
  it('never throws on damaged input', () => {
    fc.assert(fc.property(fc.string({ unit: fc.constantFrom('{', '}', '\\', 'pict', 'pngblip', 'bin5', '0', 'f', ' ', '*') }), (s) => {
      rtfPictures(`{\\rtf1${s}`)
      return true
    }))
  })
})

describe('rtf limits', () => {
  it('gives up on nesting no document has, quickly', () => {
    const start = performance.now()
    expect(rtfPictures(`{\\rtf1${'{'.repeat(1_000_000)}`)).toEqual([])
    expect(performance.now() - start).toBeLessThan(200)
  })
})
