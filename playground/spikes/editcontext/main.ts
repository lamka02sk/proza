import '../../../src/richtext/richtext.css'
import { RichTextField } from '../../../src/richtext/field'
import { mountSpike } from '../../shared/spike-page'
import { EditContextField, editContextSupported } from './edit-context-field'

const supported = editContextSupported()
document.querySelector('#support')!.textContent = supported
  ? 'EditContext is supported here: fields below use it.'
  : 'EditContext is not supported in this browser. Falling back to the contenteditable field.'
mountSpike((el, opts) => (supported ? new EditContextField(el, opts) : new RichTextField(el, opts)), supported ? 'editcontext' : 'contenteditable-fallback')
