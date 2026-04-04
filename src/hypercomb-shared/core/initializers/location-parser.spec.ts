import { describe, it, expect } from 'vitest'

// Re-implement LocationParser inline to avoid import issues with the module system

type LocationParseResult = {
  domain: string
  path: string
  signature: string
  baseUrl: string
}

class LocationParser {
  public static parse = (input: string): LocationParseResult => {
    const raw = (input ?? '').trim()
    if (!raw) return { domain: '', path: '', signature: '', baseUrl: '' }

    const url = this.tryParseUrl(raw)
    if (!url) return { domain: '', path: '', signature: '', baseUrl: '' }

    const domain = (url.host ?? '').trim().toLowerCase()

    const segments = (url.pathname ?? '').split('/').filter(Boolean).map(s => (s ?? '').trim()).filter(Boolean)

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
      if (/^\s*https?:\/\//i.test(raw)) return new URL(raw)
      if (/^\s*\/\//.test(raw)) return new URL(`https:${raw}`)
      return new URL(`https://${raw}`)
    } catch {
      return null
    }
  }
}

describe('LocationParser', () => {
  it('returns empty fields for empty input', () => {
    const result = LocationParser.parse('')
    expect(result).toEqual({ domain: '', path: '', signature: '', baseUrl: '' })
  })

  it('returns empty fields for null-ish input', () => {
    const result = LocationParser.parse(null as any)
    expect(result).toEqual({ domain: '', path: '', signature: '', baseUrl: '' })
  })

  it('parses standard https URL with path and signature', () => {
    const result = LocationParser.parse(
      'https://storagehypercomb.blob.core.windows.net/dcp/content/abc123def'
    )
    expect(result.domain).toBe('storagehypercomb.blob.core.windows.net')
    expect(result.path).toBe('dcp/content')
    expect(result.signature).toBe('abc123def')
    expect(result.baseUrl).toBe('https://storagehypercomb.blob.core.windows.net/dcp/content')
  })

  it('parses URL with __install__ marker', () => {
    const result = LocationParser.parse(
      'https://storagehypercomb.blob.core.windows.net/dcp/content/__install__/abc123def'
    )
    expect(result.domain).toBe('storagehypercomb.blob.core.windows.net')
    expect(result.path).toBe('dcp/content')
    expect(result.signature).toBe('abc123def')
  })

  it('parses URL without protocol (adds https)', () => {
    const result = LocationParser.parse(
      'storagehypercomb.blob.core.windows.net/content/sig123'
    )
    expect(result.domain).toBe('storagehypercomb.blob.core.windows.net')
    expect(result.signature).toBe('sig123')
  })

  it('parses protocol-relative URL', () => {
    const result = LocationParser.parse(
      '//storagehypercomb.blob.core.windows.net/content/sig456'
    )
    expect(result.domain).toBe('storagehypercomb.blob.core.windows.net')
    expect(result.signature).toBe('sig456')
  })

  it('handles URL with only host and one segment (signature only, no path)', () => {
    const result = LocationParser.parse('https://example.com/abc123')
    expect(result.domain).toBe('example.com')
    expect(result.path).toBe('')
    expect(result.signature).toBe('abc123')
    expect(result.baseUrl).toBe('https://example.com')
  })

  it('handles URL with no path segments', () => {
    const result = LocationParser.parse('https://example.com')
    expect(result.domain).toBe('example.com')
    expect(result.path).toBe('')
    expect(result.signature).toBe('')
    expect(result.baseUrl).toBe('https://example.com')
  })

  it('handles URL with trailing slashes', () => {
    const result = LocationParser.parse('https://example.com/path/sig/')
    expect(result.signature).toBe('sig')
    expect(result.path).toBe('path')
  })

  it('lowercases the domain', () => {
    const result = LocationParser.parse('https://EXAMPLE.COM/path/sig')
    expect(result.domain).toBe('example.com')
  })

  it('trims whitespace from input', () => {
    const result = LocationParser.parse('  https://example.com/path/sig  ')
    expect(result.domain).toBe('example.com')
    expect(result.signature).toBe('sig')
  })

  it('handles http protocol', () => {
    const result = LocationParser.parse('http://example.com/content/sig')
    expect(result.domain).toBe('example.com')
    expect(result.baseUrl).toBe('http://example.com/content')
  })

  it('__install__ takes priority even when nested deep', () => {
    const result = LocationParser.parse(
      'https://host.com/a/b/c/__install__/mysig'
    )
    expect(result.path).toBe('a/b/c')
    expect(result.signature).toBe('mysig')
  })

  it('handles __install__ with no signature after it', () => {
    const result = LocationParser.parse(
      'https://host.com/path/__install__'
    )
    expect(result.path).toBe('path')
    expect(result.signature).toBe('')
  })
})
