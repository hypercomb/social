// @vitest-environment jsdom
//
// The phone gateway is an inline classic script. These tests run the functions
// in that script: the host check, the pin parse, and the verify-then-boot path.
// A phone at hypercomb.io stays there and runs hypercomb.com's current pin.

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { fileURLToPath } from 'node:url'

const at = (p: string): string => fileURLToPath(new URL(p, import.meta.url))
const shell = readFileSync(at('../index.html'), 'utf8')
const main = readFileSync(at('../main.ts'), 'utf8')

const gatewayScript = (): string => {
  const atMarker = shell.indexOf('<!-- hc-phone-gateway')
  expect(atMarker, 'phone gateway marker missing').toBeGreaterThan(-1)
  const open = shell.indexOf('<script>', atMarker)
  const close = shell.indexOf('</script>', open)
  expect(open).toBeGreaterThan(atMarker)
  expect(close).toBeGreaterThan(open)
  return shell.slice(open + '<script>'.length, close)
}

/** Lift `function <name>(…) { … }` out of a script. Bodies under test keep
 *  braces for real blocks only — a `{64}` inside a regex would end the lift early. */
const lift = (source: string, name: string): string => {
  const asyncAt = source.indexOf(`async function ${name}(`)
  const start = asyncAt >= 0 ? asyncAt : source.indexOf(`function ${name}(`)
  expect(start, `${name} not found`).toBeGreaterThan(-1)
  let depth = 0
  let opened = false
  for (let i = start; i < source.length; i++) {
    if (source[i] === '{') { depth++; opened = true }
    else if (source[i] === '}') {
      depth--
      if (opened && depth === 0) return source.slice(start, i + 1)
    }
  }
  throw new Error(`could not find the end of ${name}`)
}

const load = <T>(name: string, deps: readonly string[] = []): T =>
  new Function(`${[...deps, name].map(fn => lift(gatewayScript(), fn)).join('\n')}; return ${name};`)() as T

type BootModule = { boot?: (context: { reason?: string }) => { prompt?: () => void } | null }

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex')

const exactBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

describe('phone gateway script', () => {
  const source = gatewayScript()

  it('sits after the viewport and the import map, and does not redirect', () => {
    const viewAt = shell.indexOf('name="viewport"')
    const mapAt = shell.indexOf("s.type = 'importmap'")
    const gateAt = shell.indexOf('<!-- hc-phone-gateway')
    expect(viewAt).toBeGreaterThan(-1)
    expect(mapAt).toBeGreaterThan(viewAt)
    expect(gateAt).toBeGreaterThan(mapAt)
    expect(shell).not.toContain("location.replace('https://hypercomb.com/")
    expect(source).toContain("matchMedia('(pointer: coarse)')")
    expect(source).toContain("matchMedia('(max-width: 599px), (max-height: 449px)')")
    expect(source.indexOf('phoneGatewayHost(location.hostname)')).toBeLessThan(source.indexOf('window.__hcPhoneGateway'))
  })

  it('is what main awaits before the hive can touch storage', () => {
    const gate = main.indexOf('phoneGateway.then')
    const store = main.indexOf('await packedStoreBlocksBoot')
    expect(gate).toBeGreaterThan(-1)
    expect(store).toBeGreaterThan(gate)
    expect(main.indexOf('if (served) return')).toBeLessThan(store)
  })

  it('names only hypercomb.io', () => {
    const phoneGatewayHost = load<(host: string) => boolean>('phoneGatewayHost')
    expect(phoneGatewayHost('hypercomb.io')).toBe(true)
    expect(phoneGatewayHost('www.hypercomb.io')).toBe(true)
    expect(phoneGatewayHost('hypercomb.com')).toBe(false)
    expect(phoneGatewayHost('localhost')).toBe(false)
    expect(phoneGatewayHost('development.hypercomb.io')).toBe(false)
    expect(phoneGatewayHost('nothypercomb.io')).toBe(false)
  })

  it('reads a pin as 64 hex characters and nothing else', () => {
    const parsePin = load<(text: string) => string>('parsePin')
    const pin = 'a'.repeat(64)
    expect(parsePin(`${pin}\n`)).toBe(pin)
    expect(parsePin(`  ${pin.toUpperCase()}  `)).toBe(pin)
    expect(parsePin('<!doctype html>')).toBe('')
    expect(parsePin(`${pin}ff`)).toBe('')
    expect(parsePin(pin.slice(0, 63))).toBe('')
    expect(parsePin('')).toBe('')
  })

  it('boots a pin whose bytes hash to the name, and refuses one that does not', async () => {
    const servePinnedInitial = load<(importer?: (url: string) => Promise<BootModule>) => Promise<boolean>>('servePinnedInitial', ['parsePin', 'sha256Hex', 'whenBody'])
    const sourceBytes = new TextEncoder().encode('export const boot = () => ({ prompt() {} })')
    const pin = sha256(sourceBytes)
    const calls: { url: string; init: RequestInit | undefined }[] = []
    let prompted = false
    let splashDismissed = false
    const splash = document.createElement('div')
    splash.id = 'hc-splash'
    document.body.append(splash)
    ;(window as unknown as { __hcDismissSplash?: () => void }).__hcDismissSplash = () => {
      splashDismissed = true
      splash.remove()
    }

    const fetchMock = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input)
      calls.push({ url, init })
      if (url === 'https://hypercomb.com/pin') return Promise.resolve(new Response(`${pin}\n`, { status: 200 }))
      if (url === `https://hypercomb.com/${pin}`) return Promise.resolve(new Response(exactBuffer(sourceBytes), { status: 200 }))
      return Promise.resolve(new Response('no', { status: 404 }))
    }
    const previous = globalThis.fetch
    globalThis.fetch = fetchMock as typeof fetch
    try {
      const ok = await servePinnedInitial(async () => ({
        boot: () => ({ prompt: () => { prompted = true } }),
      }))
      expect(ok).toBe(true)
      expect(prompted).toBe(true)
      expect(splashDismissed).toBe(true)
      expect(document.getElementById('hc-splash')).toBeNull()
      expect(calls.map(call => call.url)).toEqual([
        'https://hypercomb.com/pin',
        `https://hypercomb.com/${pin}`,
      ])
      for (const call of calls) {
        expect(call.init?.cache).toBe('no-store')
        expect(call.init?.credentials).toBe('omit')
      }

      calls.length = 0
      let imported = false
      globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const url = String(input)
        calls.push({ url, init })
        if (url === 'https://hypercomb.com/pin') return Promise.resolve(new Response(`${pin}\n`, { status: 200 }))
        if (url === `https://hypercomb.com/${pin}`) {
          return Promise.resolve(new Response(exactBuffer(new TextEncoder().encode('not the pin')), { status: 200 }))
        }
        return Promise.resolve(new Response('', { status: 404 }))
      }) as typeof fetch
      expect(await servePinnedInitial(async () => { imported = true; return {} })).toBe(false)
      expect(imported).toBe(false)
      expect(calls.map(call => call.url)).toEqual([
        'https://hypercomb.com/pin',
        `https://hypercomb.com/${pin}`,
      ])
    } finally {
      globalThis.fetch = previous
      splash.remove()
      delete (window as unknown as { __hcDismissSplash?: unknown }).__hcDismissSplash
    }
  })

  it('drops a panel that failed to boot and leaves the splash for the hive', async () => {
    const servePinnedInitial = load<(importer?: (url: string) => Promise<BootModule>) => Promise<boolean>>('servePinnedInitial', ['parsePin', 'sha256Hex', 'whenBody'])
    const sourceBytes = new TextEncoder().encode('export const boot = () => ({ prompt() {} })')
    const pin = sha256(sourceBytes)
    const splash = document.createElement('div')
    splash.id = 'hc-splash'
    document.body.append(splash)
    const previous = globalThis.fetch
    globalThis.fetch = ((input: RequestInfo | URL): Promise<Response> => {
      const url = String(input)
      if (url === 'https://hypercomb.com/pin') return Promise.resolve(new Response(`${pin}\n`, { status: 200 }))
      if (url === `https://hypercomb.com/${pin}`) return Promise.resolve(new Response(exactBuffer(sourceBytes), { status: 200 }))
      return Promise.resolve(new Response('', { status: 404 }))
    }) as typeof fetch
    try {
      const ok = await servePinnedInitial(async () => ({
        boot: () => ({
          prompt: () => {
            document.body.append(document.createElement('hc-shim-hosts'))
            throw new Error('boot failed')
          },
        }),
      }))
      expect(ok).toBe(false)
      expect(document.querySelector('hc-shim-hosts')).toBeNull()
      expect(document.getElementById('hc-splash')).toBe(splash)
    } finally {
      globalThis.fetch = previous
      splash.remove()
      document.querySelector('hc-shim-hosts')?.remove()
    }
  })

  it('does not arm on this page, which is not hypercomb.io', () => {
    delete (window as unknown as { __hcPhoneGateway?: unknown }).__hcPhoneGateway
    // The classic script, evaluated as the page would evaluate it.
    // eslint-disable-next-line no-eval
    eval(source)
    expect((window as unknown as { __hcPhoneGateway?: unknown }).__hcPhoneGateway).toBeUndefined()
  })
})
