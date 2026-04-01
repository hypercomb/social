// diamondcoreprocessor.com/nostr/ambient-presence.worker.ts
import { Worker } from '@hypercomb/core'

type MeshEvt = { relay: string; sig: string; event: any; payload: any }
type MeshSub = { close: () => void }
type MeshApi = {
  subscribe: (sig: string, cb: (e: MeshEvt) => void) => MeshSub
}

export class AmbientPresenceWorker extends Worker {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'sharing'

  public override description =
    'Aggregates peer presence into a heat map overlay by tracking mesh event timestamps.'
  public override effects = ['network'] as const

  protected override deps = { mesh: '@diamondcoreprocessor.com/NostrMeshDrone' }
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
    const cells: string[] = Array.isArray(evt.payload?.cells) ? evt.payload.cells : Array.isArray(evt.payload?.seeds) ? evt.payload.seeds : []
    const now = Date.now()
    for (const cell of cells) this.#lastSeenMs.set(cell, now)
    this.#emitHeat()
  }

  #emitHeat = (): void => {
    const now = Date.now()
    const heat: Record<string, number> = {}
    for (const [cell, ms] of this.#lastSeenMs) {
      const age = now - ms
      if (age >= this.#ttlMs) { this.#lastSeenMs.delete(cell); continue }
      heat[cell] = 1 - age / this.#ttlMs
    }
    this.emitEffect('render:presence-heat', heat)
  }

  protected override dispose = (): void => {
    this.#sub?.close()
  }
}

const _drone = new AmbientPresenceWorker()
window.ioc.register('@diamondcoreprocessor.com/AmbientPresenceWorker', _drone)
