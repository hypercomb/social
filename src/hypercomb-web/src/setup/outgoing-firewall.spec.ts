// @vitest-environment jsdom
//
// The outgoing firewall is an inline classic script in the local shell, not a
// module a bee can import and replace. These tests run that script, and they
// run the worker's host filter, which is the egress path the page policy does
// not cover.

import { readFileSync } from 'node:fs'
import { describe, expect, it, beforeAll } from 'vitest'
import { fileURLToPath } from 'node:url'

const at = (p: string): string => fileURLToPath(new URL(p, import.meta.url))
const shell = readFileSync(at('../../../hypercomb-dev/src/index.html'), 'utf8')
const worker = readFileSync(at('../../../hypercomb-web/public/hypercomb.worker.js'), 'utf8')

const policy = (): string => {
  const match = shell.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)
  expect(match, 'local shell is missing its document policy').not.toBeNull()
  return match![1]
}

const firewallScript = (): string => {
  const atMarker = shell.indexOf('hc-outgoing-firewall')
  expect(atMarker, 'firewall marker missing').toBeGreaterThan(-1)
  const open = shell.indexOf('<script>', atMarker)
  const close = shell.indexOf('</script>', open)
  expect(open).toBeGreaterThan(atMarker)
  expect(close).toBeGreaterThan(open)
  return shell.slice(open + '<script>'.length, close)
}

/** Lift `function <name>(…) { … }` out of a script. The bodies under test have no braces inside strings. */
const lift = (source: string, name: string): string => {
  const start = source.indexOf(`function ${name}(`)
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

describe('local shell document policy', () => {
  it('pins egress to loopback and does not fall open through default-src', () => {
    const csp = policy()
    expect(csp).toContain("connect-src 'self'")
    expect(csp).toContain('http://localhost:*')
    expect(csp).toContain('http://127.0.0.1:*')
    expect(csp).toContain('http://*.localhost:*')
    // Chrome drops a bracketed IPv6 host with a port wildcard and, on a stricter
    // parser, an invalid source can discard the whole directive. ::1 stays in
    // the script gate. A page opened at ::1 is covered by 'self'.
    expect(csp).not.toContain('[::1]')
    expect(csp).toContain('ws://localhost:*')
    expect(csp).toContain('wss://*.localhost:*')
    expect(csp).toContain('blob:')
    expect(csp).toContain('data:')
    expect(csp).toContain("script-src 'self' 'unsafe-inline'")
    expect(csp).toContain("style-src 'self' 'unsafe-inline'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("base-uri 'self'")
    expect(csp).toContain("form-action 'self'")
    // A bare scheme would allow every host. Tokens such as https://localhost stay.
    expect(csp).not.toMatch(/(?:^|\s)https:(?:\s|;|$)/)
    expect(csp).not.toMatch(/(?:^|\s)wss:(?:\s|;|$)/)
    expect(csp).not.toMatch(/default-src/)
    expect(shell.indexOf('http-equiv="Content-Security-Policy"')).toBeLessThan(shell.indexOf('hc-outgoing-firewall'))
    // The pause list moves on a trusted click inside the hosts panel. A call
    // and a sentence are not that click.
    expect(shell).toContain('data-hc-firewall')
    expect(shell).toContain("button.closest('hc-host-directory')")
    expect(shell).toContain('event.isTrusted')
    expect(shell).toContain("type: 'hc:sw:door'")
    expect(shell).not.toMatch(/setPaused:\s*function\s*\(zone/)
  })
})

describe('frozen network primitives', () => {
  const calls: string[] = []
  const beacons: string[] = []
  const opened: string[] = []
  const xhr: string[] = []
  const registered: string[] = []
  let navigate: ((event: { destination?: { url?: string }; cancelable?: boolean; preventDefault: () => void }) => void) | null = null

  beforeAll(() => {
    calls.length = 0
    class FakeSocket {
      url: string
      protocols: unknown
      readyState = 1
      constructor(url: string, protocols?: unknown) {
        this.url = String(url)
        this.protocols = protocols
      }
      send(): void {}
      close(): void {}
    }
    Object.assign(FakeSocket, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 })
    Object.defineProperty(window, 'fetch', {
      configurable: true, writable: true,
      value: (input: RequestInfo | URL) => {
        const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url
        calls.push(url)
        return Promise.resolve(new Response('ok'))
      },
    })
    Object.defineProperty(window, 'WebSocket', { configurable: true, writable: true, value: FakeSocket })
    Object.defineProperty(window, 'EventSource', { configurable: true, writable: true, value: FakeSocket })
    Object.defineProperty(window, 'open', {
      configurable: true, writable: true,
      value: (url?: string) => { opened.push(String(url)); return {} },
    })
    XMLHttpRequest.prototype.open = function (method: string, url: string | URL): void {
      xhr.push(`${method} ${String(url)}`)
    }
    const beacon = function (url: string): boolean { beacons.push(String(url)); return true }
    Object.defineProperty(Navigator.prototype, 'sendBeacon', { configurable: true, writable: true, value: beacon })
    Object.defineProperty(window, 'RTCPeerConnection', {
      configurable: true, writable: true,
      value: function Peer() { return { ice: true } },
    })
    class Box {
      register(scriptURL: string): Promise<string> {
        registered.push(String(scriptURL))
        return Promise.resolve(String(scriptURL))
      }
    }
    Object.defineProperty(globalThis, 'ServiceWorkerContainer', { configurable: true, writable: true, value: Box })
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: new Box() })
    Object.defineProperty(window, 'navigation', {
      configurable: true,
      value: {
        addEventListener(_type: string, fn: typeof navigate) { navigate = fn },
      },
    })
    // Classic script, evaluated as the page would evaluate it.
    // eslint-disable-next-line no-eval
    eval(firewallScript())
  })

  it('allows loopback and same-origin fetches and refuses every other host', async () => {
    await expect(fetch('/tile')).resolves.toBeInstanceOf(Response)
    await expect(fetch('http://127.0.0.1:4291/x')).resolves.toBeInstanceOf(Response)
    await expect(fetch('http://try-page.localhost:4291/x')).resolves.toBeInstanceOf(Response)
    await expect(fetch('https://openrouter.ai/api')).rejects.toBeInstanceOf(TypeError)
    await expect(fetch(new Request('https://evil.example/secret'))).rejects.toBeInstanceOf(TypeError)
    expect(calls).toEqual(['/tile', 'http://127.0.0.1:4291/x', 'http://try-page.localhost:4291/x'])
  })

  it('lets an owned zone through over https', async () => {
    calls.length = 0
    await expect(fetch('https://meetings.hypercomb.com/')).resolves.toBeInstanceOf(Response)
    await expect(fetch('https://jwize.com/x')).resolves.toBeInstanceOf(Response)
    await expect(fetch('http://hypercomb.com/')).rejects.toBeInstanceOf(TypeError)
    await expect(fetch('https://hypercomb.com.evil.example/')).rejects.toBeInstanceOf(TypeError)
    expect(calls).toEqual(['https://meetings.hypercomb.com/', 'https://jwize.com/x'])
  })

  it('refuses a script, a storage write, and an untrusted click as the way to pause a zone', async () => {
    await expect(fetch('https://meetings.hypercomb.com/')).resolves.toBeInstanceOf(Response)
    expect(window.__hcFirewall.setPaused('hypercomb.com', true)).toEqual([])
    localStorage.setItem('hc:firewall-paused', JSON.stringify(['hypercomb.com']))
    localStorage.removeItem('hc:firewall-paused')
    const directory = document.createElement('hc-host-directory')
    const button = document.createElement('button')
    button.setAttribute('data-hc-firewall', 'hypercomb.com')
    directory.append(button)
    document.body.append(directory)
    const forged = new MouseEvent('click', { bubbles: true })
    // A page cannot give itself a trusted click. The runtime refuses to
    // redefine isTrusted, and a click the page dispatches is not one.
    expect(() => Object.defineProperty(forged, 'isTrusted', { value: true })).toThrow(TypeError)
    button.dispatchEvent(forged)
    expect(window.__hcFirewall.paused()).toEqual([])
    await expect(fetch('https://meetings.hypercomb.com/')).resolves.toBeInstanceOf(Response)
    expect(localStorage.getItem('hc:firewall-paused') ?? '').not.toContain('hypercomb.com')
    directory.remove()
  })

  it('cannot be replaced by a later script', () => {
    expect(window.__hcOutgoingFirewall).toBe(true)
    expect(Object.getOwnPropertyDescriptor(window, 'fetch')?.configurable).toBe(false)
    expect(Object.getOwnPropertyDescriptor(window, 'fetch')?.writable).toBe(false)
    expect(() => { window.fetch = (() => Promise.resolve(new Response('no'))) as typeof fetch }).toThrow(TypeError)
    expect(() => Object.defineProperty(window, 'fetch', { value: () => Promise.resolve(new Response('no')) })).toThrow(TypeError)
  })

  it('fails a blocked socket asynchronously and lets a loopback socket through', async () => {
    const blocked = new WebSocket('wss://evil.example/relay')
    expect(blocked.readyState).toBe(0)
    const closed = await new Promise<CloseEvent>(resolve => {
      blocked.addEventListener('close', event => resolve(event as CloseEvent))
    })
    expect(closed.wasClean).toBe(false)
    expect(blocked.readyState).toBe(3)
    expect(() => blocked.send('x')).not.toThrow()

    const allowed = new WebSocket('ws://localhost:2401')
    expect(allowed.readyState).toBe(1)
    expect(allowed.url).toBe('ws://localhost:2401')
  })

  it('refuses cross-origin XHR, beacon, window.open, and peer connections', () => {
    expect(() => new XMLHttpRequest().open('POST', 'https://evil.example/x')).toThrow(DOMException)
    new XMLHttpRequest().open('GET', '/local')
    expect(xhr).toEqual(['GET /local'])

    expect(navigator.sendBeacon('https://evil.example/x')).toBe(false)
    expect(navigator.sendBeacon('/local')).toBe(true)
    expect(beacons).toEqual(['/local'])
    expect(() => { navigator.sendBeacon = (() => true) as typeof navigator.sendBeacon }).toThrow(TypeError)

    expect(window.open('https://evil.example/out')).toBeNull()
    expect(window.open('/stay')).toEqual({})
    expect(opened).toEqual(['/stay'])

    expect(() => new RTCPeerConnection()).toThrow(TypeError)
  })

  it('registers only this origin\'s own worker', async () => {
    await expect(navigator.serviceWorker.register('/hypercomb.worker.js?v=3')).resolves.toBe('/hypercomb.worker.js?v=3')
    await expect(navigator.serviceWorker.register('/other.js')).rejects.toBeInstanceOf(TypeError)
    await expect(navigator.serviceWorker.register('https://evil.example/hypercomb.worker.js')).rejects.toBeInstanceOf(TypeError)
    expect(registered).toEqual(['/hypercomb.worker.js?v=3'])
    expect(Object.getOwnPropertyDescriptor(ServiceWorkerContainer.prototype, 'register')?.configurable).toBe(false)
  })

  it('cancels a navigation the page started toward another origin', () => {
    expect(navigate).toBeTypeOf('function')
    let cancelled = false
    navigate!({
      destination: { url: 'https://evil.example/leave' },
      cancelable: true,
      preventDefault: () => { cancelled = true },
    })
    expect(cancelled).toBe(true)
    cancelled = false
    navigate!({
      destination: { url: 'http://localhost:4250/stay' },
      cancelable: true,
      preventDefault: () => { cancelled = true },
    })
    expect(cancelled).toBe(false)
  })
})

describe('service worker host filter', () => {
  const fns = new Function(
    `${worker.match(/^const OWNED_ZONES = .*$/m)![0]}
let PAUSED_ZONES = []
${lift(worker, 'hostIsOwned')}
${lift(worker, 'hostIsLoopback')}\n${lift(worker, 'loopbackHost')}\n${lift(worker, 'filterShellDomains')}\n` +
    'return { hostIsLoopback, loopbackHost, filterShellDomains }',
  )() as {
    hostIsLoopback: (host: string) => boolean
    loopbackHost: (raw: string) => string
    filterShellDomains: (list: unknown, loopback: boolean) => unknown
  }

  it('keeps the two shell copies identical', () => {
    const dev = readFileSync(at('../../../hypercomb-dev/public/hypercomb.worker.js'))
    const web = readFileSync(at('../../../hypercomb-web/public/hypercomb.worker.js'))
    expect(dev.equals(web)).toBe(true)
  })

  it('drops external hosts on a loopback shell and leaves a public shell alone', () => {
    expect(fns.hostIsLoopback('localhost')).toBe(true)
    expect(fns.hostIsLoopback('try-page.localhost')).toBe(true)
    expect(fns.hostIsLoopback('127.0.0.1')).toBe(true)
    expect(fns.hostIsLoopback('::1')).toBe(true)
    expect(fns.hostIsLoopback('localhost.evil.com')).toBe(false)
    expect(fns.hostIsLoopback('notlocalhost')).toBe(false)
    expect(fns.hostIsLoopback('hypercomb.com')).toBe(false)
    expect(fns.loopbackHost('https://hypercomb.com')).toBe('hypercomb.com')
    expect(fns.loopbackHost('meetings.hypercomb.com')).toBe('meetings.hypercomb.com')
    expect(fns.loopbackHost('hypercomb.com.evil.example')).toBe('')

    expect(fns.loopbackHost('https://openrouter.ai')).toBe('')
    expect(fns.loopbackHost('user@localhost')).toBe('')
    expect(fns.loopbackHost('[::1]:4291')).toBe('[::1]:4291')
    expect(fns.loopbackHost('localhost:4291')).toBe('localhost:4291')

    const posted = ['https://hypercomb.com', 'localhost:4291', 'try-a.localhost:4291', '127.0.0.1:2401', 'https://openrouter.ai']
    expect(fns.filterShellDomains(posted, true)).toEqual(['hypercomb.com', 'localhost:4291', 'try-a.localhost:4291', '127.0.0.1:2401'])
    expect(fns.filterShellDomains(posted, false)).toBe(posted)
  })

  it('skips a non-loopback host again at fetch time', () => {
    expect(worker).toContain('if (loopback && !loopbackHost(host)) continue')
  })

  it('ignores a pause list that did not come through the human door', () => {
    expect(worker).toContain("data.type === 'hc:sw:door'")
    expect(worker).toContain('data.token !== DOOR_TOKEN')
    expect(worker).not.toMatch(/if \(!data \|\| data\.type !== 'hc:sw:paused'/)
  })
})
