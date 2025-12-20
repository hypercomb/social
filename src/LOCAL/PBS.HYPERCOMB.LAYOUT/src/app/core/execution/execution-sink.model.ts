// src/app/core/execution/execution-sink.model.ts

import { DiamondCommit } from '../diamond-core/diamond-core.model'

export interface ExecutionSink {
  execute(commit: DiamondCommit): void
}
