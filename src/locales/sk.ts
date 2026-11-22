/**
 * `@lamka02sk/proza/locales/sk`: the Slovak interface. Its own entry, so a host
 * pays only for the languages it imports: `createEditor({ locale: sk })`.
 */
import { sk as core } from '../editor/locale-sk'
import type { Locale } from '../index'
import { uiSk } from '../ui/locale-sk'

export const sk: Locale = { ...core, ui: uiSk }
