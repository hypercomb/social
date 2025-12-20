// src/app/core/hive/seed-factory.ts

import { Injectable } from '@angular/core'
import { Seed } from './i-dna.token'

@Injectable({ providedIn: 'root' })
export class SeedFactory {

  // seed is a filesystem-safe identity for v1
  public static create = (identity: string): Seed => {
    return SeedFactory.toSeed(identity)
  }

  private static toSeed = (raw: string): Seed => {
    // keep it simple: trim, lowercase, collapse whitespace
    // remove characters that would break strand parsing or lineage rules
    const cleaned = raw
      .trim()
      .toLowerCase()
      .replaceAll('/', ' ')
      .replaceAll('-', ' ')
      .replace(/\s+/g, ' ')
      .trim()

    // convert to a compact slug so it stays stable in filenames
    // note: this preserves the "create <name>" = same seed identity behavior
    const slug = cleaned.replace(/\s+/g, '_')

    return slug
  }
}
