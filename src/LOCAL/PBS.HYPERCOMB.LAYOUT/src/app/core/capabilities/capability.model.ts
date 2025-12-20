// src/app/core/capabilities/capability.model.ts

import { CommitDraft } from '../diamond-core/commit-draft.model'

export interface Capability {
  key: string
  allows(draft: CommitDraft): boolean
}
