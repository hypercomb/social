// assistant/chat.drone.ts
//
// THE CHAT IS A BEHAVIOUR (atomic-modules-plan.md, step 6). Its threads, the
// compaction that keeps them short and the execution queue a turn waits in
// are its dependencies; this bee is the one that registers them.
//
// publishService for the keys that used it: a bee can load before the dev
// shell installs its own `window.ioc` map, and publishService keeps offering
// until the map holds the key (llm-provider-registry.ts).

import { Drone, EffectBus } from '@hypercomb/core'
import { CHAT_SURFACE, CHAT_VIEW_OWNER, angularChatPresent } from './chat-surface.js'
import { CHAT_THREADS_IOC_KEY, ChatThreads } from './chat-threads.js'
import { COMPACTION_IOC_KEY, compaction } from './compaction.js'
import { EXECUTION_QUEUE_IOC_KEY, executionQueue } from './execution-queue.js'
import { PERMIT_GROUPS_IOC_KEY, permitGroups } from './permit-groups.js'
import { HARNESS_IOC_KEY, bootHarness, harness } from './harness.js'
import { claimHarnessPool } from './harness-network.js'
import { startReceiptLedger } from './agent-receipts.js'
import { startHarnessTiles } from './harness-tiles.js'
import { startModelRequestLedger } from './model-requests.js'
import { AGENT_STEPS_IOC_KEY, agentSteps, shippedAgentSteps } from './agent-steps.js'
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
// PERMISSION GROUPS (documentation/permission-groups.md): what the queue runs
// on arrival, per conversation, provider or model — the `permit` word's store.
publishService(PERMIT_GROUPS_IOC_KEY, permitGroups)
// THE HARNESS (documentation/agent-harness.md): the loop's policy record,
// published here and seeded once the Store answers — the bee wires it.
publishService(HARNESS_IOC_KEY, harness)
// THE STEPS, by word: the shipped fold, handover and receipt, and any bee
// that registered its own beside them under its signature.
for (const step of shippedAgentSteps()) agentSteps.register(step)
publishService(AGENT_STEPS_IOC_KEY, agentSteps)
window.ioc.whenReady?.('@hypercomb.social/Store', () => { bootHarness() })
bootHarness()
// A domain the participant learns may offer harnesses beside its providers;
// they arrive as offers and are placed by the participant's word.
claimHarnessPool()
// Every turn's receipt is filed under the harness it ran under — the eval.
startReceiptLedger()
// A note that is a harness record is read as one when it is edited: the
// tile `harness edit` opens is saved by editing it.
startHarnessTiles()
// Work that asked for a stronger model than any switched on is filed, so
// the participant can answer it with `models add <id> deep`.
startModelRequestLedger()

window.ioc.register('@diamondcoreprocessor.com/ChatDrone', new ChatDrone())

// THE CHAT'S OWN WINDOW (chat-surface.ts): the bee adds its tag to the
// shell's surface registry — never a tag in a template — and the element
// arrives with the first request for it, on a page where the Angular window
// is not the chat. There the Angular window answers, and nothing loads.
window.ioc.whenReady?.('@hypercomb.social/ShellSurfaceRegistry', (registry: { add(s: unknown): void }) => {
  try {
    registry.add({ name: CHAT_SURFACE, owner: CHAT_VIEW_OWNER, element: CHAT_SURFACE, order: 150 })
  } catch {
    // duplicate add (hot reload) — the mounted surface is already live
  }
})

let chatView: Promise<void> | null = null
let listening = false
const loadChatView = (payload: { prefill?: string; convoId?: string; model?: string } | null): void => {
  // A replayed request is an old gesture; once the element is defined it
  // hears every request itself. `null` defines it with no request to take.
  if ((payload && !listening) || customElements.get(CHAT_SURFACE) || angularChatPresent()) return
  chatView ??= import('./chat.view.js').then(({ ChatElement }) => {
    if (payload) ChatElement.pending = payload
    if (!customElements.get(CHAT_SURFACE)) customElements.define(CHAT_SURFACE, ChatElement)
  }).catch((error: unknown) => {
    chatView = null
    EffectBus.emit('activity:log', { message: `Could not load the chat: ${error instanceof Error ? error.message : String(error)}` })
  })
}
EffectBus.on<{ prefill?: string; convoId?: string; model?: string }>('chat:open', payload => loadChatView(payload ?? {}))
EffectBus.on('chat:toggle', () => loadChatView({}))
listening = true

// ON A PAGE WITH NO ANGULAR CHAT the element is the only way in, and it
// carries its own Chat button — so it is defined now rather than on a first
// request nobody on that page has a way to make (jwize, 2026-11-11: "let's
// just get it working on desktop first"). Asked here, below `loadChatView`:
// `whenReady` answers at once when the registry is already up, and a call
// from above the declaration threw and was swallowed.
window.ioc.whenReady?.('@hypercomb.social/ShellSurfaceRegistry', () => {
  if (!angularChatPresent()) loadChatView(null)
})
