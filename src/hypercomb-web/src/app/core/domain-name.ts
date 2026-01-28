// src/app/core/domain-name.ts

export type DomainParseResult = {
  folder: string
  path: string // everything from the first / onward (for search or future routing)
}

export class DomainName {

  // -------------------------------------------------
  // parsing
  // -------------------------------------------------

  public static parse = (input: string): DomainParseResult => {
    const raw = (input ?? '').trim()

    // empty
    if (!raw) return { folder: '', path: '' }

    // try url parsing first (supports https://, http://, //, and bare hosts with /path)
    const url = this.tryParseUrl(raw)

    if (url) {
      // folder is only the host (subdomain.domain.tld). no protocol, no slashes, no port
      const folder = (url.hostname ?? '').toLowerCase().trim()

      // path preserves everything from the first / onward (no query/hash)
      const path = (url.pathname ?? '').trim()

      return {
        folder: folder.replace(/:\d+$/, ''), // safety: hostname never includes port, but keep this defensive
        path: path === '/' ? '' : path
      }
    }

    // fallback: strip protocol-ish prefix, then cut at first slash
    // example: "https://a.b.com/x" -> "a.b.com"
    // example: "a.b.com/x" -> "a.b.com"
    const noProto = raw.replace(/^\s*https?:\/\//i, '').replace(/^\s*\/\//, '')
    const slash = noProto.indexOf('/')

    const host = (slash >= 0 ? noProto.slice(0, slash) : noProto).trim().toLowerCase()
    const path = (slash >= 0 ? noProto.slice(slash) : '').trim()

    return { folder: host, path }
  }

  private static tryParseUrl = (raw: string): URL | null => {
    try {
      // already a full url
      if (/^\s*https?:\/\//i.test(raw)) return new URL(raw)

      // scheme-relative url
      if (/^\s*\/\//.test(raw)) return new URL(`https:${raw}`)

      // bare host or host/path
      // note: this makes "example.com/foo" parseable without storing the protocol
      return new URL(`https://${raw.replace(/^\s+|\s+$/g, '')}`)
    } catch {
      return null
    }
  }
}
