/**
 * What an upload's result becomes on each media block:
 * the address, the pixel size (no layout shift), the smaller copies for `srcset`.
 */
import type { ToPatch } from '../editor/upload'
import { safeUrl } from '../model/url'
import { measureImage } from '../ui/upload'


/** A picture: its address, its pixel size (measured when the host does not say), its smaller copies. */
export const imagePatch: ToPatch = async (r) => {
  const size = r.width && r.height ? { width: r.width, height: r.height } : await measureImage(r.url)
  const variants = (r.variants ?? []).filter((v) => safeUrl(v.url) !== null && Number.isInteger(v.width) && v.width > 0)
  const srcset = variants.length > 0 ? [...variants, ...(size ? [{ url: r.url, width: size.width }] : [])].map((v) => `${v.url} ${v.width}w`).join(', ') : ''
  return { src: r.url, naturalWidth: size?.width ?? 0, naturalHeight: size?.height ?? 0, srcset }
}
export const videoPatch: ToPatch = (r) => ({ src: r.url, naturalWidth: r.width ?? 0, naturalHeight: r.height ?? 0 })
export const audioPatch: ToPatch = (r) => ({ src: r.url })
export const filePatch: ToPatch = (r, f) => ({ href: r.url, name: f.name, bytes: f.size })
export const captionsPatch: ToPatch = (r) => ({ captions: r.url })

