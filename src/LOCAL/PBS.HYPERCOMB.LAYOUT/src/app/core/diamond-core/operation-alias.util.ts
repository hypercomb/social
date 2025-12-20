// src/app/core/diamond-core/operation-alias.util.ts

import { OPERATION_ALIASES } from '../operations/operation-alias.registry'

export function resolveOperationKey(key: string): string {
  return OPERATION_ALIASES[key] ?? key
}
