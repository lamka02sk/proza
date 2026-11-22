/**
 * `@lamka02sk/proza/locales/fr`: the French interface. Its own entry, so a host
 * pays only for the languages it imports: `createEditor({ locale: fr })`.
 */
import { fr as core } from '../editor/locale-fr'
import type { Locale } from '../index'
import { uiFr } from '../ui/locale-fr'

export const fr: Locale = { ...core, ui: uiFr }
