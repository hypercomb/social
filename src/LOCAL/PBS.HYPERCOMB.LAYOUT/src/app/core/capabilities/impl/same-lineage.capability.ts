// src/app/core/capabilities/impl/same-lineage.capability.ts

import { Capability } from '../capability.model'
import { DiamondCommit } from '../../diamond-core/diamond-core.model'

export class SameLineageCapability implements Capability {

  public key = 'same.lineage'

  public allows(commit: DiamondCommit): boolean {
    return (
      !commit.selection ||
      commit.selection.lineage === commit.lineage
    )
  }
}
