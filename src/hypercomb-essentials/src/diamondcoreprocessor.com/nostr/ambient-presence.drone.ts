// hypercomb-essentials/src/diamondcoreprocessor.com/nostr/ambient-presence.drone.ts
// Tracks real-time Nostr presence at the current location.
// When mesh events arrive for the location sig, seeds mentioned in their payload warm up.
// Heat decays naturally over the mesh TTL window — no timer needed.

import { Worker } from '@hypercomb/core'

type MeshEvt = { relay: string; sig: string; event: any; payload: any }
type MeshSub = { close: () => void }
type MeshApi = {
  subscribe: (sig: string, cb: (e: MeshEvt) => void) => MeshSub
}

export class AmbientPresenceDrone extends Worker {
  readonly namespace = 'diamondcoreprocessor.com'

  protected override deps = { mesh: '@diamondcoreprocessor.com/NostrMeshWorker' }
  protected override listens = ['mesh:ensure-started']
  protected override emits = ['render:presence-heat']

  #sub: MeshSub | null = null
  #currentSig = ''
  #lastSeenMs = new Map<string, number>()
  #ttlMs = 120_000 // match mesh TTL

  protected override act = async (): Promise<void> => {
    this.onEffect<{ signature: string }>('mesh:ensure-started', ({ signature }) => {
      if (signature === this.#currentSig) return
      this.#sub?.close()
      this.#currentSig = signature
      this.#lastSeenMs.clear()
      const mesh = this.resolve<MeshApi>('mesh')
      if (!mesh) return
      this.#sub = mesh.subscribe(signature, (evt) => this.#onEvent(evt))
    })
  }

  #onEvent = (evt: MeshEvt): void => {
    const seeds: string[] = Array.isArray(evt.payload?.seeds) ? evt.payload.seeds : []
    const now = Date.now()
    for (const seed of seeds) this.#lastSeenMs.set(seed, now)
    this.#emitHeat()
  }

  #emitHeat = (): void => {
    const now = Date.now()
    const heat: Record<string, number> = {}
    for (const [seed, ms] of this.#lastSeenMs) {
      const age = now - ms
      if (age >= this.#ttlMs) { this.#lastSeenMs.delete(seed); continue }
      heat[seed] = 1 - age / this.#ttlMs
    }
    this.emitEffect('render:presence-heat', heat)
  }

  protected override dispose = (): void => {
    this.#sub?.close()
  }
}

const _drone = new AmbientPresenceDrone()
window.ioc.register('@diamondcoreprocessor.com/AmbientPresenceDrone', _drone)
