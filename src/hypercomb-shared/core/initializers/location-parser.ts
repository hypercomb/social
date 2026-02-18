// hypercomb-shared/core/initializers/location-parser.ts

export type LocationParseResult = {
  // domain = host only (no protocol), ex: storagehypercomb.blob.core.windows.net
  domain: string

  // path = everything between host and signature (no leading/trailing slashes), ex: content
  path: string

  // signature = last segment (or segment after __install__), ex: 1321d4...
  signature: string

  // base url = protocol + host + path, ex: https://storagehypercomb.blob.core.windows.net/content
  baseUrl: string
}

export class LocationParser {

  public static parse = (input: string): LocationParseResult => {
    const raw = (input ?? '').trim()
    if (!raw) return { domain: '', path: '', signature: '', baseUrl: '' }

    const url = this.tryParseUrl(raw)
    if (!url) return { domain: '', path: '', signature: '', baseUrl: '' }

    const domain = (url.host ?? '').trim().toLowerCase()

    const segments = (url.pathname ?? '').split('/').filter(Boolean).map(s => (s ?? '').trim()).filter(Boolean)

    // supported:
    // - https://host/path/signature
    // - https://host/path/__install__/signature
    // - host/path/signature
    // - host/path/__install__/signature
    let signature = ''
    let pathSegments: string[] = []

    const installIndex = segments.lastIndexOf('__install__')
    if (installIndex >= 0) {
      signature = (segments[installIndex + 1] ?? '').trim()
      pathSegments = segments.slice(0, installIndex)
    } else {
      signature = (segments.length ? segments[segments.length - 1] : '').trim()
      pathSegments = segments.slice(0, Math.max(0, segments.length - 1))
    }

    const path = pathSegments.join('/').replace(/^\/+/, '').replace(/\/+$/, '')

    const serverRoot = `${url.protocol}//${url.host}`.replace(/\/+$/, '')
    const baseUrl = (path ? `${serverRoot}/${path}` : serverRoot).replace(/\/+$/, '')

    return { domain, path, signature, baseUrl }
  }

  private static tryParseUrl = (raw: string): URL | null => {
    try {
      // allow inputs without protocol
      if (/^\s*https?:\/\//i.test(raw)) return new URL(raw)
      if (/^\s*\/\//.test(raw)) return new URL(`https:${raw}`)
      return new URL(`https://${raw}`)
    } catch {
      return null
    }
  }
}

