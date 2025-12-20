// src/app/core/diamond-core/diamond-core.utils.ts

import { DiamondCommit } from "./diamond-core.model";

export function hasOperation(
  commit: DiamondCommit
): commit is DiamondCommit & { intent: { dominantIntent: string } } {
  return typeof commit.intent.dominantIntent === 'string'
}
