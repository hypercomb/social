// diamondcoreprocessor.com/assistant/llm.queen.ts
//
// /opus, /sonnet, /haiku — ask a live Claude Code (over the bridge) about the
// selected tiles, and get the answer back IN THE HIVE. No API key, no direct
// Anthropic call: the command writes an `ask` record into the participant-local
// optimization inbox (`__optimization__/`, kind:'ask'). A Claude Code instance
// the participant is running (bridge-connected) drains the inbox
// (`optimization-list kind:'ask'`), reads the tiles for context, and writes the
// answer back onto the tile (`note-add`) — which the hive renders live. The
// model name is carried as a hint for the responder.
//
// This replaces the old direct-Anthropic path (which needed a pasted key,
// dropped its response because nothing consumed `llm:response`, and only sent
// tile names as context). The ask record IS the request; the Claude bridge loop
// IS the response — a live service the user triggers from the hive.

import { QueenBee, EffectBus } from '@hypercomb/core'
import type { SlashBehaviour, SlashBehaviourProvider } from '../commands/slash-behaviour.provider.js'

type StoreLike = { putOptimization?: (blob: Blob) => Promise<string> }
type SelectionLike = { selected: ReadonlySet<string> }
type LineageLike = { explorerSegments?: () => readonly string[] }

/** Optimization kind for a user→Claude ask. The bridge ask-loop lists this. */
const ASK_KIND = 'ask'

export class LlmQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'assistant'
  readonly command = 'opus'
  override readonly aliases = []
  override description = 'Ask a live Claude Code (via the bridge) about the selected tiles'
  override options = ['<question>']
  override examples = [
    { input: '/opus what links these tiles?', result: 'Queues the ask; answer lands as a tile note' },
  ]

  /** LlmProvider declares opus/sonnet/haiku manually — skip auto-wrap to avoid a duplicate /opus */
  readonly slashSkipAutoWrap = true

  /** Set by the provider before invoke() — carried into the ask as a model hint. */
  activeModel = 'opus'

  protected async execute(args: string): Promise<void> {
    const prompt = args.trim()
    if (!prompt) {
      console.warn('[ask] empty question — usage: [tiles]/opus your question here')
      return
    }

    const selection = get<SelectionLike>('@diamondcoreprocessor.com/SelectionService')
    const targets = selection ? Array.from(selection.selected) : []

    const lineage = get<LineageLike>('@hypercomb.social/Lineage')
    const segments = (lineage?.explorerSegments?.() ?? []).map(s => String(s ?? ''))

    const store = get<StoreLike>('@hypercomb.social/Store')
    if (!store?.putOptimization) {
      console.warn('[ask] Store.putOptimization unavailable')
      return
    }

    // The ask record — content-addressed, participant-local (never shared).
    // `appliesTo` is where the answer should land (the selection, else here).
    const record = {
      kind: ASK_KIND,
      appliesTo: targets.length ? targets : segments,
      payload: {
        prompt,
        model: this.activeModel,   // responder hint (opus / sonnet / haiku)
        targets,                   // selected tile labels
        segments,                  // lineage of the current level
        status: 'pending',
        askedAt: Date.now(),
      },
      mark: 'persistent',
    }

    const sig = await store.putOptimization(new Blob([JSON.stringify(record)], { type: 'application/json' }))
    // Surface it to the UI (a pending-ask indicator can key off this) and log.
    EffectBus.emit('ask:queued', { sig, prompt, targets, model: this.activeModel })
    console.log(
      `[ask] queued for the Claude bridge (${this.activeModel}): "${prompt}" `
      + `→ ${targets.join(', ') || `/${segments.join('/') || ''}`}  [${sig.slice(0, 12)}…]`,
    )
  }
}

// ── slash provider ──────────────────────────────────────

class LlmProvider implements SlashBehaviourProvider {
  readonly name = 'llm-provider'
  readonly priority = 100
  readonly behaviours: SlashBehaviour[] = [
    { name: 'opus', description: 'Ask Claude Opus (via the bridge) about the selection', descriptionKey: 'slash.opus' },
    { name: 'sonnet', description: 'Ask Claude Sonnet (via the bridge) about the selection', descriptionKey: 'slash.sonnet' },
    { name: 'haiku', description: 'Ask Claude Haiku (via the bridge) about the selection', descriptionKey: 'slash.haiku' },
  ]

  async execute(behaviourName: string, args: string): Promise<void> {
    const queen = get('@diamondcoreprocessor.com/LlmQueenBee') as
      { activeModel: string; invoke: (a: string) => Promise<void> } | undefined
    if (queen) {
      queen.activeModel = behaviourName
      await queen.invoke(args)
    }
  }
}

// ── registration ────────────────────────────────────────

const _llm = new LlmQueenBee()
window.ioc.register('@diamondcoreprocessor.com/LlmQueenBee', _llm)

const _llmProvider = new LlmProvider()
window.ioc.whenReady?.('@diamondcoreprocessor.com/SlashBehaviourDrone', (slashDrone: any) => {
  slashDrone?.addProvider?.(_llmProvider)
})
