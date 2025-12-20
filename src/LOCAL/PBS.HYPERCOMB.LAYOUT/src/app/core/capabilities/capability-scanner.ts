// src/app/core/capabilities/capability-scanner.ts

import { Injectable } from '@angular/core'
import { Capability } from './capability.model'
import { CommitDraft } from '../diamond-core/commit-draft.model'

@Injectable({ providedIn: 'root' })
export class CapabilityScanner {

  private readonly capabilities: Capability[] = []

  public register(capability: Capability): void {
    this.capabilities.push(capability)
  }

  public scan(draft: CommitDraft): Capability[] {
    return this.capabilities.filter(cap => cap.allows(draft))
  }

  public missing(draft: CommitDraft): Capability[] {
    return this.capabilities.filter(cap => !cap.allows(draft))
  }
}
