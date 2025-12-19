// src/app/core/hive/seed-factory.ts

import { Injectable } from '@angular/core'
import { Seed, Signature } from './i-dna.token'

@Injectable({ providedIn: 'root' })
export class SeedFactory {

  // seed is now a string identity
  public static create = (identity: string, _signature?: Signature): Seed => {
    // signature is resource-only, so seed factory just returns identity
    return identity
  }
}
