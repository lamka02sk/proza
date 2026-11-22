/**
 * Embed providers: no arbitrary iframes. A page
 * address from an allowed provider maps to its player address; everything
 * else stays a link. Pure, so the renderer and a server sanitiser share it.
 */
import { MAX_URL } from './url'

/** The parts of an http(s) address a provider reads. The model has no DOM, so no `URL`. */
export interface Address {
  readonly hostname: string
  readonly pathname: string
  param(name: string): string | null
}

export function parseAddress(address: string): Address | null {
  if (address.length > MAX_URL * 2) return null
  // The path starts at its slash, so host and path never compete for the same characters (no backtracking).
  const m = /^https?:\/\/([^/?#\s@]+)(\/[^?#\s]*)?(\?[^#\s]*)?(?:#\S*)?$/i.exec(address.trim())
  if (!m) return null
  const query = m[3] ?? ''
  return {
    hostname: m[1]!.toLowerCase().replace(/:\d+$/, ''),
    pathname: m[2] || '/',
    param: (name) => {
      for (const pair of query.slice(1).split('&')) {
        const [k, v = ''] = pair.split('=')
        if (k === name) return v
      }
      return null
    },
  }
}

export interface EmbedProvider {
  /** Shown to authors ("YouTube"). Not translated: it is a name. */
  readonly name: string
  /** The player address for a page address of this provider, or null. */
  player(url: Address): string | null
  /** Whether an iframe address is one this provider's `player` makes. */
  readonly src: RegExp
  /** The page address for one of this provider's player addresses: what an author would paste. */
  page(player: string): string
}

const YOUTUBE_ID = /^[\w-]{11}$/

/** The providers Proza ships with. */
export const EMBED_PROVIDERS: readonly EmbedProvider[] = [
  {
    name: 'YouTube',
    player(url) {
      const host = url.hostname.replace(/^(?:www\.|m\.)/, '')
      let id: string | null = null
      if (host === 'youtu.be') id = url.pathname.slice(1)
      else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
        id = url.pathname === '/watch' ? url.param('v') : /^\/(?:embed|shorts|live)\/([^/]+)/.exec(url.pathname)?.[1] ?? null
      }
      // The privacy-enhanced domain sets no cookies until the visitor plays the video.
      return id !== null && YOUTUBE_ID.test(id) ? `https://www.youtube-nocookie.com/embed/${id}` : null
    },
    src: /^https:\/\/www\.youtube-nocookie\.com\/embed\/[\w-]{11}$/,
    page: (player) => `https://www.youtube.com/watch?v=${player.slice(player.lastIndexOf('/') + 1)}`,
  },
  {
    name: 'Vimeo',
    player(url) {
      const host = url.hostname.replace(/^www\./, '')
      const id = host === 'vimeo.com' ? /^\/(\d{1,12})(?:\/|$)/.exec(url.pathname)?.[1] : host === 'player.vimeo.com' ? /^\/video\/(\d{1,12})$/.exec(url.pathname)?.[1] : undefined
      // dnt: Vimeo does not track the session.
      return id ? `https://player.vimeo.com/video/${id}?dnt=1` : null
    },
    src: /^https:\/\/player\.vimeo\.com\/video\/\d{1,12}\?dnt=1$/,
    page: (player) => `https://vimeo.com/${/\/video\/(\d+)/.exec(player)?.[1] ?? ''}`,
  },
]

let registered: readonly EmbedProvider[] = EMBED_PROVIDERS

/**
 * Allow another provider (the plugin API). Configuration, not content: the host
 * calls it once at start-up, in the browser and on the server that sanitises, so both allow the same
 * frames. A player address must be `https:` and its pattern anchored at both ends.
 */
export function registerEmbedProvider(provider: EmbedProvider): void {
  const src = provider.src.source
  // A `|` outside groups leaves the anchors to one alternative; `g` and `y` make test() depend on the previous call.
  if (!src.startsWith('^https:\\/\\/') || !anchoredAtEnd(src) || hasTopLevelAlternation(src) || /[mgy]/.test(provider.src.flags)) {
    throw new Error(`Embed provider ${provider.name}: its src pattern must match whole https: addresses (^https:\\/\\/…$, no top-level |, no m, g or y flag)`)
  }
  if (registered.some((p) => p.name === provider.name)) return
  registered = [...registered, provider]
}

function anchoredAtEnd(source: string): boolean {
  let slashes = 0
  for (let i = source.length - 2; i >= 0 && source[i] === '\\'; i--) slashes++
  return source.endsWith('$') && slashes % 2 === 0
}

function hasTopLevelAlternation(source: string): boolean {
  let depth = 0
  let inClass = false
  for (let i = 0; i < source.length; i++) {
    const c = source[i]
    if (c === '\\') i++
    else if (inClass) inClass = c !== ']'
    else if (c === '[') inClass = true
    else if (c === '(') depth++
    else if (c === ')') depth--
    else if (c === '|' && depth === 0) return true
  }
  return false
}

/** The providers allowed now: the shipped ones and those the host registered. */
export function embedProviders(): readonly EmbedProvider[] {
  return registered
}

/** The provider and player address for a page address, or null when no provider takes it. */
export function embedFor(address: string, providers: readonly EmbedProvider[] = registered): { provider: EmbedProvider; player: string } | null {
  const url = parseAddress(address)
  if (!url) return null
  for (const provider of providers) {
    const player = provider.player(url)
    if (player !== null) return { provider, player }
  }
  return null
}

/** Whether an iframe may load this address: it is a player address of an allowed provider. */
export function isPlayerUrl(src: string, providers: readonly EmbedProvider[] = registered): boolean {
  return providers.some((p) => p.src.test(src))
}

/**
 * The page address for any address a provider takes (its page, short link or
 * player), so a frame found in imported HTML stores what an author would have
 * pasted. Null when no provider takes it.
 */
export function pageFor(address: string, providers: readonly EmbedProvider[] = registered): string | null {
  const found = embedFor(address, providers)
  return found ? found.provider.page(found.player) : null
}
