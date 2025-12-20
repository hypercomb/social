// src/app/core/commands/revoke-elevation.command.ts

import { SafetyPolicy } from '../safety/safety-policy.service'
import { HypercombState } from '../hypercomb-state'
import { Command } from './command.model'

export class RevokeElevationCommand implements Command {

  public name = 'revoke'

  constructor(
    private readonly safetyPolicy: SafetyPolicy,
    private readonly state: HypercombState
  ) {}

  public execute(args: string[]): void {
    const lineage = this.state.lineage()
    const operationKey = args[0]

    this.safetyPolicy.revoke({ lineage, operationKey })

    console.info(
      operationKey
        ? `elevation revoked: ${operationKey}`
        : `all elevation revoked for lineage`
    )
  }
}
