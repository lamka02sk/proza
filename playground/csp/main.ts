/**
 * The editor on a page with a strict Content Security Policy (index.html).
 * No playground stylesheet: in development Vite would inject it as an inline
 * <style>, which the policy refuses; the editor's own styles are constructed.
 */
import { createEditor } from '../../src/index'

declare global {
  interface Window { __csp: string[]; __cspEditor?: ReturnType<typeof createEditor> }
}

window.__csp = []
document.addEventListener('securitypolicyviolation', (e) => { window.__csp.push(`${e.violatedDirective} ${e.blockedURI} ${e.sourceFile}:${e.lineNumber}`) })

const rich = (text: string) => ({ text, formats: [] })
window.__cspEditor = createEditor({
  target: '#editor',
  label: 'Content',
  content: {
    version: 1,
    blocks: [
      { id: 'h', type: 'core/heading', attrs: { level: 2, content: rich('Under a strict policy') } },
      { id: 'p', type: 'core/paragraph', attrs: { content: { text: 'Bold and coloured text.', formats: [{ type: 'bold', start: 0, end: 4 }, { type: 'color', start: 9, end: 17, attrs: { color: 'orange' } }] } } },
      { id: 'c', type: 'core/code', attrs: { language: 'js', content: rich('const a = 1') } },
      { id: 'i', type: 'core/image', attrs: { src: '/png/proza-app-ikona-192.png', alt: 'The Proza mark', naturalWidth: 192, naturalHeight: 192 } },
      { id: 't', type: 'core/table', attrs: {}, children: [{ id: 'r', type: 'core/table-row', attrs: {}, children: [{ id: 'd', type: 'core/table-cell', attrs: { header: true }, children: [{ id: 'dp', type: 'core/paragraph', attrs: { content: rich('Cell') } }] }] }] },
      { id: 'e', type: 'core/paragraph', attrs: { content: rich('') } },
    ],
  },
})
