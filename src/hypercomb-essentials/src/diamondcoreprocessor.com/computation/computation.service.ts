// diamondcoreprocessor.com/computation/computation.service.ts

import {
  type Signature,
  type ComputationReceipt,
  ComputationReceiptCanonical,
  SignatureService,
  SignatureStore,
  get,
} from '@hypercomb/core'

export const CHAIN_REFERENCE_FUNCTION_SIGNATURE = 'chain-reference'

export class ComputationService {

  #indexCache = new Map<string, ComputationReceipt>()

  // -------------------------------------------------
  // computation root directory
  // -------------------------------------------------

  private get computationRoot(): FileSystemDirectoryHandle {
    const store = get<{ computation: FileSystemDirectoryHandle }>('@hypercomb.social/Store')
    return store!.computation
  }

  #getBag = async (lookupKey: string): Promise<FileSystemDirectoryHandle> => {
    return await this.computationRoot.getDirectoryHandle(lookupKey, { create: true })
  }

  // -------------------------------------------------
  // lookup key derivation
  // -------------------------------------------------

  public readonly computeLookupKey = async (
    inputSignature: Signature,
    functionSignature: Signature
  ): Promise<Signature> => {
    const key = inputSignature + '/' + functionSignature
    const sigStore = get<SignatureStore>('@hypercomb/SignatureStore')
    return sigStore
      ? await sigStore.signText(key)
      : await SignatureService.sign(
          new TextEncoder().encode(key).buffer as ArrayBuffer
        )
  }

  // -------------------------------------------------
  // record
  // -------------------------------------------------

  public readonly record = async (
    receipt: ComputationReceipt
  ): Promise<Signature> => {
    const lookupKey = await this.computeLookupKey(
      receipt.inputSignature,
      receipt.functionSignature
    )

    const bag = await this.#getBag(lookupKey)
    const nextIndex = await this.#nextIndex(bag)
    const fileName = String(nextIndex).padStart(8, '0')

    const { receiptSignature, canonicalJson } =
      await ComputationReceiptCanonical.compute(receipt)

    const fileHandle = await bag.getFileHandle(fileName, { create: true })
    const writable = await fileHandle.createWritable()
    try {
      await writable.write(canonicalJson)
    } finally {
      await writable.close()
    }

    this.#indexCache.set(lookupKey, receipt)
    return receiptSignature
  }

  // -------------------------------------------------
  // lookup
  // -------------------------------------------------

  public readonly lookup = async (
    inputSignature: Signature,
    functionSignature: Signature
  ): Promise<ComputationReceipt | null> => {
    const lookupKey = await this.computeLookupKey(inputSignature, functionSignature)

    // hot cache
    const cached = this.#indexCache.get(lookupKey)
    if (cached) return cached

    // cold path: read latest from OPFS
    const root = this.computationRoot
    let bag: FileSystemDirectoryHandle
    try {
      bag = await root.getDirectoryHandle(lookupKey, { create: false })
    } catch {
      return null
    }

    let maxName = ''
    let maxHandle: FileSystemFileHandle | null = null

    for await (const [name, handle] of bag.entries()) {
      if (handle.kind !== 'file') continue
      if (name > maxName) {
        maxName = name
        maxHandle = handle as FileSystemFileHandle
      }
    }

    if (!maxHandle) return null

    try {
      const file = await maxHandle.getFile()
      const text = await file.text()
      const receipt = JSON.parse(text) as ComputationReceipt
      this.#indexCache.set(lookupKey, receipt)
      return receipt
    } catch {
      return null
    }
  }

  // -------------------------------------------------
  // verify
  // -------------------------------------------------

  public readonly verify = async (
    receipt: ComputationReceipt,
    expectedReceiptSignature: Signature
  ): Promise<boolean> => {
    return ComputationReceiptCanonical.verify(receipt, expectedReceiptSignature)
  }

  // -------------------------------------------------
  // replay
  // -------------------------------------------------

  public readonly replay = async (lookupKey: string): Promise<ComputationReceipt[]> => {
    const root = this.computationRoot

    let bag: FileSystemDirectoryHandle
    try {
      bag = await root.getDirectoryHandle(lookupKey, { create: false })
    } catch {
      return []
    }

    const entries: { name: string; handle: FileSystemFileHandle }[] = []
    for await (const [name, handle] of bag.entries()) {
      if (handle.kind !== 'file') continue
      entries.push({ name, handle: handle as FileSystemFileHandle })
    }

    entries.sort((a, b) => a.name.localeCompare(b.name))

    const receipts: ComputationReceipt[] = []
    for (const entry of entries) {
      const index = parseInt(entry.name, 10)
      if (isNaN(index)) continue

      try {
        const file = await entry.handle.getFile()
        const text = await file.text()
        receipts.push(JSON.parse(text) as ComputationReceipt)
      } catch {
        // skip corrupted entries
      }
    }

    return receipts
  }

  // -------------------------------------------------
  // list
  // -------------------------------------------------

  public readonly list = async (): Promise<{ lookupKey: string; count: number }[]> => {
    const root = this.computationRoot
    const result: { lookupKey: string; count: number }[] = []

    for await (const [name, handle] of root.entries()) {
      if (handle.kind !== 'directory') continue

      let count = 0
      for await (const [, child] of (handle as FileSystemDirectoryHandle).entries()) {
        if (child.kind === 'file') count++
      }

      result.push({ lookupKey: name, count })
    }

    return result
  }

  // -------------------------------------------------
  // chain scaling
  // -------------------------------------------------

  public readonly signChainSegment = async (lookupKey: string): Promise<Signature> => {
    const receipts = await this.replay(lookupKey)
    const canonicalArray = JSON.stringify(receipts)
    const bytes = new TextEncoder().encode(canonicalArray)
    const buffer = new ArrayBuffer(bytes.byteLength)
    new Uint8Array(buffer).set(bytes)
    return SignatureService.sign(buffer)
  }

  public readonly recordChainReference = async (
    parentLookupKey: string,
    childChainSignature: Signature
  ): Promise<Signature> => {
    const chainFunctionSignature = await this.#chainReferenceFunctionSignature()

    const receipt: ComputationReceipt = {
      inputSignature: parentLookupKey,
      functionSignature: chainFunctionSignature,
      outputSignature: childChainSignature,
      timestamp: Date.now(),
    }

    return this.record(receipt)
  }

  #chainReferenceFunctionSignatureCache: Signature | null = null

  #chainReferenceFunctionSignature = async (): Promise<Signature> => {
    if (this.#chainReferenceFunctionSignatureCache) {
      return this.#chainReferenceFunctionSignatureCache
    }
    const bytes = new TextEncoder().encode(CHAIN_REFERENCE_FUNCTION_SIGNATURE)
    const buffer = new ArrayBuffer(bytes.byteLength)
    new Uint8Array(buffer).set(bytes)
    this.#chainReferenceFunctionSignatureCache = await SignatureService.sign(buffer)
    return this.#chainReferenceFunctionSignatureCache
  }

  // -------------------------------------------------
  // internal
  // -------------------------------------------------

  #nextIndex = async (bag: FileSystemDirectoryHandle): Promise<number> => {
    let max = 0
    for await (const [name, handle] of bag.entries()) {
      if (handle.kind !== 'file') continue
      const n = parseInt(name, 10)
      if (!isNaN(n) && n > max) max = n
    }
    return max + 1
  }
}

const _computationService = new ComputationService()
;(window as any).ioc.register('@diamondcoreprocessor.com/ComputationService', _computationService)
