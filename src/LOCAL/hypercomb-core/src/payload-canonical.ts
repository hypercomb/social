import { effect } from '@angular/core';
// src/payload-canonical.ts
import { SignatureService } from './core/signature.service.js'
import { GrammarHint } from './grammar-hint.js'
import { ProviderLink } from './provider-link.js'
import { Effect } from './effect.js';

export type ActionPayloadV1 = {
  version: 1
  action: {
    name: string
    description?: string
    grammar?: GrammarHint[]
    links?: ProviderLink[],
    effect?: Effect[]
  }
  source: {
    entry: string
    files: Record<string, string>
  }
}

export class PayloadCanonical {

  public static createEmpty = (): ActionPayloadV1 => ({
    version: 1,
    action: {
      name: '',
      description: '',
      grammar: [],
      links: []
    },
    source: {
      entry: '',
      files: {}
    }
  })

  public static compute = async (
    payload: ActionPayloadV1
  ): Promise<{ signature: string; canonicalJson: string }> => {

    const canonical = structuredClone(payload)
    const canonicalJson = JSON.stringify(canonical)

    const bytes = new TextEncoder().encode(canonicalJson)

    // force real ArrayBuffer (never SharedArrayBuffer)
    const buffer = new ArrayBuffer(bytes.byteLength)
    new Uint8Array(buffer).set(bytes)

    const signature = await SignatureService.sign(buffer)
    return { signature, canonicalJson }
  }

  public static signPayload = async (
    payload: ActionPayloadV1
  ): Promise<{ signature: string; json: string }> => {

    const { signature, canonicalJson } = await this.compute(payload)
    const parsed = JSON.parse(canonicalJson)

    return {
      signature,
      json: JSON.stringify(
        { signature, payload: parsed },
        null,
        2
      )
    }
  }
}
