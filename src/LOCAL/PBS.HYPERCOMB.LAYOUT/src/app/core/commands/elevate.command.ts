// src/app/core/commands/elevate.command.ts

import { SafetyPolicy } from '../safety/safety-policy.service'
import { HypercombState } from '../hypercomb-state'
import { Command } from './command.model'

export class ElevateCommand implements Command {

  public name = 'elevate'

  constructor(
    private readonly safetyPolicy: SafetyPolicy,
    private readonly state: HypercombState
  ) {}

  public execute(args: string[]): void {
    const operationKey = args[0]
    const durationMs = Number(args[1] ?? 30000)

    if (!operationKey) {
      console.error('usage: elevate <operationKey> [durationMs]')
      return
    }

    const lineage = this.state.lineage()

    this.safetyPolicy.allowFor({
      lineage,
      operationKey,
      durationMs
    })

    console.info(
      `elevation granted: ${operationKey} for ${durationMs}ms`
    )
  }
}
