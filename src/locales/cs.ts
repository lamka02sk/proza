/**
 * `@lamka02sk/proza/locales/cs`: the Czech interface. Its own entry, so a host
 * pays only for the languages it imports: `createEditor({ locale: cs })`.
 */
import { cs as core } from '../editor/locale-cs'
import type { Locale } from '../index'
import { uiCs } from '../ui/locale-cs'

export const cs: Locale = { ...core, ui: uiCs }
