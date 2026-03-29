// diamondcoreprocessor.com/computation/computation-routing.service.ts

export type ComputationRouteResult =
  | { source: 'local' }
  | { source: 'peer'; peers: string[] }
  | null

export class ComputationRoutingService {

  #localSignatures = new Set<string>()
  #routingTable = new Map<string, Set<string>>()
  #lastSeen = new Map<string, number>()

  // -------------------------------------------------
  // local registration
  // -------------------------------------------------

  public readonly registerLocal = (signature: string): void => {
    this.#localSignatures.add(signature)
  }

  public readonly hasLocal = (signature: string): boolean => {
    return this.#localSignatures.has(signature)
  }

  // -------------------------------------------------
  // peer routing
  // -------------------------------------------------

  public readonly recordPeerSource = (signature: string, peerId: string): void => {
    let peers = this.#routingTable.get(signature)
    if (!peers) {
      peers = new Set<string>()
      this.#routingTable.set(signature, peers)
    }
    peers.add(peerId)
    this.#lastSeen.set(signature, Date.now())
  }

  // -------------------------------------------------
  // resolve
  // -------------------------------------------------

  public readonly resolve = (signature: string): ComputationRouteResult => {
    if (this.#localSignatures.has(signature)) {
      return { source: 'local' }
    }

    const peers = this.#routingTable.get(signature)
    if (peers && peers.size > 0) {
      return { source: 'peer', peers: Array.from(peers) }
    }

    return null
  }

  // -------------------------------------------------
  // maintenance
  // -------------------------------------------------

  public readonly prune = (maxAgeMs: number): void => {
    const cutoff = Date.now() - maxAgeMs
    for (const [signature, lastSeen] of this.#lastSeen) {
      if (lastSeen < cutoff) {
        this.#routingTable.delete(signature)
        this.#lastSeen.delete(signature)
      }
    }
  }

  public readonly stats = (): { localCount: number; routedCount: number } => {
    return {
      localCount: this.#localSignatures.size,
      routedCount: this.#routingTable.size,
    }
  }
}

const _computationRoutingService = new ComputationRoutingService()
;(window as any).ioc.register(
  '@diamondcoreprocessor.com/ComputationRoutingService',
  _computationRoutingService
)
