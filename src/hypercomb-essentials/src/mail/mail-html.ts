// mail/mail-html.ts
//
// HTML MAIL, MADE SAFE TO SHOW. A message's html is written by a stranger. It is
// parsed into an INERT document (DOMParser runs no script and loads no image),
// stripped of everything that can act, and rebuilt as a string for a sandboxed,
// script-less iframe with its own content-security-policy as the second wall.
//
// ── NOTHING REMOTE LOADS ────────────────────────────────────────────────────
//
// An <img src="https://tracker.example/…"> would make this browser contact a
// host we do not control the moment the message is opened — the one thing
// no-third-party-requests.md forbids. So an image survives only if its bytes are
// in the message (a data: URL, or a cid: that the message itself carries). Every
// other image, background and stylesheet reference is dropped and counted, so the
// window can say "N remote items were not loaded".

const DROPPED_TAGS = new Set([
  'script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'link', 'meta', 'base', 'form', 'input',
  'button', 'select', 'textarea', 'audio', 'video', 'source', 'track', 'canvas', 'svg', 'math', 'noscript',
  'template', 'portal', 'dialog',
])

const DATA_IMAGE = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/i
const SAFE_LINK = /^(https?:|mailto:)/i

export interface SafeHtml {
  /** Markup for the inside of a <body>, plus the message's own <style> blocks. */
  readonly html: string
  /** Remote images, backgrounds and stylesheet references that were refused. */
  readonly blocked: number
}

/** A style value or <style> block with every outside reference removed. Counts what it removed. */
function scrubCss(css: string, count: () => void): string {
  return css
    .replace(/@import[^;]*;?/gi, () => { count(); return '' })
    .replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (whole, _q: string, target: string) => {
      if (DATA_IMAGE.test(target.trim())) return whole
      count()
      return 'none'
    })
    .replace(/expression\s*\(|behavior\s*:|-moz-binding\s*:/gi, '')
}

export function makeMailHtmlSafe(source: string, inlineImages: Readonly<Record<string, string>> = {}): SafeHtml {
  let blocked = 0
  const count = (): void => { blocked++ }
  const doc = new DOMParser().parseFromString(source, 'text/html')

  const clean = (parent: Element): void => {
    for (const el of Array.from(parent.children)) {
      const tag = el.tagName.toLowerCase()
      if (DROPPED_TAGS.has(tag)) { el.remove(); continue }
      if (tag === 'style') el.textContent = scrubCss(el.textContent ?? '', count)

      for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase()
        const value = attr.value.trim()
        if (name.startsWith('on') || name === 'ping' || name === 'formaction' || name === 'poster' || name.includes(':')) { el.removeAttribute(attr.name); continue }
        if (name === 'srcset' || name === 'background' || name === 'data') { el.removeAttribute(attr.name); count(); continue }
        if (name === 'style') { el.setAttribute('style', scrubCss(value, count)); continue }
        if (name === 'src') {
          if (tag !== 'img') { el.removeAttribute(attr.name); continue }
          const cid = /^cid:(.+)$/i.exec(value)?.[1]
          if (DATA_IMAGE.test(value)) continue
          if (cid && inlineImages[cid]) { el.setAttribute('src', inlineImages[cid]); continue }
          el.removeAttribute('src')
          count()
          continue
        }
        if (name === 'href') {
          if (!SAFE_LINK.test(value)) el.removeAttribute('href')
          continue
        }
      }
      if (tag === 'a') { el.setAttribute('rel', 'noopener noreferrer'); el.setAttribute('target', '_blank') }
      clean(el)
    }
  }
  clean(doc.documentElement)

  const styles = Array.from(doc.head?.querySelectorAll('style') ?? []).map(s => s.outerHTML).join('')
  return { html: styles + (doc.body?.innerHTML ?? ''), blocked }
}

/** The whole document for the iframe's `srcdoc`: its own policy refuses any load but a data: image. */
export const mailFrameDocument = (safeHtml: string): string =>
  `<!doctype html><meta charset="utf-8">`
  + `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">`
  + `<base target="_blank"><style>html{color-scheme:light}body{margin:12px;font:14px/1.45 system-ui,sans-serif;color:#111;background:#fff;word-wrap:break-word}img{max-width:100%;height:auto}</style>`
  + safeHtml
