// hypercomb-web/src/setup/sentinel-bridge.ts
//
// Cross-origin bridge to DCP sentinel.
// Creates a hidden iframe pointing at DCP's /sentinel route,
// performs a MessageChannel handshake, and exposes a promise-based API
// for content requests.
//
// Security: DCP runs on a separate origin — even if a compromised bee
// runs inside web's origin, it cannot tamper with DCP's verification
// logic, trusted domain list, or auditor endpoints.

const DCP_ORIGIN =
  globalThis.location?.hostname === 'localhost'
    ? 'http://localhost:2400'
    : 'https://diamondcoreprocessor.com'

const HANDSHAKE_TIMEOUT = 5_000

export type SentinelFile = {
  signature: string
  kind: 'layer' | 'bee' | 'dependency'
  bytes: ArrayBuffer
}

/**
 * Kinds that the web app can push up to DCP.
 * "resource" maps to __resources__/{sig} (no extension);
 * other kinds mirror the canonical bag layout.
 */
export type IntakeKind = 'layer' | 'bee' | 'dependency' | 'resource'

export type SentinelInstallResult = {
  manifest: any
  rootSig: string
  beeDeps?: Record<string, string[]>
  files: SentinelFile[]
}

export type SentinelSyncResult = {
  syncSig: string
  enabledBees: string[]
  enabledDeps: string[]
  enabledLayers: string[]
  beeDeps?: Record<string, string[]>
  files: SentinelFile[]
}

export class SentinelBridge {

  #port: MessagePort
  #pending = new Map<string, { resolve: (v: any) => void; reject: (e: any) => void }>()
  #fileCollectors = new Map<string, SentinelFile[]>()
  #progressListeners = new Map<string, (p: { phase: string; current: number; total: number }) => void>()
  #ridCounter = 0
  #onToggleChanged: (() => void) | null = null
  #onDcpClosed: (() => void) | null = null

  constructor(port: MessagePort) {
    this.#port = port
    this.#port.onmessage = (e) => this.#onMessage(e.data)
  }

  /** Register a callback for when DCP toggles a bee on/off. */
  set onToggleChanged(fn: (() => void) | null) {
    this.#onToggleChanged = fn
  }

  /** Register a callback for when the DCP tab closes. */
  set onDcpClosed(fn: (() => void) | null) {
    this.#onDcpClosed = fn
  }

  /**
   * Request a full content install through DCP.
   * DCP fetches from its trusted domains, verifies, and streams files back.
   */
  async install(
    installedSig?: string,
    onProgress?: (p: { phase: string; current: number; total: number }) => void
  ): Promise<SentinelInstallResult | null> {
    const rid = this.#nextRid()
    this.#fileCollectors.set(rid, [])
    if (onProgress) this.#progressListeners.set(rid, onProgress)

    return new Promise((resolve, reject) => {
      this.#pending.set(rid, { resolve, reject })
      this.#port.postMessage({ type: 'install', rid, installedSig })
    })
  }

  /**
   * Sync with DCP's toggle state.
   * DCP computes what's enabled, diffs, streams files.
   * Returns the enabled set + sync signature for web to apply.
   */
  async sync(currentSyncSig?: string): Promise<SentinelSyncResult | null> {
    const rid = this.#nextRid()
    this.#fileCollectors.set(rid, [])

    return new Promise((resolve, reject) => {
      this.#pending.set(rid, { resolve, reject })
      this.#port.postMessage({ type: 'sync', rid, currentSyncSig })
    })
  }

  /**
   * Push a single sig + bytes up to DCP. DCP verifies SHA-256, writes
   * to its `__from-hypercomb__/{kind}/` namespace, and replies with an
   * ack. Resolves true on ack, false on nack/timeout. Caller is
   * responsible for preserving the queue entry on a false return.
   */
  async intake(signature: string, kind: IntakeKind, bytes: ArrayBuffer): Promise<boolean> {
    const rid = this.#nextRid()

    return new Promise((resolve) => {
      // DCP replies with { type: 'intake-ack', rid, ok: true | false }.
      // Bridge resolve/reject are wired so 'intake-ack' ok=true → resolve(true),
      // ok=false → resolve(false). Caller leaves the queue entry on false.
      this.#pending.set(rid, {
        resolve: (v: boolean) => resolve(v === true),
        reject: () => resolve(false)
      })
      try {
        this.#port.postMessage({ type: 'intake', rid, signature, kind, bytes }, [bytes])
      } catch {
        this.#pending.delete(rid)
        resolve(false)
      }
    })
  }

  /**
   * Fetch a single content file through DCP.
   */
  async fetchContent(
    signature: string,
    kind: 'layer' | 'bee' | 'dependency',
    rootSig: string
  ): Promise<ArrayBuffer | null> {
    const rid = this.#nextRid()

    return new Promise((resolve, reject) => {
      this.#pending.set(rid, { resolve, reject })
      this.#port.postMessage({ type: 'fetch-content', rid, signature, kind, rootSig })
    })
  }

  #onMessage(msg: any): void {
    if (!msg) return

    // DCP toggle change — no rid, fire callback immediately
    if (msg.type === 'toggle-changed') {
      console.log('[sentinel-bridge] received toggle-changed from DCP')
      this.#onToggleChanged?.()
      return
    }

    // DCP tab closed — commit deferred state via reload
    if (msg.type === 'dcp-closed') {
      console.log('[sentinel-bridge] received dcp-closed from DCP')
      this.#onDcpClosed?.()
      return
    }

    if (!msg.rid) return
    const { rid } = msg

    switch (msg.type) {
      case 'progress': {
        const listener = this.#progressListeners.get(rid)
        listener?.({ phase: msg.phase, current: msg.current, total: msg.total })
        break
      }

      case 'file': {
        const files = this.#fileCollectors.get(rid)
        files?.push({ signature: msg.signature, kind: msg.kind, bytes: msg.bytes })
        break
      }

      case 'install-done': {
        const files = this.#fileCollectors.get(rid) ?? []
        this.#fileCollectors.delete(rid)
        this.#progressListeners.delete(rid)
        const pending = this.#pending.get(rid)
        this.#pending.delete(rid)
        pending?.resolve({
          manifest: msg.manifest,
          rootSig: msg.rootSig,
          beeDeps: msg.beeDeps,
          files
        })
        break
      }

      case 'sync-result': {
        const files = this.#fileCollectors.get(rid) ?? []
        this.#fileCollectors.delete(rid)
        const pending = this.#pending.get(rid)
        this.#pending.delete(rid)
        pending?.resolve({
          syncSig: msg.syncSig,
          enabledBees: msg.enabledBees ?? [],
          enabledDeps: msg.enabledDeps ?? [],
          enabledLayers: msg.enabledLayers ?? [],
          beeDeps: msg.beeDeps,
          files
        } as SentinelSyncResult)
        break
      }

      case 'result': {
        const pending = this.#pending.get(rid)
        this.#pending.delete(rid)
        this.#fileCollectors.delete(rid)
        this.#progressListeners.delete(rid)
        if (msg.ok) {
          pending?.resolve(msg.data)
        } else {
          console.warn(`[sentinel-bridge] ${msg.error}`)
          pending?.resolve(null)
        }
        break
      }

      case 'intake-ack': {
        const pending = this.#pending.get(rid)
        this.#pending.delete(rid)
        pending?.resolve(msg.ok === true)
        break
      }
    }
  }

  #nextRid(): string {
    return `r${++this.#ridCounter}-${Date.now()}`
  }
}

/**
 * Initialize the sentinel bridge.
 * Creates a hidden iframe, performs a MessageChannel handshake with DCP.
 * Returns null if DCP is unreachable (timeout).
 */
export const initSentinel = async (): Promise<SentinelBridge | null> => {
  return new Promise<SentinelBridge | null>((resolve) => {
    const iframe = document.createElement('iframe')
    iframe.src = `${DCP_ORIGIN}/sentinel`
    iframe.style.display = 'none'
    iframe.setAttribute('aria-hidden', 'true')
    document.body.appendChild(iframe)

    const timeout = setTimeout(() => {
      window.removeEventListener('message', onAnnounce)
      console.warn('[sentinel-bridge] DCP handshake timed out — content will be fetched directly (unaudited)')
      resolve(null)
    }, HANDSHAKE_TIMEOUT)

    // Listen for the sentinel component to announce itself.
    // The iframe 'load' event fires before Angular mounts the component,
    // so we wait for the sentinel to say "I'm ready" via postMessage.
    const onAnnounce = (e: MessageEvent) => {
      if (e.data?.scope !== 'dcp-sentinel' || e.data?.type !== 'sentinel-ready') return
      window.removeEventListener('message', onAnnounce)

      const channel = new MessageChannel()

      channel.port1.onmessage = (ev) => {
        if (ev.data?.type === 'ready') {
          clearTimeout(timeout)
          const bridge = new SentinelBridge(channel.port1)
          ;(globalThis as any).__sentinelBridge = bridge
          console.log('[sentinel-bridge] connected to DCP sentinel')
          resolve(bridge)
        }
      }

      iframe.contentWindow?.postMessage(
        { scope: 'dcp-sentinel', type: 'handshake' },
        DCP_ORIGIN,
        [channel.port2]
      )
    }
    window.addEventListener('message', onAnnounce)

    iframe.addEventListener('error', () => {
      clearTimeout(timeout)
      window.removeEventListener('message', onAnnounce)
      console.warn('[sentinel-bridge] DCP iframe failed to load — content will be fetched directly (unaudited)')
      resolve(null)
    })
  })
}
