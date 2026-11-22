/**
 * `@lamka02sk/proza/locales/hu`: the Hungarian interface. Its own entry, so a host
 * pays only for the languages it imports: `createEditor({ locale: hu })`.
 */
import { hu as core } from '../editor/locale-hu'
import type { Locale } from '../index'
import { uiHu } from '../ui/locale-hu'

export const hu: Locale = { ...core, ui: uiHu }
