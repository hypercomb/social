// src/app/core/operations/operation.registry.ts

import { Operation } from './operation.model'
import { AddCellOperation } from './implementations/add-cell.operation'

export const OPERATIONS: Operation[] = [
  new AddCellOperation()
]
