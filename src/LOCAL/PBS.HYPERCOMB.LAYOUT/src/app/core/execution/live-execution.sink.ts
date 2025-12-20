// src/app/core/execution/live-execution.sink.ts

import { Injectable } from '@angular/core'
import { ExecutionSink } from './execution-sink.model'
import { DiamondCommit } from '../diamond-core/diamond-core.model'

@Injectable({ providedIn: 'root' })
export class LiveExecutionSink implements ExecutionSink {

  public execute(commit: DiamondCommit): void {
    // persist to DNA / OPFS / server
    // this is the ONLY place real mutation occurs
  }
}
