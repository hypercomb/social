// meeting/sfu-client.ts
//
// THE MEETING'S VIDEO, the browser's half (the meeting point's half is
// hypercomb-relay/meet-worker/sfu.js). One peer connection per person, to
// Cloudflare's SFU, through the meeting point the swarm already meets at: it
// holds the app token, this never does. Nobody connects to anybody else, so
// nobody learns another person's address (documentation/meeting-lobby.md).
//
// Every request goes one at a time: Cloudflare answers a second offer while
// one is still being negotiated with a 406, so the client queues them.

/** Where a meeting point's video routes live, from its relay address:
 *  wss://hypercomb.com → https://hypercomb.com/.well-known/hc-meet/sfu.
 *  '' for something that is no relay address. */
export const sfuBase = (relay: string): string => {
  try {
    const url = new URL(String(relay ?? '').trim())
    if (url.protocol !== 'wss:' && url.protocol !== 'ws:') return ''
    return `${url.protocol === 'wss:' ? 'https' : 'http'}://${url.host}/.well-known/hc-meet/sfu`
  } catch { return '' }
}

export const SESSION_ID = /^[A-Za-z0-9_-]{8,160}$/

export type SfuTrack = { readonly mid: string; readonly trackName: string; readonly error?: unknown }

export type SubscribeAnswer = {
  /** Cloudflare's offer to apply, when the new tracks need renegotiating. */
  readonly offer?: string
  readonly tracks: readonly SfuTrack[]
}

/** What the meeting point counts the month to have cost, in GB (an estimate of
 *  what Cloudflare sends out), and this meeting's share split by session —
 *  what each session was sent. The same answer to everyone in the meeting. */
export type SfuSpend = {
  readonly month: string
  readonly gb: number
  readonly capGb: number
  readonly meeting: { readonly gb: number; readonly sessions: Readonly<Record<string, number>> }
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0)

export class SfuError extends Error {
  constructor(readonly status: number, message: string) { super(message) }
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>

export class SfuClient {
  readonly #base: string
  readonly #meeting: string
  readonly #access: string
  readonly #fetch: FetchLike
  #queue: Promise<unknown> = Promise.resolve()
  sessionId = ''

  constructor(opts: { base: string; meeting: string; access?: string; fetchImpl?: FetchLike }) {
    this.#base = opts.base
    this.#meeting = opts.meeting
    this.#access = opts.access ?? ''
    this.#fetch = opts.fetchImpl ?? ((url, init) => fetch(url, init))
  }

  /** One request, after every request before it has finished. */
  #send<T>(method: 'POST' | 'PUT', path: string, body?: unknown): Promise<T> {
    const run = async (): Promise<T> => {
      const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Hc-Meeting': this.#meeting }
      if (this.#access) headers['X-Hc-Access'] = this.#access
      const res = await this.#fetch(`${this.#base}${path}`, { method, headers, body: JSON.stringify(body ?? {}) })
      let data: any = {}
      try { data = await res.json() } catch { /* no body */ }
      if (!res.ok || data?.errorCode) throw new SfuError(res.status, String(data?.error ?? data?.errorDescription ?? `video: ${res.status}`))
      return data as T
    }
    const next = this.#queue.then(run, run)
    this.#queue = next.catch(() => undefined)
    return next
  }

  async open(): Promise<string> {
    const data = await this.#send<{ sessionId?: string }>('POST', '/session')
    const id = String(data?.sessionId ?? '')
    if (!SESSION_ID.test(id)) throw new SfuError(502, 'video: no session')
    this.sessionId = id
    return id
  }

  /** Publish local tracks with this connection's offer; the SFU's answer. */
  async publish(offerSdp: string, tracks: readonly { mid: string; trackName: string }[]): Promise<string> {
    const data = await this.#send<{ sessionDescription?: { type?: string; sdp?: string } }>('POST', `/session/${this.sessionId}/tracks`, {
      sessionDescription: { type: 'offer', sdp: offerSdp },
      tracks: tracks.map(t => ({ location: 'local', mid: t.mid, trackName: t.trackName })),
    })
    const sdp = data?.sessionDescription?.type === 'answer' ? data.sessionDescription.sdp : undefined
    if (!sdp) throw new SfuError(502, 'video: no answer')
    return sdp
  }

  /** Subscribe to another person's tracks. */
  async subscribe(from: string, trackNames: readonly string[]): Promise<SubscribeAnswer> {
    const data = await this.#send<{ sessionDescription?: { type?: string; sdp?: string }; tracks?: SfuTrack[] }>(
      'POST', `/session/${this.sessionId}/tracks`,
      { tracks: trackNames.map(trackName => ({ location: 'remote', sessionId: from, trackName })) },
    )
    const offer = data?.sessionDescription?.type === 'offer' ? data.sessionDescription.sdp : undefined
    return { ...(offer ? { offer } : {}), tracks: Array.isArray(data?.tracks) ? data.tracks : [] }
  }

  async renegotiate(answerSdp: string): Promise<void> {
    await this.#send('PUT', `/session/${this.sessionId}/renegotiate`, { sessionDescription: { type: 'answer', sdp: answerSdp } })
  }

  async close(mids: readonly string[]): Promise<void> {
    if (!mids.length || !this.sessionId) return
    await this.#send('PUT', `/session/${this.sessionId}/tracks/close`, { tracks: mids.map(mid => ({ mid })), force: true })
  }

  async beat(): Promise<void> {
    if (!this.sessionId) return
    await this.#send('POST', `/session/${this.sessionId}/beat`)
  }

  /** The month's spend and this meeting's split. A read: it does not wait for
   *  the negotiation queue, and it asks nothing of Cloudflare. */
  async spend(): Promise<SfuSpend> {
    const headers: Record<string, string> = { 'X-Hc-Meeting': this.#meeting }
    if (this.#access) headers['X-Hc-Access'] = this.#access
    const res = await this.#fetch(`${this.#base}/spend`, { method: 'GET', headers })
    let data: any = {}
    try { data = await res.json() } catch { /* no body */ }
    if (!res.ok) throw new SfuError(res.status, String(data?.error ?? `video: ${res.status}`))
    const sessions: Record<string, number> = {}
    for (const [id, gb] of Object.entries(data?.meeting?.sessions ?? {})) if (SESSION_ID.test(id)) sessions[id] = num(gb)
    return { month: String(data?.month ?? ''), gb: num(data?.gb), capGb: num(data?.capGb), meeting: { gb: num(data?.meeting?.gb), sessions } }
  }
}
