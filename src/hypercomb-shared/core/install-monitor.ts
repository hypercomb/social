// hypercomb-shared/core/install-monitor.ts
//
// Tiny pub-sub for the background install/sync state.
// Listens on EffectBus 'install:state' events and exposes a reactive state
// for UI components (e.g. the controls-bar status indicator).

import { EffectBus } from '@hypercomb/core'

export type InstallState = 'idle' | 'checking' | 'syncing' | 'complete' | 'error' | 'adopting'

export type InstallStatePayload = {
  state: InstallState
  changedFiles?: number
  error?: string
  /** When state='adopting': the label/name of the tile being adopted. */
  adoptLabel?: string
  /** When state='adopting': all host domains known to hold the rootSig.
   *  Empty until the first mesh response carries a domain attribution.
   *  When empty, the UI falls back to "via swarm host" — the bytes will
   *  arrive over the relay's mesh-bytes path. */
  adoptDomains?: string[]
}

export class InstallMonitor extends EventTarget {

  #state: InstallState = 'idle'
  #changedFiles = 0
  #error: string | null = null
  #adoptLabel: string | null = null
  #adoptDomains: string[] = []

  constructor() {
    super()
    EffectBus.on<InstallStatePayload>('install:state', payload => {
      this.#state = payload.state
      this.#changedFiles = payload.changedFiles ?? 0
      this.#error = payload.error ?? null
      this.#adoptLabel = payload.adoptLabel ?? this.#adoptLabel
      if (Array.isArray(payload.adoptDomains)) this.#adoptDomains = payload.adoptDomains
      this.dispatchEvent(new CustomEvent('change'))

      // 'complete' is transient — fade back to 'idle' after a short delay
      // so the indicator does not stay lit forever.
      if (payload.state === 'complete') {
        setTimeout(() => {
          if (this.#state !== 'complete') return
          this.#state = 'idle'
          this.#adoptLabel = null
          this.#adoptDomains = []
          this.dispatchEvent(new CustomEvent('change'))
        }, 4000)
      }
    })

    // ─── Adoption-flow crumb DISABLED ────────────────────────────────
    // Per the redesigned adopt flow, the visible feedback for clicking
    // adopt IS the embedded installer opening (portal-overlay shows the
    // DCP iframe with #branch=<sig>) — not a top-bar status crumb. The
    // user explicitly asked to remove this intermediate "message stage"
    // because the portal already conveys "something is happening." The
    // adopt:* events still fire (broker.adopt emits them for its own
    // bookkeeping) but nothing here listens, so the crumb stays idle.
    //
    // If a future flow needs the crumb back (e.g. background pre-fetch
    // without a portal pop), re-enable just the listeners it needs.
    // History: until 2026-06, this listened to adopt:started/meta/done/
    // denied. Kept the type signatures + getters intact so consumers
    // that read state/adoptLabel/adoptDomains keep compiling.
  }

  get state(): InstallState {
    return this.#state
  }

  get changedFiles(): number {
    return this.#changedFiles
  }

  get error(): string | null {
    return this.#error
  }

  /** When state='adopting': the tile label being adopted, or null. */
  get adoptLabel(): string | null {
    return this.#adoptLabel
  }

  /** When state='adopting': every host domain known to hold the rootSig.
   *  Empty until first mesh attribution arrives; an empty array means
   *  the bytes will be delivered through the swarm host's mesh-bytes
   *  fallback rather than via HTTP-direct. */
  get adoptDomains(): string[] {
    return this.#adoptDomains
  }
}

register('@hypercomb.social/InstallMonitor', new InstallMonitor())
