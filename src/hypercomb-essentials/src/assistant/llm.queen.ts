// assistant/llm.queen.ts
//
// /opus, /sonnet, /haiku, /fable — open the CHAT WINDOW (ui/chat-window) on
// that model and talk to a live Claude Code over the bridge. The model name is
// the only thing that differs between the four commands; it is carried as a
// hint and the conversation remembers it.
//
// Two ways a message leaves here, both content-addressed and both drained by
// the same bridge loop:
//
//   submitChat — a turn of a conversation. The reply comes back through the
//                `chat-reply` bridge op and lands in the window (and on disk,
//                in the threads pool). This is what the chat window sends.
//   submitAsk  — a standing request whose ANSWER IS A NOTE on a tile, for the
//                routine to find later. Not a conversation; it survives the
//                window being closed and the page being left.
//
// No API key, no direct Anthropic call: the command writes an `ask` record
// into the participant-local
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

import { QueenBee, EffectBus, isLocalClaudeBridgeConfigured, isSignature } from '@hypercomb/core'
import { llmProviderRegistry } from './llm-provider-registry.js'
import type { SlashBehaviour, SlashBehaviourProvider } from '../commands/slash-behaviour.provider.js'
import { resolveTileContext } from './tile-context.js'

type StoreLike = { putOptimization?: (blob: Blob) => Promise<string> }
type SelectionLike = { selected: ReadonlySet<string> }
type LineageLike = { explorerSegments?: () => readonly string[] }

/** Optimization kind for a user→Claude ask. The bridge ask-loop lists this. */
const ASK_KIND = 'ask'

/** Composed context budget for one ask — across ALL attached branches.
 *
 *  tile-context bounds each branch's walk (240 nodes), but nothing bounded the
 *  UNION an ask carries; this is that deliberate ceiling rather than an
 *  accident of the per-branch numbers. Sigs are pointers, not bytes — the
 *  responder expands what it needs with `get-resource` — so the cap protects
 *  the ask record's size, and `contextTruncated` rides along when it bites so
 *  the responder knows there is more than the list shows. */
const CONTEXT_SIG_CAP = 64

/** The tile's attached context, resolved and capped — the wiring the context
 *  system existed for. Never allowed to fail a send: context is a grade of
 *  service, the question itself is the service.
 *
 *  Composed from the PER-BRANCH resolution, not the flat union, because
 *  honesty composes too: `contextTruncated` must ride whenever the list is
 *  incomplete for ANY reason — a branch's own walk hit its depth/node budget,
 *  a branch resolved to an error (attached but unreadable), or the composed
 *  cap below bit. The union call discards those flags, and a responder told
 *  "this is everything" when it is not answers confidently out of ignorance —
 *  the exact failure the context system's honesty doctrine exists to prevent.
 *
 *  Context SUMMARIES ride in the array BEFORE the content sigs: the responder
 *  sees what each branch IS ABOUT before trying to parse its layer bytes.
 *  Summaries are cached by branch signature so they reuse across requests. */
const composeContext = async (
  segments: readonly string[],
): Promise<{ context?: string[]; contextTruncated?: boolean }> => {
  try {
    const branches = await resolveTileContext(segments)
    if (!branches.length) return {}

    // Summaries first, content sigs after — the responder frames understanding
    // from the summaries before expanding the raw resources.
    let sigs: string[] = []
    let incomplete = false

    // Import the summary generator (essentials module, safe to import at runtime).
    try {
      const { contextWithSummaries } = await import(
        './context-summary-gen.js'
      )
      if (typeof contextWithSummaries === 'function') {
        sigs = await contextWithSummaries(branches)
      }
    } catch {
      // Fallback if the import fails: return just content sigs, no summaries.
    }

    // If summaries didn't populate, fall back to raw content sigs.
    if (sigs.length === 0) {
      const union = new Set<string>()
      for (const branch of branches) {
        if (branch.truncated || branch.error) incomplete = true
        for (const sig of branch.signatures) union.add(sig)
      }
      sigs = [...union]
    }

    for (const branch of branches) {
      if (branch.truncated || branch.error) incomplete = true
    }

    if (!sigs.length) return incomplete ? { contextTruncated: true } : {}
    return {
      context: sigs.slice(0, CONTEXT_SIG_CAP),
      ...(incomplete || sigs.length > CONTEXT_SIG_CAP ? { contextTruncated: true } : {}),
    }
  } catch {
    return {}
  }
}

export class LlmQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'assistant'
  readonly command = 'opus'
  override readonly aliases = []
  override description = 'Open the chat with a live Claude Code (via the bridge) — /opus, /sonnet, /haiku, /fable'
  override options = ['<question>']
  override examples = [
    { input: '/opus', result: 'Opens the chat on Opus, resuming your last conversation' },
    { input: '/opus what links these tiles?', result: 'Opens the chat on Opus and asks, in a new conversation' },
  ]

  /** LlmProvider declares opus/sonnet/haiku manually — skip auto-wrap to avoid a duplicate /opus */
  readonly slashSkipAutoWrap = true

  /** Set by the provider before invoke() — carried into the ask as a model hint. */
  activeModel = 'opus'

  /** The command OPENS THE CHAT WINDOW on this model. Anything typed after it
   *  is asked straight away, in a new conversation; bare, it resumes the last
   *  one. (It used to open the ask screen — a fullscreen draft-and-chips
   *  harness, retired; see ui/chat-window for what replaced it and why.) */
  protected async execute(args: string): Promise<void> {
    EffectBus.emit('chat:open', { model: this.activeModel, prefill: args.trim() })
  }

  /** Mint a CHAT-mode ask — one turn of the ask screen's refinement
   *  conversation. The responder replies via the `chat-reply` bridge op
   *  (surfaced as `ask:chat-reply`), never as a note, so this deliberately
   *  emits NO `ask:queued` pill and NO toast: the conversation window owns
   *  its own thinking indicator. `transcript` carries the recent turns so a
   *  stateless responder still has the thread.
   *
   *  Returns the ask record's SIGNATURE, or null when it could not be queued.
   *  A queued question that cannot be named cannot be WITHDRAWN, and a durable
   *  record nobody can take back is a question you are stuck with — so the
   *  handle comes back to the caller rather than being logged and dropped.
   *  (Callers that only asked "did it leave?" still read correctly: a signature
   *  is truthy, null is not.) */
  async submitChat(
    convoId: string,
    message: string,
    targets: string[],
    transcript: ReadonlyArray<{ role: string; text: string }>,
    /** THE REFERENCES this request carries — supporting layers, resources, or
     *  whole context groups (a META CONTEXT: a reference whose target is a set
     *  rather than a single layer). Each contributes a signature, and they
     *  lead the union so the cap can never drop something named by hand in
     *  favour of something merely attached. A signature list is what makes the
     *  payload deterministic: the same references compose the same request
     *  bytes, today and on a rebuild. */
    references: readonly { kind?: string; sig?: string; label?: string }[] = [],
  ): Promise<string | null> {
    // This method is specifically the durable LOCAL-BRIDGE queue seam. The
    // chat window's participant-host path calls HostAi directly and never
    // needs it. Guard direct/background callers too, or an unconfigured user
    // can accumulate requests that nobody will ever drain.
    if (!isLocalClaudeBridgeConfigured()) return null
    const prompt = message.trim()
    if (!prompt || !convoId) return null
    const store = get<StoreLike>('@hypercomb.social/Store')
    if (!store?.putOptimization) return null

    const lineage = get<LineageLike>('@hypercomb.social/Lineage')
    const segments = (lineage?.explorerSegments?.() ?? []).map(s => String(s ?? ''))

    // The tile's ATTACHED CONTEXT rides with the turn — the branches somebody
    // dragged onto this tile, resolved to content sigs. This is the wire the
    // whole context system was built toward: the responder no longer has to
    // guess that a tile has curated material behind it.
    const attached = await composeContext(segments)

    // REFERENCES FIRST, then whatever is attached to the tile. Both are sigs,
    // so the union is a set and the order is the only editorial decision:
    // what was named by hand outranks what was inherited from the page.
    const named = references
      .map(reference => ({
        kind: String(reference?.kind ?? 'layer'),
        sig: String(reference?.sig ?? ''),
        label: String(reference?.label ?? ''),
      }))
      .filter(reference => isSignature(reference.sig))
    const picked = [...new Set(named.map(reference => reference.sig))]

    const union = [...new Set([...picked, ...(attached.context ?? [])])]
    const context = union.length
      ? {
          context: union.slice(0, CONTEXT_SIG_CAP),
          ...(attached.contextTruncated || union.length > CONTEXT_SIG_CAP ? { contextTruncated: true } : {}),
        }
      : attached

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
        // The TARGET is `appliesTo` above — the tile this conversation is
        // about, and the only thing an answer may change. Everything the
        // request carries below is there to be READ.
        //
        // Structured references ride BESIDE the flat sig list: the list is
        // what a responder expands, the structure is what tells it whether a
        // signature is one layer or a whole context.
        ...(named.length ? { references: named } : {}),
        ...context,
        status: 'pending',
        askedAt: Date.now(),
      },
      mark: 'persistent',
    }
    const sig = await store.putOptimization(new Blob([JSON.stringify(record)], { type: 'application/json' }))
    console.log(`[ask] chat turn queued (${this.activeModel}) convo=${convoId} [${sig.slice(0, 12)}…]`)
    return sig
  }

  /** Mint the ask record. Called by the ask screen with the CHOSEN targets
   *  (empty = the current page). Returns false when refused so the screen
   *  can stay open.
   *
   *  `at` names the LEVEL the targets live on. The agent panel's tiles rail
   *  lets a participant pick tiles on pages they are not standing on, so
   *  "wherever the lineage happens to be" stopped being a safe default for
   *  every caller — omitted, it still reads the current location. */
  async submitAsk(prompt: string, targets: string[], at?: readonly string[]): Promise<boolean> {
    if (!prompt.trim()) return false

    const lineage = get<LineageLike>('@hypercomb.social/Lineage')
    const segments = (at ?? lineage?.explorerSegments?.() ?? []).map(s => String(s ?? ''))

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

    // The tile's attached context — same wire as submitChat, so a note-bound
    // ask reads from the same curated branches a chat turn does.
    const context = await composeContext(segments)

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
        ...context,                // attached-context sigs (context / contextTruncated)
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
  // already is; the scheduled drain maps the hint to a CLI and a real model
  // id, see scripts/bridge/agent-roster.cjs). Keep these names aligned with
  // the roster's model `name` fields.
  //
  // The four Claude words ship in the box because Claude Code is the bridge
  // that has always been here. Every OTHER frontier bridge earns its words
  // the moment it is announced: `bridge-agents.cjs --announce` registers an
  // `agent-bridge` provider per installed CLI, and the models it declares
  // become commands below with no code change. That is the whole point of
  // the bridge tier being a provider — one roster, one place to look.
  static readonly #BUILT_IN: SlashBehaviour[] = [
    { name: 'opus', description: 'Open the chat with Claude Opus', descriptionKey: 'slash.opus' },
    { name: 'sonnet', description: 'Open the chat with Claude Sonnet', descriptionKey: 'slash.sonnet' },
    { name: 'haiku', description: 'Open the chat with Claude Haiku', descriptionKey: 'slash.haiku' },
    { name: 'fable', description: 'Open the chat with Claude Fable', descriptionKey: 'slash.fable' },
  ]

  get behaviours(): SlashBehaviour[] {
    const words = new Map<string, SlashBehaviour>(
      LlmProvider.#BUILT_IN.map(behaviour => [behaviour.name, behaviour]),
    )
    // Bridges only. An HTTP vendor's models are NOT command words: typing
    // `/gpt` must not silently spend a key on a tier that cannot read the
    // hive, and the chat window is where a keyed provider is chosen.
    // Through the accessor, never a bare `ioc.get`: this module and the
    // registry are both early in the barrel, and the shell's map is not
    // reliably populated yet at that point (see the heal in
    // llm-provider-registry.ts).
    for (const provider of llmProviderRegistry().all()) {
      if (provider.transport !== 'agent-bridge') continue
      for (const model of provider.models ?? []) {
        const name = String(model?.name ?? '').trim().toLowerCase()
        if (!name || words.has(name)) continue
        words.set(name, { name, description: `Ask ${provider.label} (${name})` })
      }
    }
    return [...words.values()]
  }

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
