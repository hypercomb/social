    // src/app/core/capabilities/impl/has-selection.capability.ts

import { Capability } from '../capability.model'
import { DiamondCommit } from '../../diamond-core/diamond-core.model'

export class HasSelectionCapability implements Capability {

  public key = 'has.selection'

  public allows(commit: DiamondCommit): boolean {
    return !!commit.selection?.seeds?.length
  }
}
