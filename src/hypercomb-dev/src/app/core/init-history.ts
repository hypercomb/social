// src/app/core/init-history.ts

import { Injectable, signal } from '@angular/core'

export type InitHistoryStep = {
  phase: 'boot' | 'runtime'
  at: number
  segments: readonly string[]
  seed: string
  markers: readonly string[]
  ok: boolean
  error?: string
}

@Injectable({ providedIn: 'root' })
export class InitHistory {

  public readonly steps = signal<readonly InitHistoryStep[]>([])

  public readonly clear = (): void => {
    this.steps.set([])
  }

  public readonly add = (step: InitHistoryStep): void => {
    this.steps.update(v => [...v, step])
  }
}

register('@hypercomb.social/InitHistory', new InitHistory(), 'InitHistory')
