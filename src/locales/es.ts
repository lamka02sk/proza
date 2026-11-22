/**
 * `@lamka02sk/proza/locales/es`: the Spanish interface. Its own entry, so a host
 * pays only for the languages it imports: `createEditor({ locale: es })`.
 */
import { es as core } from '../editor/locale-es'
import type { Locale } from '../index'
import { uiEs } from '../ui/locale-es'

export const es: Locale = { ...core, ui: uiEs }
