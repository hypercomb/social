// src/app/core/payload-canonical.ts
import { SignatureService } from '@hypercomb/core'

export type DraftPayloadV1 = {
  version: 1
  intent: any
  source: {
    entry: string
    files: Record<string, string>
  }
}

export class PayloadCanonical {

  public static createEmpty = (): DraftPayloadV1 => {
    return {
      version: 1,
      intent: {
        id: '',
        title: 'untitled module',
        summary: '',
        description: '',
        grammar: [],
        links: [],
        signature: ''
      },
      source: {
        entry: '',
        files: {}
      }
    }
  }

  // returns the canonical json (without intent.signature) and the signature of those exact bytes
  public static compute = async (payload: DraftPayloadV1): Promise<{ signature: string; canonicalJson: string }> => {
    const canonical = this.canonicalize(payload)
    const canonicalJson = JSON.stringify(canonical)

    const bytes = new TextEncoder().encode(canonicalJson)
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)

    const signature = await SignatureService.sign(buffer)

    return { signature, canonicalJson }
  }

  // legacy helper: returns a pretty json that includes intent.signature (signature is NOT part of the signed bytes)
  public static signPayload = async (payload: DraftPayloadV1): Promise<{ signature: string; json: string }> => {
    const { signature, canonicalJson } = await this.compute(payload)
    const parsed = JSON.parse(canonicalJson) as DraftPayloadV1
    parsed.intent.signature = signature
    return { signature, json: JSON.stringify(parsed, null, 2) }
  }

  private static canonicalize(payload: DraftPayloadV1): DraftPayloadV1 {
    const p: DraftPayloadV1 = JSON.parse(JSON.stringify(payload))

    if (p.intent) {
      p.intent.signature = ''
    }

    return p
  }
}
