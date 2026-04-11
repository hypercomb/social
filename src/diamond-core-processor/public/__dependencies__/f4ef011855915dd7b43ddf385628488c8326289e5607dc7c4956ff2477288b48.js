// @diamondcoreprocessor.com/computation
// hypercomb-essentials/src/diamondcoreprocessor.com/computation/computation-routing.service.ts
var ComputationRoutingService = class {
  #localSignatures = /* @__PURE__ */ new Set();
  #routingTable = /* @__PURE__ */ new Map();
  #lastSeen = /* @__PURE__ */ new Map();
  // -------------------------------------------------
  // local registration
  // -------------------------------------------------
  registerLocal = (signature) => {
    this.#localSignatures.add(signature);
  };
  hasLocal = (signature) => {
    return this.#localSignatures.has(signature);
  };
  // -------------------------------------------------
  // peer routing
  // -------------------------------------------------
  recordPeerSource = (signature, peerId) => {
    let peers = this.#routingTable.get(signature);
    if (!peers) {
      peers = /* @__PURE__ */ new Set();
      this.#routingTable.set(signature, peers);
    }
    peers.add(peerId);
    this.#lastSeen.set(signature, Date.now());
  };
  // -------------------------------------------------
  // resolve
  // -------------------------------------------------
  resolve = (signature) => {
    if (this.#localSignatures.has(signature)) {
      return { source: "local" };
    }
    const peers = this.#routingTable.get(signature);
    if (peers && peers.size > 0) {
      return { source: "peer", peers: Array.from(peers) };
    }
    return null;
  };
  // -------------------------------------------------
  // maintenance
  // -------------------------------------------------
  prune = (maxAgeMs) => {
    const cutoff = Date.now() - maxAgeMs;
    for (const [signature, lastSeen] of this.#lastSeen) {
      if (lastSeen < cutoff) {
        this.#routingTable.delete(signature);
        this.#lastSeen.delete(signature);
      }
    }
  };
  stats = () => {
    return {
      localCount: this.#localSignatures.size,
      routedCount: this.#routingTable.size
    };
  };
};
var _computationRoutingService = new ComputationRoutingService();
window.ioc.register(
  "@diamondcoreprocessor.com/ComputationRoutingService",
  _computationRoutingService
);

// hypercomb-essentials/src/diamondcoreprocessor.com/computation/computation.service.ts
import {
  ComputationReceiptCanonical,
  SignatureService,
  get
} from "@hypercomb/core";
var CHAIN_REFERENCE_FUNCTION_SIGNATURE = "chain-reference";
var ComputationService = class {
  #indexCache = /* @__PURE__ */ new Map();
  // -------------------------------------------------
  // computation root directory
  // -------------------------------------------------
  get computationRoot() {
    const store = get("@hypercomb.social/Store");
    return store.computation;
  }
  #getBag = async (lookupKey) => {
    return await this.computationRoot.getDirectoryHandle(lookupKey, { create: true });
  };
  // -------------------------------------------------
  // lookup key derivation
  // -------------------------------------------------
  computeLookupKey = async (inputSignature, functionSignature) => {
    const key = inputSignature + "/" + functionSignature;
    const sigStore = get("@hypercomb/SignatureStore");
    return sigStore ? await sigStore.signText(key) : await SignatureService.sign(
      new TextEncoder().encode(key).buffer
    );
  };
  // -------------------------------------------------
  // record
  // -------------------------------------------------
  record = async (receipt) => {
    const lookupKey = await this.computeLookupKey(
      receipt.inputSignature,
      receipt.functionSignature
    );
    const bag = await this.#getBag(lookupKey);
    const nextIndex = await this.#nextIndex(bag);
    const fileName = String(nextIndex).padStart(8, "0");
    const { receiptSignature, canonicalJson } = await ComputationReceiptCanonical.compute(receipt);
    const fileHandle = await bag.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    try {
      await writable.write(canonicalJson);
    } finally {
      await writable.close();
    }
    this.#indexCache.set(lookupKey, receipt);
    return receiptSignature;
  };
  // -------------------------------------------------
  // lookup
  // -------------------------------------------------
  lookup = async (inputSignature, functionSignature) => {
    const lookupKey = await this.computeLookupKey(inputSignature, functionSignature);
    const cached = this.#indexCache.get(lookupKey);
    if (cached) return cached;
    const root = this.computationRoot;
    let bag;
    try {
      bag = await root.getDirectoryHandle(lookupKey, { create: false });
    } catch {
      return null;
    }
    let maxName = "";
    let maxHandle = null;
    for await (const [name, handle] of bag.entries()) {
      if (handle.kind !== "file") continue;
      if (name > maxName) {
        maxName = name;
        maxHandle = handle;
      }
    }
    if (!maxHandle) return null;
    try {
      const file = await maxHandle.getFile();
      const text = await file.text();
      const receipt = JSON.parse(text);
      this.#indexCache.set(lookupKey, receipt);
      return receipt;
    } catch {
      return null;
    }
  };
  // -------------------------------------------------
  // verify
  // -------------------------------------------------
  verify = async (receipt, expectedReceiptSignature) => {
    return ComputationReceiptCanonical.verify(receipt, expectedReceiptSignature);
  };
  // -------------------------------------------------
  // replay
  // -------------------------------------------------
  replay = async (lookupKey) => {
    const root = this.computationRoot;
    let bag;
    try {
      bag = await root.getDirectoryHandle(lookupKey, { create: false });
    } catch {
      return [];
    }
    const entries = [];
    for await (const [name, handle] of bag.entries()) {
      if (handle.kind !== "file") continue;
      entries.push({ name, handle });
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    const receipts = [];
    for (const entry of entries) {
      const index = parseInt(entry.name, 10);
      if (isNaN(index)) continue;
      try {
        const file = await entry.handle.getFile();
        const text = await file.text();
        receipts.push(JSON.parse(text));
      } catch {
      }
    }
    return receipts;
  };
  // -------------------------------------------------
  // list
  // -------------------------------------------------
  list = async () => {
    const root = this.computationRoot;
    const result = [];
    for await (const [name, handle] of root.entries()) {
      if (handle.kind !== "directory") continue;
      let count = 0;
      for await (const [, child] of handle.entries()) {
        if (child.kind === "file") count++;
      }
      result.push({ lookupKey: name, count });
    }
    return result;
  };
  // -------------------------------------------------
  // chain scaling
  // -------------------------------------------------
  signChainSegment = async (lookupKey) => {
    const receipts = await this.replay(lookupKey);
    const canonicalArray = JSON.stringify(receipts);
    const bytes = new TextEncoder().encode(canonicalArray);
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    return SignatureService.sign(buffer);
  };
  recordChainReference = async (parentLookupKey, childChainSignature) => {
    const chainFunctionSignature = await this.#chainReferenceFunctionSignature();
    const receipt = {
      inputSignature: parentLookupKey,
      functionSignature: chainFunctionSignature,
      outputSignature: childChainSignature,
      timestamp: Date.now()
    };
    return this.record(receipt);
  };
  #chainReferenceFunctionSignatureCache = null;
  #chainReferenceFunctionSignature = async () => {
    if (this.#chainReferenceFunctionSignatureCache) {
      return this.#chainReferenceFunctionSignatureCache;
    }
    const bytes = new TextEncoder().encode(CHAIN_REFERENCE_FUNCTION_SIGNATURE);
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    this.#chainReferenceFunctionSignatureCache = await SignatureService.sign(buffer);
    return this.#chainReferenceFunctionSignatureCache;
  };
  // -------------------------------------------------
  // internal
  // -------------------------------------------------
  #nextIndex = async (bag) => {
    let max = 0;
    for await (const [name, handle] of bag.entries()) {
      if (handle.kind !== "file") continue;
      const n = parseInt(name, 10);
      if (!isNaN(n) && n > max) max = n;
    }
    return max + 1;
  };
};
var _computationService = new ComputationService();
window.ioc.register("@diamondcoreprocessor.com/ComputationService", _computationService);
export {
  CHAIN_REFERENCE_FUNCTION_SIGNATURE,
  ComputationRoutingService,
  ComputationService
};
