// diamondcoreprocessor.com/core/communication/mesh-adapter.drone.ts
import { Drone, type Effect } from '@hypercomb/core'

type NostrRelay = string

interface MeshAdapterConfig {
  relays: NostrRelay[]
}

export class MeshAdapterDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'

  public override description =
    'Posts a Hypercomb signature to the Nostr mesh'

  public override grammar = [
    { example: 'share' },
    { example: 'publish' },
    { example: 'broadcast' }

  ]

  // optional future use (auditable intent)
  public override effects = ['network' as Effect]

  // default relays (can be overridden later)
  private readonly config: MeshAdapterConfig = {
    relays: [
      'wss://relay.damus.io',
      'wss://nostr.wine',
      'wss://relay.snort.social'
    ]
  }

  // -------------------------------------------------
  // execution
  // -------------------------------------------------

  public override heartbeat = async (grammar: any): Promise<void> => {
    const signature = grammar?.signature

    if (!signature || typeof signature !== 'string') {
      console.warn('[mesh-adapter] no signature provided')
      return
    }

    await this.publishSignature(signature)
  }

  // -------------------------------------------------
  // nostr publish
  // -------------------------------------------------

  private readonly publishSignature = async (signature: string): Promise<void> => {
    const event = this.createEvent(signature)

    for (const relay of this.config.relays) {
      try {
        await this.sendToRelay(relay, event)
      } catch (err) {
        console.warn('[mesh-adapter] relay failed', relay, err)
      }
    }
  }

  private readonly createEvent = (signature: string) => {
    return {
      kind: 1, // text note
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ['hypercomb', 'signature']
      ],
      content: signature
    }
  }

  private readonly sendToRelay = async (
    relayUrl: string,
    event: any
  ): Promise<void> => {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(relayUrl)

      ws.onopen = () => {
        ws.send(JSON.stringify(['EVENT', event]))
        ws.close()
        resolve()
      }

      ws.onerror = err => {
        ws.close()
        reject(err)
      }
    })
  }
}

const _meshAdapter = new MeshAdapterDrone()
window.ioc.register('@diamondcoreprocessor.com/MeshAdapterDrone', _meshAdapter)
