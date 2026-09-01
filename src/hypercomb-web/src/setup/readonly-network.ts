// Network capability gate for published websites.
//
// Every byte needed to render a publication is available through the site's
// own GET surface. Participant relays, DCP, post-back, WebSockets and mutation
// requests are not part of the visitor configuration. Install this before the
// normal runtime graph so even an otherwise enabled participant bee cannot
// cross that boundary.

const allowedUrl = (value: string | URL): URL => new URL(String(value), location.href)

export function installReadonlyNetwork(): void {
  const nativeFetch = globalThis.fetch.bind(globalThis)
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : null
    const method = String(init?.method ?? request?.method ?? 'GET').toUpperCase()
    const target = allowedUrl(request?.url ?? input as string | URL)
    // Refusals reject the promise (a TypeError, exactly like a failed fetch)
    // rather than throwing synchronously out of the fetch() call: callers
    // handle "the network said no" everywhere, and a synchronous throw
    // escapes paths that only ever wrapped the await.
    if (method !== 'GET' && method !== 'HEAD') {
      return Promise.reject(new TypeError(`Failed to fetch: published websites cannot send ${method} requests.`))
    }
    if ((target.protocol === 'http:' || target.protocol === 'https:') && target.origin !== location.origin) {
      return Promise.reject(new TypeError(`Failed to fetch: published websites cannot contact ${target.origin}.`))
    }
    return nativeFetch(input, init)
  }) as typeof fetch

  // The website lens has no live relay. A blocked socket must fail the way an
  // UNREACHABLE one does — construct, then error and close asynchronously —
  // never by throwing at construction. Clients treat a constructor throw as a
  // programming error rather than a dead endpoint, so a reconnect loop retries
  // immediately instead of backing off: on a real origin (where the live-relay
  // policy is on, unlike loopback) that spins the main thread flat out and the
  // page never paints. Failing asynchronously drops every client onto its
  // normal offline path, which is what the visitor wants anyway.
  class ReadonlyWebSocket extends EventTarget {
    static readonly CONNECTING = 0
    static readonly OPEN = 1
    static readonly CLOSING = 2
    static readonly CLOSED = 3
    readonly CONNECTING = 0
    readonly OPEN = 1
    readonly CLOSING = 2
    readonly CLOSED = 3
    readyState = 0
    bufferedAmount = 0
    extensions = ''
    protocol = ''
    binaryType: BinaryType = 'blob'
    readonly url: string
    onopen: ((this: WebSocket, ev: Event) => unknown) | null = null
    onerror: ((this: WebSocket, ev: Event) => unknown) | null = null
    onclose: ((this: WebSocket, ev: CloseEvent) => unknown) | null = null
    onmessage: ((this: WebSocket, ev: MessageEvent) => unknown) | null = null

    constructor(url: string | URL) {
      super()
      this.url = String(url)
      setTimeout(() => {
        this.readyState = 3
        const error = new Event('error')
        this.onerror?.call(this as unknown as WebSocket, error)
        this.dispatchEvent(error)
        const closed = new CloseEvent('close', { code: 1006, reason: 'published websites do not open WebSockets', wasClean: false })
        this.onclose?.call(this as unknown as WebSocket, closed)
        this.dispatchEvent(closed)
      }, 0)
    }

    send(): void { /* never connected — dropping matches an unreachable relay */ }
    close(): void { this.readyState = 3 }
  }
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: ReadonlyWebSocket })

  if (typeof navigator.sendBeacon === 'function') {
    Object.defineProperty(navigator, 'sendBeacon', {
      configurable: true,
      value: (): boolean => false,
    })
  }

  if (typeof XMLHttpRequest !== 'undefined') {
    const nativeOpen = XMLHttpRequest.prototype.open
    XMLHttpRequest.prototype.open = function readonlyOpen(
      method: string,
      url: string | URL,
      ...rest: unknown[]
    ): void {
      const verb = String(method).toUpperCase()
      const target = allowedUrl(url)
      if ((verb !== 'GET' && verb !== 'HEAD') || target.origin !== location.origin) {
        throw new DOMException('Published websites allow only same-origin reads.', 'SecurityError')
      }
      ;(nativeOpen as (...args: unknown[]) => void).call(this, method, String(url), ...rest)
    }
  }
}
