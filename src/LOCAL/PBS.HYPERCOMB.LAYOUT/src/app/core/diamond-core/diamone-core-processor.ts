// src/app/core/diamond-core/diamond-core.processor.ts

import { Injectable } from '@angular/core'
import { Seed } from '../hive/i-dna.token'
import { Intent } from '../intent/models/intent.model'


@Injectable({ providedIn: 'root' })
export class DiamondCoreProcessor {

  constructor(
    private readonly genome: GenomeStore,
    private readonly selection: SelectionService
  ) {}

  public processIntent = async (intent: Intent): Promise<void> => {
    const result = this.resolve(intent)

    if (result.type === 'resolved') {
      this.selection.select(result.seed)
      return
    }

    if (result.type === 'create') {
      const seed = this.createSeed(intent)
      this.selection.select(seed)
      return
    }
  }

  // ─────────────────────────────────────────────
  // internal
  // ─────────────────────────────────────────────

  private resolve = (intent: Intent): ResolutionResult => {
    const active = this.selection.activeSeed()

    // resolution cascade
    return (
      this.genome.resolveInScope(intent.text, active) ??
      this.genome.resolveInLocal(intent.text) ??
      this.genome.resolvePublic(intent.text) ??
      { type: 'create' }
    )
  }

  private createSeed = (intent: Intent): Seed => {
    const parent = this.selection.activeSeed()
    return this.genome.createSeed(intent.text, parent)
  }
}
