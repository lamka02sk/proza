import '../../../src/richtext/richtext.css'
import { RichTextField } from '../../../src/richtext/field'
import { mountSpike } from '../../shared/spike-page'

// ?allowed=bold,italic limits the formats (as a code block does with none); ?rules=off turns input rules off.
const params = new URLSearchParams(location.search)
const allowed = params.get('allowed')
const rules = params.get('rules') !== 'off'

mountSpike((el, opts) => new RichTextField(el, {
  ...opts,
  inputRules: rules,
  ...(allowed === null ? {} : { allowedFormats: allowed === '' ? [] : allowed.split(',') }),
}), 'contenteditable')
