// miro.com/import/miro-token.queen.ts
//
// /miro-token — one-shot setup command.
//
// Syntax:
//   /miro-token                       — show token status
//   /miro-token <token>               — store token in localStorage
//   /miro-token clear                 — remove stored token
//
// The token lives only in this browser's localStorage (key: miro.importer.token).
// Each person paste their own — nothing crosses the network except API calls
// made by /miro-import using the stored value.

import { QueenBee, EffectBus } from '@hypercomb/core'
import type { MiroApiService } from './miro-api.service.js'

const ioc = (key: string) => (window as any).ioc?.get?.(key)

export class MiroTokenQueenBee extends QueenBee {
  readonly namespace = 'miro.com'
  readonly command = 'miro-token'
  override description = 'Store your Miro API token locally (localStorage, never sent anywhere)'

  protected execute(args: string): void {
    const api = ioc('@miro.com/MiroApiService') as MiroApiService | undefined
    if (!api) {
      this.#toast('miro api service not loaded')
      return
    }

    const trimmed = args.trim()

    if (!trimmed) {
      const existing = api.token
      this.#toast(existing
        ? `miro token set (${existing.length} chars). replace: /miro-token <new>. remove: /miro-token clear`
        : 'no miro token. paste yours: /miro-token <token>')
      return
    }

    if (trimmed.toLowerCase() === 'clear' || trimmed.toLowerCase() === 'remove') {
      api.setToken('')
      this.#toast('miro token cleared')
      return
    }

    api.setToken(trimmed)
    this.#toast('miro token stored')
  }

  #toast(message: string): void {
    EffectBus.emit('activity:log', { message, icon: '◈' })
  }
}

const _instance = new MiroTokenQueenBee()
;(window as any).ioc?.register?.('@miro.com/MiroTokenQueenBee', _instance)
