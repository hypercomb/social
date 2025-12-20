    // src/app/core/operations/batch-operation.model.ts

import { Operation } from './operation.model'

export interface BatchOperation extends Operation {
  batch: true
}
