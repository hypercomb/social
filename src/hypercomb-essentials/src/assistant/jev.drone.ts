// assistant/jev.drone.ts
//
// JEV IS A BEHAVIOUR (atomic-modules-plan.md, step 6). The decision service,
// the outcomes it learns from and the replay that re-asks old decisions are
// its dependencies; this bee is the one that registers them. The outcome and
// replay listeners stay in their own files — importing them attaches them.

import { Drone } from '@hypercomb/core'
import { JEV_IOC_KEY } from './jev-decision.js'
import { jevDecision } from './jev-decision.service.js'
import { JEV_OUTCOMES_IOC_KEY, jevOutcomes } from './jev-outcomes.js'
import { replayJevDecisions } from './jev-replay.js'
import { publishService } from './llm-provider-registry.js'

export class JevDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'

  public override description =
    'Jev: registers the decision service, its outcomes and its replay.'

  protected override sense = (): boolean => false
}

publishService(JEV_IOC_KEY, jevDecision)
window.ioc.register(JEV_OUTCOMES_IOC_KEY, jevOutcomes)
window.ioc.register('@diamondcoreprocessor.com/JevReplay', { replay: replayJevDecisions })

window.ioc.register('@diamondcoreprocessor.com/JevDrone', new JevDrone())
