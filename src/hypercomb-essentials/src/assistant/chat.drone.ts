// assistant/chat.drone.ts
//
// THE CHAT IS A BEHAVIOUR (atomic-modules-plan.md, step 6). Its threads, the
// compaction that keeps them short and the execution queue a turn waits in
// are its dependencies; this bee is the one that registers them.
//
// publishService for the keys that used it: a bee can load before the dev
// shell installs its own `window.ioc` map, and publishService keeps offering
// until the map holds the key (llm-provider-registry.ts).

import { Drone } from '@hypercomb/core'
import { CHAT_THREADS_IOC_KEY, ChatThreads } from './chat-threads.js'
import { COMPACTION_IOC_KEY, compaction } from './compaction.js'
import { EXECUTION_QUEUE_IOC_KEY, executionQueue } from './execution-queue.js'
import { HARNESS_IOC_KEY, bootHarness, harness } from './harness.js'
import { publishService } from './llm-provider-registry.js'

export class ChatDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'

  public override description =
    'The chat: registers its threads, compaction and execution queue.'

  protected override sense = (): boolean => false
}

window.ioc.register(CHAT_THREADS_IOC_KEY, new ChatThreads())
publishService(COMPACTION_IOC_KEY, compaction)
publishService(EXECUTION_QUEUE_IOC_KEY, executionQueue)
// THE HARNESS (documentation/agent-harness.md): the loop's policy record,
// published here and seeded once the Store answers — the bee wires it.
publishService(HARNESS_IOC_KEY, harness)
window.ioc.whenReady?.('@hypercomb.social/Store', () => { bootHarness() })
bootHarness()

window.ioc.register('@diamondcoreprocessor.com/ChatDrone', new ChatDrone())
