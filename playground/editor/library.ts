/**
 * A stand-in for a host's attachment manager (`hooks.requestAttachment`, `?library`):
 * a dialog on the page with stored files. `?library=slow` answers a moment after the
 * choice, so a test can change the text in between.
 */
import type { Attachment, RequestAttachment } from '../../src/index'

const ASSETS: readonly (Attachment & { readonly label: string; readonly kinds: readonly string[] })[] = [
  { label: 'Logo (picture)', kinds: ['image', 'file'], url: '/png/proza-app-ikona-192.png', name: 'logo.png', mimeType: 'image/png', bytes: 9120, width: 192, height: 192 },
  { label: 'Price list (PDF)', kinds: ['file'], url: '/files/price-list.pdf', name: 'Price list.pdf', mimeType: 'application/pdf', bytes: 48213 },
  // Not a usable answer: the editor must refuse it.
  { label: 'Broken entry', kinds: ['image', 'file'], url: 'javascript:alert(1)', name: 'x.png', mimeType: 'image/png' },
]

export function library(slow: boolean): RequestAttachment {
  return ({ requestId, kind, signal, replyTarget }) => {
    const dialog = document.createElement('dialog')
    dialog.className = 'library'
    dialog.setAttribute('aria-label', 'Media library')
    const reply = (attachment: Attachment | null): void => {
      dialog.close()
      dialog.remove()
      const send = (): void => { replyTarget.dispatchEvent(new CustomEvent('proza:attachment-result', { detail: { requestId, attachment } })) }
      if (slow) setTimeout(send, 800)
      else send()
    }
    for (const { label, kinds, ...asset } of ASSETS) {
      if (!kinds.includes(kind)) continue
      const b = document.createElement('button')
      b.type = 'button'
      b.textContent = label
      b.addEventListener('click', () => { reply(asset) })
      dialog.append(b)
    }
    const cancel = document.createElement('button')
    cancel.type = 'button'
    cancel.textContent = 'Cancel'
    cancel.addEventListener('click', () => { reply(null) })
    dialog.append(cancel)
    dialog.addEventListener('cancel', (e) => { e.preventDefault(); reply(null) })
    signal.addEventListener('abort', () => { dialog.close(); dialog.remove() })
    document.body.append(dialog)
    dialog.showModal()
  }
}
