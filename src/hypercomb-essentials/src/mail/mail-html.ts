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
//
// ── WHAT WAS HELD BACK, BY KIND ─────────────────────────────────────────────
//
// `blocked` stays the one total. `blockedByKind` splits the same count so the
// window can say what the reader missed in their own terms: pictures (an <img>,
// a srcset, a background= attribute), styling (anything refused inside a <style>
// block or a style attribute: @import and url()), and anything else (an object's
// data=). The three always add up to `blocked`.

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
  /** The same refusals, split by what they were; images + styles + other === blocked. */
  readonly blockedByKind: BlockedByKind
}

export interface BlockedByKind {
  readonly images: number
  readonly styles: number
  readonly other: number
}

type BlockedKind = keyof BlockedByKind

// ── STYLE TEXT ──────────────────────────────────────────────────────────────
//
// Three rules keep a stranger's CSS from reaching out or breaking out:
//  - CSS escapes are read first (`u\72l(` IS `url(`, `@\69mport` IS `@import`),
//    so a name cannot hide behind one;
//  - every function that can fetch (url, image-set, image, src) is cut out to
//    its closing parenthesis unless it is a data: image, and every cut leaves
//    spaces, so two pieces can never join into a new name;
//  - every `<` left in the text is written as the CSS escape `\3c `, so nothing
//    a scrub removes can leave `</style>` behind for the frame's parser to end
//    the style on and read what follows as markup.

const FETCHING = /(url|image-set|image|src)\(/gi
const REPLACEMENT = String.fromCodePoint(0xfffd)

/** CSS escapes read as the characters they stand for. */
const unescapeCss = (css: string): string =>
  css.replace(/\\(?:([0-9a-fA-F]{1,6})(?:\r\n|[ \t\r\n\f])?|(\r\n|[\r\n\f])|([\s\S]))/g, (_whole, hex: string | undefined, _break: string | undefined, ch: string | undefined) => {
    if (hex) {
      const code = Number(`0x${hex}`)
      return code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff) ? REPLACEMENT : String.fromCodePoint(code)
    }
    return ch ?? ''
  })

/** Just past the `)` that closes a call whose arguments start at `from` (quotes respected), or the end. */
function callEnd(css: string, from: number): number {
  let depth = 1
  let quote = ''
  for (let i = from; i < css.length; i++) {
    const ch = css[i]
    if (quote) { if (ch === quote) quote = ''; continue }
    if (ch === '"' || ch === "'") quote = ch
    else if (ch === '(') depth++
    else if (ch === ')' && --depth === 0) return i + 1
  }
  return css.length
}

/** A style value or <style> block with every outside reference removed. Counts what it removed. */
function scrubCss(css: string, count: () => void): string {
  const plain = unescapeCss(css)
    .replace(/@import[^;]*;?/gi, () => { count(); return ' ' })
    .replace(/expression\s*\(|behavior\s*:|-moz-binding\s*:/gi, ' ')
  let out = ''
  let last = 0
  FETCHING.lastIndex = 0
  for (let m = FETCHING.exec(plain); m; m = FETCHING.exec(plain)) {
    const open = m.index + m[0].length
    const end = callEnd(plain, open)
    const target = plain.slice(open, plain[end - 1] === ')' ? end - 1 : end).trim().replace(/^(['"])([\s\S]*)\1$/, '$2').trim()
    out += plain.slice(last, m.index)
    if (m[1]!.toLowerCase() === 'url' && DATA_IMAGE.test(target)) out += plain.slice(m.index, end)
    else { count(); out += ' none ' }
    last = end
    FETCHING.lastIndex = end
  }
  return (out + plain.slice(last)).replace(/</g, '\\3c ')
}

export function makeMailHtmlSafe(source: string, inlineImages: Readonly<Record<string, string>> = {}): SafeHtml {
  const byKind: Record<BlockedKind, number> = { images: 0, styles: 0, other: 0 }
  const count = (kind: BlockedKind): void => { byKind[kind]++ }
  const countStyle = (): void => count('styles')
  const doc = new DOMParser().parseFromString(source, 'text/html')

  const clean = (parent: Element): void => {
    for (const el of Array.from(parent.children)) {
      const tag = el.tagName.toLowerCase()
      if (DROPPED_TAGS.has(tag)) { el.remove(); continue }
      if (tag === 'style') el.textContent = scrubCss(el.textContent ?? '', countStyle)

      for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase()
        const value = attr.value.trim()
        if (name.startsWith('on') || name === 'ping' || name === 'formaction' || name === 'poster' || name.includes(':')) { el.removeAttribute(attr.name); continue }
        if (name === 'srcset' || name === 'background' || name === 'data') { el.removeAttribute(attr.name); count(name === 'data' ? 'other' : 'images'); continue }
        if (name === 'style') { el.setAttribute('style', scrubCss(value, countStyle)); continue }
        if (name === 'src') {
          if (tag !== 'img') { el.removeAttribute(attr.name); continue }
          const cid = /^cid:(.+)$/i.exec(value)?.[1]
          if (DATA_IMAGE.test(value)) continue
          // Own keys only: `cid:constructor` must not find Object's constructor.
          const inline = cid && Object.hasOwn(inlineImages, cid) ? inlineImages[cid] : undefined
          if (inline && DATA_IMAGE.test(inline)) { el.setAttribute('src', inline); continue }
          el.removeAttribute('src')
          count('images')
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
  return {
    html: styles + (doc.body?.innerHTML ?? ''),
    blocked: byKind.images + byKind.styles + byKind.other,
    blockedByKind: { ...byKind },
  }
}

/**
 * The whole document for the iframe's `srcdoc`: its own policy refuses any load
 * but a data: image. base-uri and form-action do not fall back to default-src,
 * so they are named: no <base href> and no form can point anywhere.
 */
export const mailFrameDocument = (safeHtml: string): string =>
  `<!doctype html><meta charset="utf-8">`
  + `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">`
  + `<base target="_blank"><style>html{color-scheme:light}body{margin:12px;font:14px/1.45 system-ui,sans-serif;color:#111;background:#fff;word-wrap:break-word}img{max-width:100%;height:auto}</style>`
  + safeHtml
