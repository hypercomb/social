// diamondcoreprocessor.com/assistant/llm.queen.ts
//
// /opus, /sonnet, /haiku — ask a live Claude Code (over the bridge) about the
// selected tiles, and get the answer back IN THE HIVE. No API key, no direct
// Anthropic call: the command writes an `ask` record into the participant-local
// optimization inbox (the sign('optimization') pool via Store.putOptimization;
// legacy `__optimization__/` is a read-fallback — kind:'ask'). A Claude Code instance
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
  override description = 'Ask a live Claude Code (via the bridge) about the selected tiles — /opus, /sonnet, /haiku, /fable'
  override options = ['<question>']
  override examples = [
    { input: '/opus what links these tiles?', result: 'Queues the ask; answer lands as a tile note' },
  ]

  /** LlmProvider declares opus/sonnet/haiku manually — skip auto-wrap to avoid a duplicate /opus */
  readonly slashSkipAutoWrap = true

  /** Set by the provider before invoke() — carried into the ask as a model hint. */
  activeModel = 'opus'

  /** The command now OPENS THE ASK SCREEN (request first, tile context
   *  second — see ask-screen.view.ts) with whatever was typed as the
   *  prefill. Minting moved to `submitAsk`, which the screen calls on OK. */
  protected async execute(args: string): Promise<void> {
    EffectBus.emit('ask:open', { model: this.activeModel, prefill: args.trim() })
  }

  /** Mint a CHAT-mode ask — one turn of the ask screen's refinement
   *  conversation. The responder replies via the `chat-reply` bridge op
   *  (surfaced as `ask:chat-reply`), never as a note, so this deliberately
   *  emits NO `ask:queued` pill and NO toast: the conversation window owns
   *  its own thinking indicator. `transcript` carries the recent turns so a
   *  stateless responder still has the thread. */
  async submitChat(
    convoId: string,
    message: string,
    targets: string[],
    transcript: ReadonlyArray<{ role: string; text: string }>,
  ): Promise<boolean> {
    const prompt = message.trim()
    if (!prompt || !convoId) return false
    const store = get<StoreLike>('@hypercomb.social/Store')
    if (!store?.putOptimization) return false

    const lineage = get<LineageLike>('@hypercomb.social/Lineage')
    const segments = (lineage?.explorerSegments?.() ?? []).map(s => String(s ?? ''))

    const record = {
      kind: ASK_KIND,
      appliesTo: targets.length ? targets : segments,
      payload: {
        mode: 'chat',
        convoId,
        prompt,
        transcript: transcript.slice(-12),
        model: this.activeModel,
        targets,
        segments,
        status: 'pending',
        askedAt: Date.now(),
      },
      mark: 'persistent',
    }
    const sig = await store.putOptimization(new Blob([JSON.stringify(record)], { type: 'application/json' }))
    console.log(`[ask] chat turn queued (${this.activeModel}) convo=${convoId} [${sig.slice(0, 12)}…]`)
    return true
  }

  /** Mint the ask record. Called by the ask screen with the CHOSEN targets
   *  (empty = the current page). Returns false when refused so the screen
   *  can stay open. */
  async submitAsk(prompt: string, targets: string[]): Promise<boolean> {
    if (!prompt.trim()) return false

    const lineage = get<LineageLike>('@hypercomb.social/Lineage')
    const segments = (lineage?.explorerSegments?.() ?? []).map(s => String(s ?? ''))

    // HIVE SCOPE — no tile chosen and standing at the root. This is not an
    // error: "go through the hive and …" is a legitimate ask with no single
    // tile to own the answer. It is marked `scope:'hive'` so the responder
    // knows not to force a note onto an arbitrary tile — hive-wide findings
    // belong in the feedback window (the ask-gate), or on the one tile the work
    // actually concerns, named explicitly.
    const hiveScope = targets.length === 0 && segments.length === 0

    const store = get<StoreLike>('@hypercomb.social/Store')
    if (!store?.putOptimization) {
      console.warn('[ask] Store.putOptimization unavailable')
      return false
    }

    // The ask record — content-addressed, participant-local (never shared).
    // `appliesTo` is where the answer should land (the selection, else here).
    const record = {
      kind: ASK_KIND,
      appliesTo: targets.length ? targets : segments,
      payload: {
        prompt,
        model: this.activeModel,   // responder hint (opus / sonnet / haiku / fable)
        targets,                   // selected tile labels
        segments,                  // lineage of the current level
        ...(hiveScope ? { scope: 'hive' } : {}),
        status: 'pending',
        askedAt: Date.now(),
      },
      mark: 'persistent',
    }

    const sig = await store.putOptimization(new Blob([JSON.stringify(record)], { type: 'application/json' }))
    // Surface it: the command line raises a pending pill off ask:queued (and
    // drops it on ask:answered); the toast tells the user where to look.
    EffectBus.emit('ask:queued', { sig, prompt, targets, model: this.activeModel })
    EffectBus.emit('toast:show', {
      type: 'tip',
      message: hiveScope
        ? 'Asked about the whole hive — the answer arrives in the feedback window.'
        : `Asked — the answer will arrive as a note on ${targets.length ? targets.join(', ') : 'this page'}.`,
    })
    console.log(
      `[ask] queued for the Claude bridge (${this.activeModel}): "${prompt}" `
      + `→ ${targets.join(', ') || `/${segments.join('/') || ''}`}  [${sig.slice(0, 12)}…]`,
    )
    return true
  }
}

// ── slash provider ──────────────────────────────────────

class LlmProvider implements SlashBehaviourProvider {
  readonly name = 'llm-provider'
  readonly priority = 100
  // The model name is a HINT carried in the ask record — the responder
  // decides what to honour it with (a parked session answers as whatever it
  // already is; the scheduled drain maps the hint to a real model id, see
  // scripts/bridge/drain-tick.cjs). Keep these names aligned with that map.
  readonly behaviours: SlashBehaviour[] = [
    { name: 'opus', description: 'Ask Claude Opus (via the bridge) about the selection', descriptionKey: 'slash.opus' },
    { name: 'sonnet', description: 'Ask Claude Sonnet (via the bridge) about the selection', descriptionKey: 'slash.sonnet' },
    { name: 'haiku', description: 'Ask Claude Haiku (via the bridge) about the selection', descriptionKey: 'slash.haiku' },
    { name: 'fable', description: 'Ask Claude Fable (via the bridge) about the selection', descriptionKey: 'slash.fable' },
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
