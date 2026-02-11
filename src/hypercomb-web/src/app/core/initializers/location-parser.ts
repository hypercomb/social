// hypercomb-web/src/app/core/location-parser.ts

export type LocationParseResult = {
  domain: string
  path: string
  signature: string
}

export class LocationParser {

  public static parse = (input: string): LocationParseResult => {
    const raw = (input ?? '').trim()
    if (!raw) return { domain: '', path: '', signature: '' }

    // dev form: dev/<domain>/<signature> (slashes or backslashes)
    if (/^(\\|\/)?dev(\\|\/)/i.test(raw)) {
      const parts = raw.split(/[\\/]+/).filter(Boolean)
      const domain = (parts[1] ?? '').toLowerCase()
      const signature = parts[2] ?? ''
      const path = `/dev/${domain}/`
      return { domain, path, signature }
    }

    const url = this.tryParseUrl(raw)

    let domain = ''
    let path = ''

    if (url) {
      domain = (url.hostname ?? '').toLowerCase().replace(/:\d+$/, '')
      path = (url.pathname ?? '').trim()
    } else {
      const noProto = raw.replace(/^\s*https?:\/\//i, '').replace(/^\s*\/\//, '')
      const slash = noProto.indexOf('/')
      domain = (slash >= 0 ? noProto.slice(0, slash) : noProto).trim().toLowerCase()
      path = slash >= 0 ? noProto.slice(slash).trim() : ''
    }

    if (path === '/' || path === '') path = ''

    const segments = path.split('/').filter(Boolean)
    const signature = segments.length ? segments[segments.length - 1] : ''

    return { domain, path, signature }
  }

  private static tryParseUrl = (raw: string): URL | null => {
    try {
      if (/^\s*https?:\/\//i.test(raw)) return new URL(raw)
      if (/^\s*\/\//.test(raw)) return new URL(`https:${raw}`)
      return new URL(`https://${raw}`)
    } catch {
      return null
    }
  }
}
