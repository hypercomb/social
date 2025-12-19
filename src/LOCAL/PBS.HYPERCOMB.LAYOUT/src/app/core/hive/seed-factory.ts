// src/app/core/hive/seed-factory.ts

import { Seed, Signature } from './i-dna.token'

export class SeedFactory {

  // seed is now a string identity
  public static create = (identity: string, _signature?: Signature): Seed => {
    // signature is resource-only, so seed factory just returns identity
    return identity
  }
}
