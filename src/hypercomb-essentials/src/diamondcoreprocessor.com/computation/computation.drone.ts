// diamondcoreprocessor.com/computation/computation.drone.ts

import {
  Drone,
  type ComputationReceipt,
  ComputationReceiptCanonical,
} from '@hypercomb/core'

import type { ComputationService } from './computation.service.js'
import type { ComputationRoutingService } from './computation-routing.service.js'

type ComputationRequest = {
  inputSignature: string
  functionSignature: string
  requestId?: string
}

type ComputationFulfilled = {
  receipt: ComputationReceipt
  receiptSignature: string
  requestId?: string
}

type ComputationVerified = {
  receipt: ComputationReceipt
  receiptSignature: string
  valid: boolean
}

export class ComputationDrone extends Drone {

  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'computation'

  public override description =
    'Processes computation requests, caches results, and shares receipts across the community mesh.'

  public override effects = ['network', 'filesystem'] as const

  protected override deps = {
    computationService: '@diamondcoreprocessor.com/ComputationService',
    routingService: '@diamondcoreprocessor.com/ComputationRoutingService',
  }

  protected override listens = [
    'computation:request',
    'computation:receipt-received',
  ]

  protected override emits = [
    'computation:fulfilled',
    'computation:verified',
    'computation:request',
  ]

  #initialized = false
  #pendingRequests: ComputationRequest[] = []
  #lastPruneAt = 0

  static readonly #PRUNE_INTERVAL_MS = 300_000
  static readonly #ROUTING_MAX_AGE_MS = 600_000
  static readonly #NOSTR_COMPUTATION_KIND = 29011

  // -------------------------------------------------
  // sense / heartbeat
  // -------------------------------------------------

  protected override sense = (): boolean => {
    return !this.#initialized || this.#pendingRequests.length > 0
  }

  protected override heartbeat = async (_grammar: string): Promise<void> => {
    if (!this.#initialized) {
      this.#initialized = true
      this.#subscribeToEffects()
    }

    // process pending requests
    const batch = this.#pendingRequests.splice(0)
    for (const request of batch) {
      await this.#processRequest(request)
    }

    // periodic routing table maintenance
    const now = Date.now()
    if (now - this.#lastPruneAt > ComputationDrone.#PRUNE_INTERVAL_MS) {
      this.#lastPruneAt = now
      const routing = this.resolve<ComputationRoutingService>('routingService')
      routing?.prune(ComputationDrone.#ROUTING_MAX_AGE_MS)
    }
  }

  // -------------------------------------------------
  // effect subscriptions
  // -------------------------------------------------

  #subscribeToEffects = (): void => {
    this.onEffect<ComputationRequest>('computation:request', (request) => {
      if (!request?.inputSignature || !request?.functionSignature) return
      this.#pendingRequests.push(request)
    })

    this.onEffect<{ receipt: ComputationReceipt; receiptSignature: string; peerId?: string }>(
      'computation:receipt-received',
      async (payload) => {
        if (!payload?.receipt || !payload?.receiptSignature) return
        await this.#handleIncomingReceipt(payload.receipt, payload.receiptSignature, payload.peerId)
      }
    )
  }

  // -------------------------------------------------
  // request processing
  // -------------------------------------------------

  #processRequest = async (request: ComputationRequest): Promise<void> => {
    const service = this.resolve<ComputationService>('computationService')
    if (!service) return

    // 1. check local cache
    const cached = await service.lookup(request.inputSignature, request.functionSignature)
    if (cached) {
      const { receiptSignature } = await ComputationReceiptCanonical.compute(cached)
      this.emitEffect<ComputationFulfilled>('computation:fulfilled', {
        receipt: cached,
        receiptSignature,
        requestId: request.requestId,
      })
      return
    }

    // 2. check routing table for known peers
    const routing = this.resolve<ComputationRoutingService>('routingService')
    const lookupKey = await service.computeLookupKey(
      request.inputSignature,
      request.functionSignature
    )
    const route = routing?.resolve(lookupKey)

    if (route?.source === 'peer') {
      // broadcast request to known peers via mesh
      this.emitEffect('mesh:publish', {
        kind: ComputationDrone.#NOSTR_COMPUTATION_KIND,
        sig: lookupKey,
        payload: {
          type: 'request',
          inputSignature: request.inputSignature,
          functionSignature: request.functionSignature,
          requestId: request.requestId,
        },
      })
      return
    }

    // 3. no local or peer — broadcast to the wider network
    this.emitEffect('mesh:publish', {
      kind: ComputationDrone.#NOSTR_COMPUTATION_KIND,
      sig: lookupKey,
      payload: {
        type: 'request',
        inputSignature: request.inputSignature,
        functionSignature: request.functionSignature,
        requestId: request.requestId,
      },
    })
  }

  // -------------------------------------------------
  // incoming receipt handling
  // -------------------------------------------------

  #handleIncomingReceipt = async (
    receipt: ComputationReceipt,
    receiptSignature: string,
    peerId?: string
  ): Promise<void> => {
    // verify the receipt
    const valid = await ComputationReceiptCanonical.verify(receipt, receiptSignature)

    this.emitEffect<ComputationVerified>('computation:verified', {
      receipt,
      receiptSignature,
      valid,
    })

    if (!valid) return

    // store locally
    const service = this.resolve<ComputationService>('computationService')
    if (service) {
      await service.record(receipt)
    }

    // update routing table
    const routing = this.resolve<ComputationRoutingService>('routingService')
    if (routing && service) {
      const lookupKey = await service.computeLookupKey(
        receipt.inputSignature,
        receipt.functionSignature
      )
      routing.registerLocal(lookupKey)
      if (peerId) {
        routing.recordPeerSource(lookupKey, peerId)
      }
    }

    // emit fulfilled
    this.emitEffect<ComputationFulfilled>('computation:fulfilled', {
      receipt,
      receiptSignature,
    })
  }
}

const _computationDrone = new ComputationDrone()
;(window as any).ioc.register('@diamondcoreprocessor.com/ComputationDrone', _computationDrone)
