/**
 * `<proza-editor>`: the editor as a form-associated
 * custom element. It submits, resets, restores and validates like a native
 * field in any framework, through ElementInternals.
 *
 * Attributes: `name`, `required`, `readonly`, `disabled`, `preset`, `locale`,
 * `label`, `color-scheme`, `toolbar`, `output`, `content-source`, `height`,
 * `draft` (a key, or empty to derive one from the page and the name).
 * Options that are not text (upload, links, patterns, blocks) come from
 * `defineEditorElement(options)`. Content: a child
 * `<script type="application/json">` with stored JSON, or a child `<template>`
 * with HTML. Events: `input` after each change, `change` when the focus
 * leaves after changes, `save` (cancelable; by default it submits the form).
 */
import type { ImportSource } from './import/report'
import { type CreateEditorOptions, type Output, type ProzaEditor, createEditor, formEntries, guardSubmit, readContent } from './index'

export type ElementOptions = Omit<CreateEditorOptions, 'target' | 'content'>

const OUTPUTS: readonly string[] = ['json', 'html', 'both']
const SOURCES: readonly ImportSource[] = ['proza', 'word-desktop', 'word-web', 'google-docs', 'libreoffice-writer', 'excel', 'google-sheets', 'libreoffice-calc', 'tinymce', 'docx', 'html', 'text']
const isSource = (s: string | undefined): s is ImportSource => SOURCES.includes(s as ImportSource)

/**
 * Register the element. Safe to call more than once: the first registration
 * wins, as `customElements` allows one class per name.
 */
export function defineEditorElement(defaults: ElementOptions = {}, tag = 'proza-editor'): CustomElementConstructor {
  const existing = customElements.get(tag)
  if (existing) return existing

  class ProzaElement extends HTMLElement {
    static formAssociated = true
    static observedAttributes = ['readonly', 'disabled', 'required']

    readonly #internals = this.attachInternals()
    #proza: ProzaEditor | null = null
    #initial: unknown = undefined
    /** A value set before the editor exists (frameworks set properties before inserting the element). */
    #pending: string | undefined
    /** The content when the element left the page, for when it comes back (a tab panel, KeepAlive). */
    #kept: unknown = undefined
    #disabled = false
    #dirty = false
    #timer: ReturnType<typeof setTimeout> | undefined
    #offs: (() => void)[] = []

    /** The editor, once connected. */
    get editor(): ProzaEditor | null { return this.#proza }
    get form(): HTMLFormElement | null { return this.#internals.form }
    get name(): string { return this.getAttribute('name') ?? '' }
    get type(): string { return this.localName }
    get validity(): ValidityState { return this.#internals.validity }
    get validationMessage(): string { return this.#internals.validationMessage }
    get willValidate(): boolean { return this.#internals.willValidate }
    checkValidity(): boolean { return this.#internals.checkValidity() }
    reportValidity(): boolean { return this.#internals.reportValidity() }

    /** The submitted value: HTML, or JSON with `output="json"`. Setting it replaces the content. */
    get value(): string { return this.#proza ? formEntries(this.#proza.editor, this.name, this.#output() === 'json' ? 'json' : 'html')[0]![1] : this.#pending ?? '' }
    set value(v: string) {
      if (!this.#proza) { this.#pending = v; return }
      this.#proza.editor.setContent(readContent(v) ?? { version: 1, blocks: [] })
      this.#sync()
    }

    connectedCallback(): void {
      if (this.#proza) return
      // The children are the default content, what a form reset goes back to.
      this.#initial ??= this.#readInitial()
      const content = this.#pending !== undefined ? readContent(this.#pending) ?? { version: 1, blocks: [] } : this.#kept ?? this.#initial
      this.#pending = undefined
      this.#kept = undefined
      const attr = (n: string): string | undefined => this.getAttribute(n) ?? undefined
      const scheme = attr('color-scheme'), toolbar = attr('toolbar'), source = attr('content-source'), preset = attr('preset')
      const label = attr('label') ?? [...this.#internals.labels].map((l) => l.textContent?.trim() ?? '').join(' ')
      const draft = this.hasAttribute('draft') ? (attr('draft') || `${location.pathname}#${this.name || this.id}`) : defaults.draft
      const height = attr('height')
      const options: CreateEditorOptions = {
        ...defaults,
        target: this,
        ...(content !== undefined ? { content } : {}),
        ...(label ? { label } : {}),
        ...(attr('locale') ? { locale: attr('locale')! } : {}),
        ...(scheme === 'light' || scheme === 'dark' || scheme === 'auto' ? { colorScheme: scheme } : {}),
        ...(toolbar === 'bubble' || toolbar === 'docked' ? { toolbar } : {}),
        ...(preset === 'basic' || preset === 'standard' || preset === 'full' ? { preset } : {}),
        ...(isSource(source) ? { contentSource: source } : {}),
        ...(height ? { height } : {}),
        ...(draft !== undefined ? { draft } : {}),
        ...(attr('a11y-on-save') === 'block' || attr('a11y-on-save') === 'warn' ? { a11y: { onSave: attr('a11y-on-save') as 'warn' | 'block' } } : {}),
        readOnly: this.#readOnly(),
      }
      const proza = createEditor(options)
      this.#proza = proza
      const { editor } = proza
      this.#offs = [
        editor.on('change', () => {
          this.#dirty = true
          this.#validate()
          // A keystroke must not render the whole document: the form value follows after a pause.
          clearTimeout(this.#timer)
          this.#timer = setTimeout(() => { this.#sync() }, 250)
          this.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
        }),
        editor.on('blur', () => {
          if (!this.#dirty) return
          this.#dirty = false
          this.dispatchEvent(new Event('change', { bubbles: true }))
        }),
        editor.on('save', () => {
          // Mod+S asked the checker already.
          checked = true
          if (this.dispatchEvent(new Event('save', { bubbles: true, cancelable: true }))) this.form?.requestSubmit()
          checked = false
        }),
      ]
      let checked = false
      const form = this.form
      this.#offs.push(guardSubmit(form, editor, () => checked))
      const onSubmit = (): void => { proza.draft?.saved() }
      // The value may still wait for its pause: the entries are put right as the form reads them.
      const onFormData = (e: FormDataEvent): void => {
        if (this.#timer === undefined || !this.name || this.matches(':disabled')) return
        this.#sync()
        for (const [k, v] of formEntries(editor, this.name, this.#output())) e.formData.set(k, v)
      }
      form?.addEventListener('submit', onSubmit)
      form?.addEventListener('formdata', onFormData)
      this.#offs.push(() => { form?.removeEventListener('submit', onSubmit); form?.removeEventListener('formdata', onFormData) })
      // The element takes no focus of its own: a click on its label goes to the text.
      // A label around the element also hears clicks made inside it, which already put the caret where they belong.
      const onLabel = (e: Event): void => {
        if (!e.composedPath().includes(this)) this.shadowRoot?.querySelector<HTMLElement>('[data-field][tabindex="0"], [data-block][tabindex="0"]')?.focus()
      }
      const labels = [...this.#internals.labels]
      for (const l of labels) l.addEventListener('click', onLabel)
      this.#offs.push(() => { for (const l of labels) l.removeEventListener('click', onLabel) })
      this.#sync()
    }

    disconnectedCallback(): void {
      // Moving the element in the page disconnects and connects it again: keep the editor (and its undo) then.
      queueMicrotask(() => {
        if (this.isConnected || !this.#proza) return
        this.#kept = this.#proza.editor.getJSON()
        for (const off of this.#offs) off()
        this.#offs = []
        this.#proza.destroy()
        this.#proza = null
      })
    }

    attributeChangedCallback(): void {
      this.#proza?.editor.setReadOnly(this.#readOnly())
      this.#sync()
    }

    formDisabledCallback(disabled: boolean): void {
      this.#disabled = disabled
      this.#proza?.editor.setReadOnly(this.#readOnly())
    }

    formResetCallback(): void {
      this.#proza?.editor.setContent(this.#initial ?? { version: 1, blocks: [] })
      this.#dirty = false
      this.#sync()
    }

    /** Back and forward cache, or the browser restoring a form: the state is the stored JSON. */
    formStateRestoreCallback(state: unknown): void {
      if (typeof state !== 'string' || !this.#proza) return
      const content = readContent(state)
      if (content !== undefined) this.#proza.editor.setContent(content)
      this.#sync()
    }

    #output(): Output {
      const o = this.getAttribute('output') ?? defaults.output ?? 'both'
      return OUTPUTS.includes(o) ? o as Output : 'both'
    }

    #readOnly(): boolean {
      return this.#disabled || this.hasAttribute('readonly') || this.hasAttribute('disabled') || defaults.readOnly === true
    }

    #readInitial(): unknown {
      const json = this.querySelector(':scope > script[type="application/json"]')
      if (json?.textContent) return readContent(json.textContent)
      const html = this.querySelector<HTMLTemplateElement>(':scope > template')
      return html ? readContent(html.innerHTML) : undefined
    }

    /** The form value and the state to restore. */
    #sync(): void {
      clearTimeout(this.#timer)
      this.#timer = undefined
      const proza = this.#proza
      if (!proza) return
      const { editor } = proza
      const data = new FormData()
      if (this.name) for (const [k, v] of formEntries(editor, this.name, this.#output())) data.append(k, v)
      this.#internals.setFormValue(data, JSON.stringify(editor.getJSON()))
      this.#validate()
    }

    /** Whether `required` is met; cheap, so it runs on every change and the check before submitting is never stale. */
    #validate(): void {
      const editor = this.#proza?.editor
      if (!editor) return
      const missing = this.hasAttribute('required') && editor.isEmpty()
      const anchor = this.shadowRoot?.querySelector<HTMLElement>('[data-field][tabindex="0"], [data-block][tabindex="0"]') ?? undefined
      if (missing) this.#internals.setValidity({ valueMissing: true }, editor.strings.required, anchor)
      else this.#internals.setValidity({})
    }
  }

  customElements.define(tag, ProzaElement)
  return ProzaElement
}
