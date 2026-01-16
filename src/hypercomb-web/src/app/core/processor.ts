import { Injectable, inject } from '@angular/core'
import { Store } from './store'
import { Lineage } from './lineage'

export type ExecutionPlan = {
  signatures: string[]
}

export type SeedIntent = {
  seed: string
}

@Injectable({ providedIn: 'root' })
export class Processor {

  private readonly store = inject(Store)
  private readonly lineage = inject(Lineage)

  public resolve = async (
    grammar: string
  ): Promise<ExecutionPlan | SeedIntent> => {

    const clean = grammar.replace(/[\\?:\s]+/g, ' ').trim()
    if (!clean) return { seed: '' }

    const markersByDepth = await this.lineage.markersByDepth()

    const resolved: string[] = []

    for (const depth of markersByDepth) {
      for (const sig of depth) {
        if (this.store.has(sig)) resolved.push(sig)
      }
    }

    if (!resolved.length) {
      return { seed: clean }
    }

    return { signatures: resolved }
  }

  public apply = async (plan: ExecutionPlan): Promise<void> => {
    for (const sig of plan.signatures) {
      const bytes = this.store.get(sig)
      if (!bytes) continue

      // execution happens here
      // processor never guesses, only executes resolved plan
    }
  }
}
