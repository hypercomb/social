// hypercomb-core/src/core/computation-receipt.ts

import { type Signature, SignatureService } from './signature.service.js'

export type ComputationReceipt = {
  inputSignature: Signature
  functionSignature: Signature
  outputSignature: Signature
  timestamp: number
}

export class ComputationReceiptCanonical {

  public static compute = async (
    receipt: ComputationReceipt
  ): Promise<{ receiptSignature: Signature; canonicalJson: string }> => {

    const canonical: ComputationReceipt = {
      inputSignature: receipt.inputSignature,
      functionSignature: receipt.functionSignature,
      outputSignature: receipt.outputSignature,
      timestamp: receipt.timestamp,
    }

    const canonicalJson = JSON.stringify(canonical)
    const bytes = new TextEncoder().encode(canonicalJson)

    // force real ArrayBuffer (never SharedArrayBuffer)
    const buffer = new ArrayBuffer(bytes.byteLength)
    new Uint8Array(buffer).set(bytes)

    const receiptSignature = await SignatureService.sign(buffer)
    return { receiptSignature, canonicalJson }
  }

  public static verify = async (
    receipt: ComputationReceipt,
    expectedSignature: Signature
  ): Promise<boolean> => {
    const { receiptSignature } = await ComputationReceiptCanonical.compute(receipt)
    return receiptSignature === expectedSignature
  }
}
