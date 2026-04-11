// hypercomb-shared/core/install-monitor.ts
//
// Tiny pub-sub for the background install/sync state.
// Listens on EffectBus 'install:state' events and exposes a reactive state
// for UI components (e.g. the controls-bar status indicator).

import { EffectBus } from '@hypercomb/core'

export type InstallState = 'idle' | 'checking' | 'syncing' | 'complete' | 'error'

export type InstallStatePayload = {
  state: InstallState
  changedFiles?: number
  error?: string
}

export class InstallMonitor extends EventTarget {

  #state: InstallState = 'idle'
  #changedFiles = 0
  #error: string | null = null

  constructor() {
    super()
    EffectBus.on<InstallStatePayload>('install:state', payload => {
      this.#state = payload.state
      this.#changedFiles = payload.changedFiles ?? 0
      this.#error = payload.error ?? null
      this.dispatchEvent(new CustomEvent('change'))

      // 'complete' is transient — fade back to 'idle' after a short delay
      // so the indicator does not stay lit forever.
      if (payload.state === 'complete') {
        setTimeout(() => {
          if (this.#state !== 'complete') return
          this.#state = 'idle'
          this.dispatchEvent(new CustomEvent('change'))
        }, 4000)
      }
    })
  }

  get state(): InstallState {
    return this.#state
  }

  get changedFiles(): number {
    return this.#changedFiles
  }

  get error(): string | null {
    return this.#error
  }
}

register('@hypercomb.social/InstallMonitor', new InstallMonitor())
