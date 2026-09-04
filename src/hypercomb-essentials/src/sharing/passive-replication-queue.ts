import { EffectBus } from '@hypercomb/core'
import type { ReplicationRequest, ReplicationStatus, SignatureReplicationService } from './signature-replication.service.js'
import { SignatureReplicationService as ReplicationClient } from './signature-replication.service.js'
import type { ActiveGenomeService } from '../history/active-genome.service.js'

const STATE_KEY = 'hc:replication:intents:v1'
const SIG_RE = /^[a-f0-9]{64}$/
export const PASSIVE_REPLICATION_KEY = '@diamondcoreprocessor.com/PassiveReplicationQueue'
type StoredIntent = ReplicationRequest & { domain: string }
type StoredState = { currentGenomeGeneration: number; signatures: StoredIntent[] }
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>
type IdleScheduler = { request(callback: () => void): number; cancel(handle: number): void }

export type PassiveReplicationOptions = {
  replication: SignatureReplicationService
  storage?: StorageLike
  idle?: IdleScheduler
  /** Runs only behind the ready+idle gate and must observe cancellation. */
  currentGenome: (signal: AbortSignal) => Promise<StoredIntent | null>
  /**
   * THE GESTURE. A push is publishing, and publishing is an act: nothing
   * leaves this machine because a commit happened. Consulted at dispatch,
   * never at enqueue — intent stays durable and drains the moment the
   * participant opts in. The default wiring asks HostSyncService for the
   * SAME opt-in that gates every other push to the self-domain.
   */
  allowed?: () => boolean
}

const defaultIdle = (): IdleScheduler => {
  const scope = globalThis as typeof globalThis & {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
    cancelIdleCallback?: (handle: number) => void
  }
  return scope.requestIdleCallback
    ? { request: callback => scope.requestIdleCallback!(callback, { timeout: 15_000 }), cancel: handle => scope.cancelIdleCallback?.(handle) }
    : { request: callback => globalThis.setTimeout(callback, 15_000) as unknown as number, cancel: handle => globalThis.clearTimeout(handle) }
}

/** Durable passive dispatcher. Construction/start perform no storage reads,
 * genome work, hashing, receipt downloads, probes, or network calls. */
export class PassiveReplicationQueue {
  readonly #replication: SignatureReplicationService
  readonly #storage: StorageLike
  readonly #idle: IdleScheduler
  readonly #currentGenome: PassiveReplicationOptions['currentGenome']
  readonly #allowed: () => boolean
  #ready = false
  #foreground = false
  #scheduled: number | null = null
  #running: AbortController | null = null

  constructor(options: PassiveReplicationOptions) {
    this.#replication = options.replication
    this.#storage = options.storage ?? localStorage
    this.#idle = options.idle ?? defaultIdle()
    this.#currentGenome = options.currentGenome
    this.#allowed = options.allowed ?? (() => true)
  }

  start(): void {
    EffectBus.on('history:head-changed', this.enqueueCurrentGenome)
    EffectBus.on('history:marker-wrote', this.enqueueCurrentGenome)
    EffectBus.on('navigation:guard-start', this.foregroundStarted)
    EffectBus.on('navigation:guard-end', this.foregroundSettled)
    // mesh:ready is later than canvas creation and initial data preload.
    EffectBus.on('mesh:ready', this.markReady)
    EffectBus.on<{ shadedLabels?: unknown[] }>('render:tile-readiness', payload => {
      if (payload?.shadedLabels?.length) this.foregroundStarted()
      else this.foregroundSettled()
    })
  }

  /** Atomic localStorage replacement: synchronous, tiny, and coalescing. */
  public readonly enqueueCurrentGenome = (): void => {
    const state = this.#read()
    this.#write({ ...state, currentGenomeGeneration: state.currentGenomeGeneration + 1 })
    this.#schedule()
  }

  /** Explicit arbitrary signatures remain distinct durable queue items. */
  public readonly enqueueSignature = (intent: StoredIntent): void => {
    if (!SIG_RE.test(intent.signature)) throw new TypeError('signature must be lowercase 64-hex')
    const state = this.#read()
    const signatures = state.signatures.filter(item => item.domain !== intent.domain || item.signature !== intent.signature)
    signatures.push(intent)
    this.#write({ ...state, signatures })
    this.#schedule()
  }

  public readonly markReady = (): void => { this.#ready = true; this.#schedule() }
  public readonly foregroundStarted = (): void => {
    this.#foreground = true
    if (this.#scheduled !== null) { this.#idle.cancel(this.#scheduled); this.#scheduled = null }
    this.#running?.abort()
  }
  public readonly foregroundSettled = (): void => { this.#foreground = false; this.#schedule() }
  /** Hook for later online/visibility/background-sync opportunities. */
  public readonly resume = (): void => { this.#schedule() }
  public readonly pending = (): StoredState => this.#read()

  #schedule(): void {
    if (!this.#ready || this.#foreground || this.#scheduled !== null || this.#running) return
    this.#scheduled = this.#idle.request(() => {
      this.#scheduled = null
      if (!this.#ready || this.#foreground) return
      void this.#dispatchOne()
    })
  }

  async #dispatchOne(): Promise<void> {
    if (this.#running) return
    // No opt-in, no work: not the genome read, not a probe, not a byte. The
    // queue keeps its intent and is re-scheduled by the next ready/idle edge.
    let allowed = false
    try { allowed = this.#allowed() === true } catch { allowed = false }
    if (!allowed) return
    const controller = new AbortController()
    this.#running = controller
    let progressed = false
    try {
      const state = this.#read()
      if (state.currentGenomeGeneration > 0) {
        const claimedGeneration = state.currentGenomeGeneration
        const intent = await this.#currentGenome(controller.signal)
        if (!intent || controller.signal.aborted || this.#foreground) return
        if (await this.#complete(intent, controller.signal)) {
          const latest = this.#read()
          // A newer head event supersedes this result and remains queued.
          if (latest.currentGenomeGeneration === claimedGeneration) {
            this.#write({ ...latest, currentGenomeGeneration: 0 })
            progressed = true
          }
        }
        return
      }
      const intent = state.signatures[0]
      if (!intent) return
      if (await this.#complete(intent, controller.signal)) {
        const latest = this.#read()
        this.#write({ ...latest, signatures: latest.signatures.filter(item => item.domain !== intent.domain || item.signature !== intent.signature) })
        progressed = true
      }
    } finally {
      if (this.#running === controller) this.#running = null
      if (progressed) this.#schedule()
    }
  }

  async #complete(intent: StoredIntent, signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) return false
    let status = await this.#replication.status(intent.domain, intent.signature, signal)
    if (!status && !signal.aborted) {
      if (!await this.#replication.replicate(intent.domain, intent, signal) || signal.aborted) return false
      status = await this.#replication.status(intent.domain, intent.signature, signal)
    }
    if (!this.#isComplete(status) || signal.aborted) return false
    const receipts = await this.#replication.refreshReceipts(intent.domain, signal)
    if (!receipts?.signatures.includes(intent.signature) || signal.aborted) return false
    return this.#replication.verify(intent.domain, intent.signature, signal)
  }

  #isComplete(status: ReplicationStatus | null): boolean {
    return status?.state === 'complete' && !status.limited && !status.holes?.length && !status.refused?.length
  }
  #read(): StoredState {
    try {
      const value = JSON.parse(this.#storage.getItem(STATE_KEY) ?? '') as Partial<StoredState>
      return { currentGenomeGeneration: Number.isSafeInteger(value.currentGenomeGeneration) ? Math.max(0, Number(value.currentGenomeGeneration)) : 0, signatures: Array.isArray(value.signatures) ? value.signatures : [] }
    } catch { return { currentGenomeGeneration: 0, signatures: [] } }
  }
  #write(state: StoredState): void { this.#storage.setItem(STATE_KEY, JSON.stringify(state)) }
}

/** Runtime wiring remains inert until durable intent + mesh-ready + idle. */
export function createDefaultPassiveReplicationQueue(): PassiveReplicationQueue {
  const replication = new ReplicationClient()
  return new PassiveReplicationQueue({
    replication,
    allowed: () => {
      const ioc = window.ioc as { get?: (key: string) => unknown } | undefined
      const hostSync = ioc?.get?.('@diamondcoreprocessor.com/HostSyncService') as { isEnabled?: () => boolean } | undefined
      return hostSync?.isEnabled?.() === true
    },
    currentGenome: async signal => {
      if (signal.aborted) return null
      let domain = ''
      try { domain = String(localStorage.getItem('hc:nostrmesh:self-domain') ?? '').trim() } catch {}
      if (!domain) return null
      const ioc = window.ioc as { get?: (key: string) => unknown } | undefined
      const genome = ioc?.get?.('@diamondcoreprocessor.com/ActiveGenomeService') as ActiveGenomeService | undefined
      const record = await genome?.current(true)
      const signature = genome?.recordSig
      if (!record || !signature || signal.aborted) return null
      const broker = ioc?.get?.('@diamondcoreprocessor.com/ContentBrokerDrone') as { getKnownDomains?: (signature: string) => string[] } | undefined
      const sources = new Set<string>([window.location.origin])
      // The inventory identity's provenance supplies candidate content bases;
      // never scan the whole object list in the browser merely to build URLs.
      for (const source of broker?.getKnownDomains?.(signature) ?? []) {
        sources.add(/^https?:\/\//i.test(source) ? source : `https://${source}`)
        if (sources.size >= 16) break
      }
      return { domain, signature, sources: [...sources], inventory: true, limit: record.objects.length + record.heads.length * 2 + 1 }
    },
  })
}

const runtimeQueue = createDefaultPassiveReplicationQueue()
runtimeQueue.start()
window.ioc?.register?.(PASSIVE_REPLICATION_KEY, runtimeQueue)
