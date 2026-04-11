// hypercomb-essentials/src/diamondcoreprocessor.com/computation/computation.drone.ts
import {
  Drone,
  ComputationReceiptCanonical
} from "@hypercomb/core";
var ComputationDrone = class _ComputationDrone extends Drone {
  namespace = "diamondcoreprocessor.com";
  genotype = "computation";
  description = "Processes computation requests, caches results, and shares receipts across the community mesh.";
  effects = ["network", "filesystem"];
  deps = {
    computationService: "@diamondcoreprocessor.com/ComputationService",
    routingService: "@diamondcoreprocessor.com/ComputationRoutingService"
  };
  listens = [
    "computation:request",
    "computation:receipt-received"
  ];
  emits = [
    "computation:fulfilled",
    "computation:verified",
    "computation:request"
  ];
  #initialized = false;
  #pendingRequests = [];
  #lastPruneAt = 0;
  static #PRUNE_INTERVAL_MS = 3e5;
  static #ROUTING_MAX_AGE_MS = 6e5;
  static #NOSTR_COMPUTATION_KIND = 29011;
  // -------------------------------------------------
  // sense / heartbeat
  // -------------------------------------------------
  sense = () => {
    return !this.#initialized || this.#pendingRequests.length > 0;
  };
  heartbeat = async (_grammar) => {
    if (!this.#initialized) {
      this.#initialized = true;
      this.#subscribeToEffects();
    }
    const batch = this.#pendingRequests.splice(0);
    for (const request of batch) {
      await this.#processRequest(request);
    }
    const now = Date.now();
    if (now - this.#lastPruneAt > _ComputationDrone.#PRUNE_INTERVAL_MS) {
      this.#lastPruneAt = now;
      const routing = this.resolve("routingService");
      routing?.prune(_ComputationDrone.#ROUTING_MAX_AGE_MS);
    }
  };
  // -------------------------------------------------
  // effect subscriptions
  // -------------------------------------------------
  #subscribeToEffects = () => {
    this.onEffect("computation:request", (request) => {
      if (!request?.inputSignature || !request?.functionSignature) return;
      this.#pendingRequests.push(request);
    });
    this.onEffect(
      "computation:receipt-received",
      async (payload) => {
        if (!payload?.receipt || !payload?.receiptSignature) return;
        await this.#handleIncomingReceipt(payload.receipt, payload.receiptSignature, payload.peerId);
      }
    );
  };
  // -------------------------------------------------
  // request processing
  // -------------------------------------------------
  #processRequest = async (request) => {
    const service = this.resolve("computationService");
    if (!service) return;
    const cached = await service.lookup(request.inputSignature, request.functionSignature);
    if (cached) {
      const { receiptSignature } = await ComputationReceiptCanonical.compute(cached);
      this.emitEffect("computation:fulfilled", {
        receipt: cached,
        receiptSignature,
        requestId: request.requestId
      });
      return;
    }
    const routing = this.resolve("routingService");
    const lookupKey = await service.computeLookupKey(
      request.inputSignature,
      request.functionSignature
    );
    const route = routing?.resolve(lookupKey);
    if (route?.source === "peer") {
      this.emitEffect("mesh:publish", {
        kind: _ComputationDrone.#NOSTR_COMPUTATION_KIND,
        sig: lookupKey,
        payload: {
          type: "request",
          inputSignature: request.inputSignature,
          functionSignature: request.functionSignature,
          requestId: request.requestId
        }
      });
      return;
    }
    this.emitEffect("mesh:publish", {
      kind: _ComputationDrone.#NOSTR_COMPUTATION_KIND,
      sig: lookupKey,
      payload: {
        type: "request",
        inputSignature: request.inputSignature,
        functionSignature: request.functionSignature,
        requestId: request.requestId
      }
    });
  };
  // -------------------------------------------------
  // incoming receipt handling
  // -------------------------------------------------
  #handleIncomingReceipt = async (receipt, receiptSignature, peerId) => {
    const valid = await ComputationReceiptCanonical.verify(receipt, receiptSignature);
    this.emitEffect("computation:verified", {
      receipt,
      receiptSignature,
      valid
    });
    if (!valid) return;
    const service = this.resolve("computationService");
    if (service) {
      await service.record(receipt);
    }
    const routing = this.resolve("routingService");
    if (routing && service) {
      const lookupKey = await service.computeLookupKey(
        receipt.inputSignature,
        receipt.functionSignature
      );
      routing.registerLocal(lookupKey);
      if (peerId) {
        routing.recordPeerSource(lookupKey, peerId);
      }
    }
    this.emitEffect("computation:fulfilled", {
      receipt,
      receiptSignature
    });
  };
};
var _computationDrone = new ComputationDrone();
window.ioc.register("@diamondcoreprocessor.com/ComputationDrone", _computationDrone);
export {
  ComputationDrone
};
