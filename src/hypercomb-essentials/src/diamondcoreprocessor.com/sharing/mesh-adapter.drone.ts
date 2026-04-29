// diamondcoreprocessor.com/core/communication/mesh-adapter.drone.ts
import { Drone, type Effect } from '@hypercomb/core'

type NostrRelay = string

interface MeshAdapterConfig {
  relays: NostrRelay[]
}

export class MeshAdapterDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'sharing'

  public override description =
    'Posts a Hypercomb signature to the Nostr mesh'

  public override grammar = [
    { example: 'share' },
    { example: 'publish' },
    { example: 'broadcast' }

  ]

  // optional future use (auditable intent)
  public override effects = ['network' as Effect]

  // default relays (can be overridden later)
  private readonly config: MeshAdapterConfig = {
    relays: [
      'wss://relay.damus.io',
      'wss://nostr.wine',
      'wss://relay.snort.social'
    ]
  }

  // Mesh is private by default (idle). When the user toggles to
  // public via the mesh control or `mesh.togglePublic` keymap, we
  // start publishing; otherwise this drone is silent — no
  // WebSockets, no network traffic, no warnings. Initial value is
  // read from localStorage so a refresh of an already-public mesh
  // doesn't have a transient idle window before the first
  // mesh:public-changed event arrives.
  #meshPublic = (() => {
    try { return localStorage.getItem('hc:mesh-public') === 'true' } catch { return false }
  })()

  constructor() {
    super()
    this.onEffect<{ public: boolean }>('mesh:public-changed', (payload) => {
      this.#meshPublic = !!payload?.public
    })
  }

  // -------------------------------------------------
  // execution
  // -------------------------------------------------

  public override heartbeat = async (grammar: any): Promise<void> => {
    // Private mode = idle. No network traffic, no WebSockets, no
    // warnings. Mesh is opt-in: the user toggles to public via the
    // mesh control or the `mesh.togglePublic` keymap.
    if (!this.#meshPublic) return

    const signature = grammar?.signature
    if (!signature || typeof signature !== 'string') {
      // Most pulses don't carry a signature — silently no-op rather than
      // logging on every pulse-fan-out tick. The console-warn here was
      // firing dozens of times per boot and adding noise on machines
      // that have DevTools open.
      return
    }

    // Fire-and-forget: a Nostr broadcast is not on the rendering
    // critical path. Awaiting it here would block the processor's
    // pulse fan-out — which on a slow network with unreachable relays
    // can hang for tens of seconds (each relay's WebSocket has no
    // timeout). The publish runs in the background; the heartbeat
    // resolves immediately. Errors are surfaced as warnings, not as
    // pulse rejections.
    void this.publishSignature(signature)
  }

  // -------------------------------------------------
  // nostr publish
  // -------------------------------------------------

  /** Per-relay connect/send timeout. Public Nostr relays are
   *  best-effort — a slow or unresponsive relay should not delay the
   *  publish. 2s is generous for a successful WebSocket open + send;
   *  anything slower we'd rather drop than wait on. */
  private readonly RELAY_TIMEOUT_MS = 2_000

  private readonly publishSignature = async (signature: string): Promise<void> => {
    const event = this.createEvent(signature)

    // Run all relays in parallel. Bound on the slowest, not the sum,
    // so total publish time is at most RELAY_TIMEOUT_MS regardless of
    // relay count.
    const results = await Promise.allSettled(
      this.config.relays.map(relay => this.sendToRelay(relay, event))
    )
    for (let i = 0; i < results.length; i++) {
      const r = results[i]
      if (r.status === 'rejected') {
        console.warn('[mesh-adapter] relay failed', this.config.relays[i], r.reason)
      }
    }
  }

  private readonly createEvent = (signature: string) => {
    return {
      kind: 1, // text note
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['hypercomb', 'signature']
      ],
      content: signature
    }
  }

  private readonly sendToRelay = async (
    relayUrl: string,
    event: any
  ): Promise<void> => {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(relayUrl)
      let settled = false

      // Hard timeout: if the relay doesn't respond within
      // RELAY_TIMEOUT_MS, abort the connection and reject. Without
      // this, a hung WebSocket can delay the publish indefinitely.
      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        try { ws.close() } catch { /* ignore */ }
        reject(new Error(`relay timeout after ${this.RELAY_TIMEOUT_MS}ms`))
      }, this.RELAY_TIMEOUT_MS)

      ws.onopen = () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        try { ws.send(JSON.stringify(['EVENT', event])) } catch (err) {
          try { ws.close() } catch { /* ignore */ }
          reject(err); return
        }
        try { ws.close() } catch { /* ignore */ }
        resolve()
      }

      ws.onerror = err => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        try { ws.close() } catch { /* ignore */ }
        reject(err)
      }
    })
  }
}

const _meshAdapter = new MeshAdapterDrone()
window.ioc.register('@diamondcoreprocessor.com/MeshAdapterDrone', _meshAdapter)
