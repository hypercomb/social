// src/app/core/execution/sandbox-execution.sink.ts

import { ExecutionSink } from './execution-sink.model'
import { DiamondCommit } from '../diamond-core/diamond-core.model'

export class SandboxExecutionSink implements ExecutionSink {
  execute(commit: DiamondCommit): void {
    // simulate only
    console.info('sandbox execution', commit)
  }
}
