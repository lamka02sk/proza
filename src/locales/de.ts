/**
 * `@lamka02sk/proza/locales/de`: the German interface. Its own entry, so a host
 * pays only for the languages it imports: `createEditor({ locale: de })`.
 */
import { de as core } from '../editor/locale-de'
import type { Locale } from '../index'
import { uiDe } from '../ui/locale-de'

export const de: Locale = { ...core, ui: uiDe }
