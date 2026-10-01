// assistant/llm-dispatch.ts
//
// THE ONE SEAM. Every caller that wants a model to answer something goes
// through `callModel` or `streamModel`, and nothing else in the codebase
// touches an LLM endpoint, a vendor header, or a response shape.
//
//   resolve descriptor → resolve key → adapter builds the request →
//   fetch → adapter reads the answer → normalized LlmCallResult
//
// Four of those five steps are the same for every vendor, which is the whole
// argument for the registry: a new provider is a descriptor file, and this
// file never learns its name.
//
// ── keys ───────────────────────────────────────────────────────────────
//
// The key comes from the core LlmKeyStore and is used exactly once, to build
// one request. It is never returned, never logged, never attached to an
// error, and never emitted. `LlmDispatchError` carries the provider id, the
// model, and the HTTP status — enough to debug, nothing to leak. A vendor's
// own error body is included because it is the only useful diagnostic, but it
// is truncated: some vendors echo the offending request back.
//
// ── streaming ──────────────────────────────────────────────────────────
//
// `streamModel` is an async generator of text deltas. A provider without
// `fromStreamEvent` still works — it falls back to one plain call and yields
// the whole answer as a single chunk, so a caller never has to ask whether
// its provider streams.

import { EffectBus, llmKeyStore } from '@hypercomb/core'
import { llmActivation } from './llm-activation.js'
import {
  localModelServerUp,
  localTierReason,
  machineLocalEndpoint,
  noteLocalServerUnreachable,
} from './providers/local-liveness.js'
import { chooseProvider, modelForTier, rankProviders, type ModelNeed } from './model-policy.js'
import { isOpenRouterBatchModel } from './providers/openrouter-catalog.js'
import { credentialOwner } from './providers/credential-owner.js'
import { llmProviderRegistry, type LlmProviderRegistry } from './llm-provider-registry.js'
import type {
  LlmCallResult,
  LlmChatMessage,
  LlmFunctionTool,
  LlmProviderDescriptor,
  LlmRequest,
  LlmTier,
  LlmToolCall,
} from './providers/llm-provider.types.js'

export type {
  LlmCallResult,
  LlmChatMessage,
  LlmFunctionTool,
  LlmModelDescriptor,
  LlmProviderDescriptor,
  LlmRequest,
  LlmStreamEvent,
  LlmTier,
  LlmToolCall,
  LlmToolCallDelta,
  LlmTransport,
} from './providers/llm-provider.types.js'

/** What a caller asks for. Everything but `messages` has a sane default. */
export type LlmCall = {
  /** Provider id. Omitted → inferred from `model`, else chosen by policy. */
  readonly providerId?: string
  /**
   * WHAT THE WORK NEEDS, for a caller that does not care who answers — the
   * normal case for translation, expand, break-apart and friends. The
   * participant's policy turns this into a provider (model-policy.ts), so a
   * caller never has to know which tiers exist.
   */
  readonly need?: ModelNeed
  /** Wire id or the descriptor's human name (`opus`, `gemini`). */
  readonly model?: string
  /** Soft session stickiness. Preferred while eligible; unlike `model`, it
   * does not forbid an automatic fallback. */
  readonly preferModel?: string
  readonly messages: readonly LlmChatMessage[]
  readonly system?: string
  readonly maxTokens?: number
  /** OpenAI-style functions available to a supporting provider. */
  readonly tools?: readonly LlmFunctionTool[]
  /** Hint that `system` is stable and worth prompt-caching where supported. */
  readonly cacheSystem?: boolean
  /** false = answer without a reasoning pass. Honoured by the local provider only. */
  readonly thinking?: false
  /** Reasoning effort for a model the participant fixed; see LlmRequest.effort. */
  readonly effort?: LlmTier
  /** Constrain the answer to this JSON Schema. Honoured by the local provider only. */
  readonly jsonSchema?: Readonly<Record<string, unknown>>
  /** Sampling temperature. Honoured by the local provider only. */
  readonly temperature?: number
  readonly signal?: AbortSignal
  /** Automatic fallback, but only among providers paying with this owner's
   *  credentials (credential-owner.ts). The chat's first round sets it, so a
   *  job designated to one model added through OpenRouter can fall to
   *  another of them before any output — never to a provider the participant
   *  has not let read the hive. */
  readonly fallbackWithin?: string
  /** PROVIDERS THAT GAVE UP. A model that handed the question off
   *  (`hypercomb-handoff`) is not asked again this turn; the policy ranks
   *  the rest as it always does. Ignored for an explicit provider or model —
   *  naming one is the participant's word. */
  readonly avoid?: readonly string[]
  /** Upstream hosts to route around (OpenRouter provider slugs); the router
   *  fills this on its retry pass from the hosts that answered busy. */
  readonly ignoreUpstreams?: readonly string[]
  /** Optional, non-persistent lifecycle hook for one routed provider attempt. */
  readonly observeAttempt?: (event: LlmAttemptEvent) => void
}

export type LlmAttemptUsage = {
  readonly inputTokens?: number
  readonly outputTokens?: number
  readonly totalTokens?: number
  readonly cacheReadTokens?: number
  readonly cacheWriteTokens?: number
  readonly reasoningTokens?: number
  /** Derived from the descriptor's published per-million-token rates. */
  readonly estimatedCostUsd?: number
  readonly estimatedCost?: true
}

export type LlmAttemptEvent = {
  readonly phase: 'start' | 'success' | 'failure'
  readonly attempt: number
  readonly providerId: string
  readonly model: string
  readonly durationMs: number
  readonly outputEmitted: boolean
  readonly category: string
  readonly status?: number
  readonly usage?: LlmAttemptUsage
}

// ── the participant's own local model ─────────────────────────────────
//
// "The local model I use" needs ONE answer, and only one path is the
// participant's own local chat: the routed stream the chat window sends
// through. So that path writes the model that answered, and nothing else
// does — `callModel`'s callers are all automatic (the blurb drain, bee
// banter, serving a peer, the providers window's test, every route-flow
// call), and a model they happened to name is not a model anybody chose.
// The route flow reads it to organize with exactly that model and never a
// roster guess (documentation/chat-route.md §4.1.1). Device-local, like the
// host override: which model you run is how THIS machine is set up.

export const LOCAL_MODEL_STORAGE_KEY = 'hc:llm:local:model'

/** The wire model of the participant's last own local chat, or null. Best-effort read. */
export const participantLocalChoice = (): { readonly providerId: string; readonly model: string; readonly at: number } | null => {
  try {
    const raw = JSON.parse(globalThis.localStorage?.getItem(LOCAL_MODEL_STORAGE_KEY) ?? 'null') as
      { providerId?: unknown; model?: unknown; at?: unknown } | null
    if (!raw || typeof raw.providerId !== 'string' || typeof raw.model !== 'string') return null
    const providerId = raw.providerId.trim()
    const model = raw.model.trim()
    if (!providerId || !model) return null
    return { providerId, model, at: typeof raw.at === 'number' && Number.isFinite(raw.at) ? raw.at : 0 }
  } catch { return null }
}

/** No key and fetched from the browser: the predicate `llm:local-used` has
 *  always used for "this is the participant's own machine answering". */
const isLocalUse = (provider: LlmProviderDescriptor): boolean =>
  provider.requiresKey === false && provider.transport === 'browser-http'

/** Remember the model that just answered the participant's own local chat.
 *  A write that throws (a private window, a full quota) is skipped, as the
 *  chat window's own `hc:chat-models` writes are. */
const rememberLocalChoice = (provider: LlmProviderDescriptor, model: string): void => {
  if (!isLocalUse(provider) || !model) return
  try {
    globalThis.localStorage?.setItem(LOCAL_MODEL_STORAGE_KEY, JSON.stringify({ providerId: provider.id, model, at: Date.now() }))
  } catch { /* session-only */ }
}

/** One routed stream delta, carrying the truth about who actually answered. */
export type LlmRoutedChunk = {
  readonly text: string
  readonly toolCalls?: readonly LlmToolCall[]
  readonly providerId: string
  readonly providerLabel: string
  readonly vendor: string
  readonly model: string
}

/**
 * A dispatch failure with the context needed to debug it and nothing that
 * could carry a credential. Deliberately not an `Error` subclass with the
 * request attached — the request holds the key.
 */
export class LlmDispatchError extends Error {
  constructor(
    message: string,
    readonly providerId: string,
    readonly model: string,
    readonly status?: number,
    /** How long the vendor asked us to wait before asking again (`Retry-After`). */
    readonly retryAfterMs?: number,
    /** The upstream host behind a router that named it (OpenRouter's
     *  `metadata.provider_name`), as a routing slug — so a retry can go
     *  around it rather than back to it. */
    readonly upstream?: string,
  ) {
    super(message)
    this.name = 'LlmDispatchError'
  }
}

const MAX_ERROR_BODY = 600

/** THE UPSTREAM THAT WAS BUSY. A router's error names the host it tried
 *  (`{"error":{"metadata":{"provider_name":"DeepInfra"}}}`); as a slug it
 *  is what OpenRouter's `provider.ignore` takes. Undefined when the body
 *  names none. */
export const upstreamOf = (body: string): string | undefined => {
  try {
    const parsed = JSON.parse(body) as { error?: { metadata?: { provider_name?: unknown } } }
    const name = String(parsed?.error?.metadata?.provider_name ?? '').trim().toLowerCase()
    const slug = name.split('/')[0].trim()
    return /^[a-z0-9][a-z0-9._ -]{0,63}$/.test(slug) ? slug.replace(/\s+/g, '-') : undefined
  } catch { return undefined }
}

/** `Retry-After` as milliseconds — delay-seconds or an HTTP-date; undefined
 *  when the vendor sent nothing readable. */
const retryAfterMs = (response: Response): number | undefined => {
  const value = response.headers?.get?.('retry-after')?.trim()
  if (!value) return undefined
  if (/^\d+$/.test(value)) return Number(value) * 1000
  const at = Date.parse(value)
  return Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined
}

const registry = (): LlmProviderRegistry => llmProviderRegistry()

/** Can this seam answer with this provider at all? An `agent-bridge` cannot:
 *  it answers through the broker (an ask record a parked CLI drains), so it
 *  belongs to the ask path. A `peer-swarm` provider CAN — not by fetch, but
 *  by asking the participant whose machine runs it — so it stays callable and
 *  is routed below. Keeping the test here means one definition of "callable"
 *  for the roster and the resolver both. */
const isCallable = (provider: LlmProviderDescriptor): boolean =>
  provider.transport !== 'agent-bridge' && !provider.decisionOnly

/**
 * THE PEER SEAM. `peer-models.drone` installs this when the swarm tier is
 * live; without it a peer provider is simply not callable, which is the right
 * answer for a shell that has no mesh. One function, so this file needs to
 * know nothing about relays, pubkeys, or offers.
 */
export type PeerModelCaller = (
  provider: LlmProviderDescriptor,
  request: LlmRequest,
  signal?: AbortSignal,
) => Promise<LlmCallResult>

let peerCaller: PeerModelCaller | null = null

/** Install (or clear, with null) the transport that reaches other people's
 *  machines. Called once, by the drone that owns the mesh conversation. */
export const setPeerModelCaller = (caller: PeerModelCaller | null): void => { peerCaller = caller }

/** The roster that can answer HTTP calls: reachable by fetch, has a key (or
 *  needs none), AND has not been switched off in the providers console.
 *  Naming a provider or a model explicitly still wins over the activation
 *  filter — an explicit ask is the participant overriding their own default,
 *  not the orchestrator choosing. */
export const configuredProviders = (): LlmProviderDescriptor[] =>
  registry().all().filter(p =>
    isCallable(p) && llmActivation.isEnabled(p.id)
    && (p.transport !== 'peer-swarm' || !!peerCaller)
    && localModelServerUp(p)
    && (p.requiresKey === false || llmKeyStore.has(credentialOwner(p))))

/** Every ACTIVE provider whatever its transport — what the orchestrator picks
 *  from when it is choosing WHO answers rather than building a fetch. Bridges
 *  belong here: they are the only tier that can read the hive. */
export const activeProviders = (): LlmProviderDescriptor[] =>
  registry().all().filter(p =>
    !p.decisionOnly && llmActivation.isEnabled(p.id) && localModelServerUp(p)
    && (!isCallable(p) || p.requiresKey === false || llmKeyStore.has(credentialOwner(p))))

/**
 * Which provider answers this call.
 *
 *   1. the id the caller NAMED — always wins, policy included
 *   2. the provider that owns the model the caller named
 *   3. the participant's POLICY for the work described (model-policy.ts)
 *   4. the single ready provider, if there is exactly one
 *
 * There is no vendor of last resort any more. A hive with nothing configured
 * used to fall back to anthropic and fail with a missing-key error naming a
 * vendor the participant may never have chosen; now it says plainly that
 * nothing is set up, which is the true thing to say.
 */
export const resolveProvider = (call: Pick<LlmCall, 'providerId' | 'model' | 'need'>): LlmProviderDescriptor => {
  const reg = registry()
  if (call.model && isOpenRouterBatchModel(call.model)) {
    throw new LlmDispatchError('This OpenRouter model requires the asynchronous Batch API and cannot answer live chat. Choose a non-batch model.', 'openrouter', call.model)
  }
  if (call.providerId) {
    const named = reg.get(call.providerId)
    if (!named) {
      throw new LlmDispatchError(
        `no provider registered as "${call.providerId}"`, call.providerId, call.model ?? '',
      )
    }
    return named
  }
  const byModel = call.model ? reg.providerForModel(call.model) : undefined
  // A model word can name a BRIDGE model (`opus`, `gemini`). Falling through
  // to the HTTP roster would silently answer with a different vendor, so the
  // bridge is returned and `buildRequest` raises its own honest error.
  if (byModel) return byModel

  // THE POLICY DECIDES. Pins first, then the participant's cost preference —
  // and never a peer unless they allowed automatic use of one.
  const chosen = chooseProvider(call.need ?? {})
  if (chosen) return chosen

  const configured = configuredProviders()
  if (configured.length === 1) return configured[0]

  throw new LlmDispatchError(
    configured.length
      ? 'no configured provider can do this work'
      : 'no AI provider is set up yet — open /providers to add one',
    '', call.model ?? '',
  )
}

/** Build the vendor-shaped request for a call. Exported for tests and "test this key". */
export const buildRequest = (
  provider: LlmProviderDescriptor,
  call: LlmCall,
  options: { stream?: boolean } = {},
): LlmRequest => {
  const needsKey = provider.requiresKey !== false
  const apiKey = needsKey ? llmKeyStore.get(credentialOwner(provider)) : ''
  if (needsKey && !apiKey) {
    throw new LlmDispatchError(
      `no key configured for "${provider.id}" — set one up at ${provider.docsUrl}`,
      provider.id,
      call.model ?? provider.defaultModel,
    )
  }
  return {
    // A caller that asked for `fast` work and named no model should get the
    // provider's fast model, not whatever its default happens to be.
    model: call.model
      ? registry().resolveModelId(provider, call.model)
      : call.preferModel && registry().providerForModel(call.preferModel)?.id === provider.id
        ? registry().resolveModelId(provider, call.preferModel)
        : modelForTier(provider, call.need?.tier ?? 'balanced'),
    messages: call.messages,
    system: call.system,
    maxTokens: call.maxTokens,
    tools: call.tools,
    cacheSystem: call.cacheSystem,
    // Passed through only when set, so a request that names none of them is
    // the same object it always was. Only the local adapter reads them.
    ...(call.thinking === false ? { thinking: false as const } : {}),
    ...(call.effort ? { effort: call.effort } : {}),
    ...(call.jsonSchema ? { jsonSchema: call.jsonSchema } : {}),
    ...(call.temperature !== undefined ? { temperature: call.temperature } : {}),
    ...(call.ignoreUpstreams?.length ? { ignoreUpstreams: [...call.ignoreUpstreams] } : {}),
    stream: options.stream === true,
    apiKey,
  }
}

/**
 * A LOCAL SERVER FAILS DIFFERENTLY, and the browser will not say how: a
 * process that is down and a process that refused this origin both arrive as
 * one rejected fetch. `noteLocalServerUnreachable` re-probes (which CAN tell
 * them apart, see local-liveness.ts) so the availability line corrects itself
 * within a moment; the sentence thrown here says the actionable half straight
 * away rather than surfacing "Failed to fetch" to a participant.
 */
const localFailure = (provider: LlmProviderDescriptor, host: string, model: string): LlmDispatchError => {
  noteLocalServerUnreachable(provider)
  return new LlmDispatchError(
    `${provider.label} did not answer at ${host} — start your local model server, `
    + `or allow this page's origin (Ollama: OLLAMA_ORIGINS)`,
    provider.id, model,
  )
}

const send = async (
  provider: LlmProviderDescriptor,
  request: LlmRequest,
  signal?: AbortSignal,
): Promise<Response> => {
  const { url, init } = provider.toRequest(request)
  const local = machineLocalEndpoint(provider)
  let response: Response
  try {
    response = await fetch(url, { ...init, signal })
  } catch (error) {
    if (!local || signal?.aborted) throw error
    throw localFailure(provider, local, request.model)
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    // A model the participant never pulled is the one local failure that
    // arrives as a clean HTTP status, and "404" alone hides the one-line fix.
    // A 400 from a local server is usually the same shape of problem in a
    // different vendor's spelling (LM Studio and other OpenAI-compatible
    // servers reject an unrecognized model name with 400, not 404).
    const hint = local && response.status === 404
      ? ` — pull it first (ollama pull ${request.model})`
      : local && response.status === 400
        ? ` — your local server doesn't recognize "${request.model}"; check its model name/list`
        : ''
    throw new LlmDispatchError(
      `${provider.label} API ${response.status}: ${body.slice(0, MAX_ERROR_BODY)}${hint}`,
      provider.id,
      request.model,
      response.status,
      retryAfterMs(response),
      upstreamOf(body),
    )
  }
  return response
}

/** Ask a model. The normalized answer, whoever answered it — including a
 *  participant on the other side of the swarm. */
export const callModel = async (call: LlmCall): Promise<LlmCallResult> => {
  const provider = resolveProvider(call)
  const request = buildRequest(provider, call)

  // SOMEONE ELSE'S MACHINE. Routed rather than fetched, and refused clearly
  // when this shell has no mesh — a peer provider left over from a previous
  // session must not fail with a URL error.
  if (provider.transport === 'peer-swarm') {
    if (!peerCaller) {
      throw new LlmDispatchError(
        `"${provider.id}" runs on another participant's machine and the swarm is not available here`,
        provider.id, request.model,
      )
    }
    return peerCaller(provider, request, call.signal)
  }

  // THE PARTICIPANT'S OWN WORK WINS. A local model this machine may be
  // lending to the swarm is busy the moment its owner uses it; peer-models
  // reads this stamp to hold requests off until they are done.
  //
  // NEVER `interactive` here. Every caller of `callModel` is automatic — the
  // blurb drain, bee banter, serving a peer, the route flow itself — and the
  // route flow's lane pauses only for the participant's OWN chat, which is the
  // routed stream below. Marking these would make background work pre-empt
  // background work (documentation/chat-route.md §4.1.9).
  if (isLocalUse(provider)) {
    EffectBus.emit('llm:local-used', { providerId: provider.id, at: Date.now() })
  }

  const response = await send(provider, request, call.signal)
  return provider.fromResponse(await response.json(), request)
}

/**
 * A STREAM THAT GOES SILENT IS NOT STILL ANSWERING. Nothing bounded a model
 * call: a host that accepted the request and then sent nothing held the turn
 * until the participant pressed stop — in the middle of a delegated task on
 * hypercomb.io one sat mid-sentence for minutes (jwize's drive session,
 * 2026-09-30). Long work is unattended work, so silence has a limit: no bytes
 * for STREAM_IDLE_MS and the read is given up, the stream cancelled, and the
 * caller told — which makes it a busy answer the plan may ask again. Any byte
 * counts, a router's keep-alive comment included, so a model thinking behind
 * one is never cut off. A model on this machine is exempt: loading one is
 * silent for as long as it takes.
 */
export const STREAM_IDLE_MS = 90_000

export class StreamStalledError extends Error {
  constructor(readonly idleMs: number) {
    super(`no bytes for ${Math.round(idleMs / 1000)} seconds`)
    this.name = 'StreamStalledError'
  }
}

/** One read, given up after `idleMs` of nothing; 0 waits for ever. */
export const readWithIdle = async <T>(read: () => Promise<T>, idleMs: number): Promise<T> => {
  if (!(idleMs > 0)) return read()
  let timer: ReturnType<typeof setTimeout> | undefined
  const silent = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new StreamStalledError(idleMs)), idleMs) })
  try { return await Promise.race([read(), silent]) } finally { clearTimeout(timer) }
}

/**
 * SSE line framing. One `data:` payload per event; `[DONE]` ends the stream
 * (OpenAI's convention, which the shape-sharers inherited). Frames that fail
 * to parse are skipped rather than fatal — a keep-alive comment or a partial
 * flush must not kill a running answer.
 */
async function* sseFrames(response: Response, signal?: AbortSignal, idleMs = 0): AsyncGenerator<unknown> {
  const reader = response.body?.getReader()
  if (!reader) return
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (!signal?.aborted) {
      const { done, value } = await readWithIdle(() => reader.read(), idleMs)
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let cut = buffer.indexOf('\n')
      while (cut !== -1) {
        const line = buffer.slice(0, cut).trim()
        buffer = buffer.slice(cut + 1)
        cut = buffer.indexOf('\n')
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (!payload || payload === '[DONE]') continue
        try { yield JSON.parse(payload) } catch { /* partial or non-JSON frame */ }
      }
    }
  } finally {
    try { await reader.cancel() } catch { /* already closed */ }
  }
}

/** The stream is the participant's own chat — the chat window's local send is
 *  its one caller — so its stamp says so. `interactive` is what the route
 *  flow's lane pauses for; `peer-models` ignores the payload and keeps
 *  counting every local use as the owner's. */
const emitLocalUse = (provider: LlmProviderDescriptor): void => {
  if (isLocalUse(provider)) {
    EffectBus.emit('llm:local-used', { providerId: provider.id, at: Date.now(), interactive: true })
  }
}

/** Stream one already-selected provider. Selection and fallback live above it. */
async function* streamProvider(
  provider: LlmProviderDescriptor,
  call: LlmCall,
  suppliedRequest?: LlmRequest,
): AsyncGenerator<{ text: string; toolCalls?: readonly LlmToolCall[]; model: string; usage?: LlmAttemptUsage }> {
  if (provider.transport === 'peer-swarm' || !provider.fromStreamEvent) {
    const request = suppliedRequest ?? buildRequest(provider, call)
    let result: LlmCallResult
    if (provider.transport === 'peer-swarm') {
      if (!peerCaller) {
        throw new LlmDispatchError(
          `"${provider.id}" runs on another participant's machine and the swarm is not available here`,
          provider.id, request.model,
        )
      }
      result = await peerCaller(provider, request, call.signal)
    } else {
      emitLocalUse(provider)
      const response = await send(provider, request, call.signal)
      // `send` throws on anything but OK, so reaching here means this model
      // answered the participant's own chat.
      rememberLocalChoice(provider, request.model)
      result = provider.fromResponse(await response.json(), request)
    }
    if (result.text || result.toolCalls?.length) {
      yield {
        text: result.text,
        ...(result.toolCalls?.length ? { toolCalls: result.toolCalls } : {}),
        model: result.model || request.model,
        usage: attemptUsage(provider, result, request.model),
      }
    }
    return
  }

  const request = suppliedRequest ?? buildRequest(provider, call, { stream: true })
  emitLocalUse(provider)
  const response = await send(provider, request, call.signal)
  rememberLocalChoice(provider, request.model)
  const pendingToolCalls = new Map<number, {
    id?: string
    name: string
    arguments: string
  }>()
  let toolStreamFinished = false
  const idleMs = machineLocalEndpoint(provider) ? 0 : STREAM_IDLE_MS
  const frames = sseFrames(response, call.signal, idleMs)
  const nextFrame = async (): Promise<IteratorResult<unknown>> => {
    try { return await frames.next() } catch (error) {
      if (!(error instanceof StreamStalledError)) throw error
      // 408: the host timed out on us — busy, in the plan's terms.
      throw new LlmDispatchError(`${provider.label} went silent: ${error.message}`, provider.id, request.model, 408)
    }
  }
  for (let step = await nextFrame(); !step.done; step = await nextFrame()) {
    const frame = step.value
    const decoded = provider.fromStreamEvent(frame)
    if (typeof decoded === 'string') {
      if (decoded) yield { text: decoded, model: request.model }
      continue
    }
    const frameUsage = attemptUsage(provider, decoded, request.model)
    if (decoded.text || frameUsage) yield { text: decoded.text ?? '', model: request.model, ...(frameUsage ? { usage: frameUsage } : {}) }
    if (decoded.finishReason === 'tool_calls') toolStreamFinished = true
    for (const delta of decoded.toolCallDeltas ?? []) {
      const pending = pendingToolCalls.get(delta.index) ?? { name: '', arguments: '' }
      if (delta.id !== undefined) pending.id = delta.id
      if (delta.name !== undefined) pending.name += delta.name
      if (delta.arguments !== undefined) pending.arguments += delta.arguments
      pendingToolCalls.set(delta.index, pending)
    }
  }
  // A cancelled or severed stream may already contain JSON that happens to
  // look complete. It is not a completed model turn and must never cross the
  // action boundary. OpenAI-shaped providers send a terminal finish_reason;
  // only then can accumulated function arguments become a normalized call.
  if (call.signal?.aborted) throw new DOMException('The model request was aborted', 'AbortError')
  if (pendingToolCalls.size > 0 && !toolStreamFinished) {
    throw new LlmDispatchError(
      `${provider.label} ended an incomplete tool call`, provider.id, request.model,
    )
  }
  const orderedToolCalls = [...pendingToolCalls.entries()]
    .sort(([left], [right]) => left - right)
  if (orderedToolCalls.some(([, call]) => !call.name.trim())) {
    throw new LlmDispatchError(
      `${provider.label} returned a malformed tool call`, provider.id, request.model,
    )
  }
  const toolCalls = orderedToolCalls.map(([, call]): LlmToolCall => ({
    ...(call.id !== undefined ? { id: call.id } : {}),
    name: call.name,
    arguments: call.arguments,
  }))
  if (toolCalls.length) {
    yield { text: '', toolCalls, model: request.model }
  }
}

const finite = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined

/** Keep only normalized token counts; provider payloads and error bodies never cross this seam. */
const attemptUsage = (provider: LlmProviderDescriptor, value: unknown, modelId: string): LlmAttemptUsage | undefined => {
  const source = value as { inputTokens?: unknown; outputTokens?: unknown; totalTokens?: unknown; usage?: unknown }
  const usage = (source.usage && typeof source.usage === 'object' ? source.usage : source) as {
    inputTokens?: unknown; outputTokens?: unknown; totalTokens?: unknown
    cacheReadTokens?: unknown; cacheWriteTokens?: unknown; reasoningTokens?: unknown
  }
  const inputTokens = finite(usage.inputTokens)
  const outputTokens = finite(usage.outputTokens)
  const totalTokens = finite(usage.totalTokens) ?? (inputTokens !== undefined && outputTokens !== undefined ? inputTokens + outputTokens : undefined)
  const cacheReadTokens = finite(usage.cacheReadTokens)
  const cacheWriteTokens = finite(usage.cacheWriteTokens)
  const reasoningTokens = finite(usage.reasoningTokens)
  if (inputTokens === undefined && outputTokens === undefined && totalTokens === undefined && cacheReadTokens === undefined && cacheWriteTokens === undefined && reasoningTokens === undefined) return undefined
  const out: LlmAttemptUsage = {
    ...(inputTokens !== undefined ? { inputTokens } : {}), ...(outputTokens !== undefined ? { outputTokens } : {}), ...(totalTokens !== undefined ? { totalTokens } : {}),
    ...(cacheReadTokens !== undefined ? { cacheReadTokens } : {}), ...(cacheWriteTokens !== undefined ? { cacheWriteTokens } : {}), ...(reasoningTokens !== undefined ? { reasoningTokens } : {}),
  }
  if (inputTokens !== undefined && outputTokens !== undefined && provider.models.length) {
    const model = provider.models.find(item => item.id === modelId)
    const inputRate = model?.inputPerMillion
    const outputRate = model?.outputPerMillion
    if (inputRate !== undefined && outputRate !== undefined) {
      return { ...out, estimatedCostUsd: (inputTokens * inputRate + outputTokens * outputRate) / 1_000_000, estimatedCost: true }
    }
  }
  return out
}

const attemptCategory = (error: unknown, status?: number): string => {
  if (status === 401 || status === 403) return 'unauthorized'
  if (status === 408 || status === 409 || status === 425 || status === 429 || (status !== undefined && status >= 500)) return 'transient'
  if (status !== undefined) return 'http'
  if (error instanceof DOMException && error.name === 'AbortError') return 'aborted'
  if (error instanceof LlmDispatchError) return 'provider'
  return 'network'
}

const safeObserve = (call: LlmCall, event: LlmAttemptEvent): void => {
  try { call.observeAttempt?.(event) } catch { /* telemetry must never change routing */ }
}

// A provider that just failed should not win every fresh automatic route and
// make each caller pay the same timeout. It is demoted, never banned: when all
// choices are cooling down they remain available in their original order.
const ROUTE_COOLDOWN_MS = 30_000
const MAX_ROUTE_ATTEMPTS = 3
const coolingUntil = new Map<string, number>()

// A VENDOR THAT SAYS "RETRY SHORTLY" IS TAKEN AT ITS WORD. When every choice
// fails busy — rate-limited or overloaded — before a word is out, the whole
// plan is tried again after a short wait: the longest Retry-After any of
// them sent, else ROUTE_RETRY_DELAY_MS doubling each pass, never past
// ROUTE_RETRY_MAX_WAIT_MS. Two free models sharing one upstream pool both
// answered 429 in the same second and the question was lost to it.
//
// THREE PASSES, NOT ONE (jwize's drive session, 2026-09-30): the long work
// asks a model a dozen times in a row, and one busy second in the middle of
// it must cost a few seconds of waiting, not the whole task.
//
// ...FOR A VENDOR THAT IS BUSY, NOT ONE THAT IS BROKEN (the review of that
// session's commits): three passes also turned a local model that cannot
// load — a 500 that says the same thing every time — into four asks and ten
// seconds before the participant saw the error. The busy answers keep the
// three; any other 5xx keeps the single retry it had before them
// (`retryPassesFor`). And a vendor that asks for longer than
// ROUTE_RETRY_MAX_WAIT_MS is not asked again inside the window it named:
// its own error is the answer, at once.
const ROUTE_RETRY_PASSES = 3
const ROUTE_RETRY_DELAY_MS = 1_500
const ROUTE_RETRY_MAX_WAIT_MS = 8_000

/** Busy, not broken: the same request may well succeed in a moment. Narrower
 *  than `isTransient` (which only decides cooling) — a refused key, a bad
 *  request, an unreachable local server or an empty answer are not worth
 *  asking again for. */
const isRetryWorthy = (error: unknown): boolean => {
  if (!(error instanceof LlmDispatchError)) return false
  if (isEmptyAnswer(error)) return true
  const status = error.status
  return status === 429 || status === 408 || (status !== undefined && status >= 500)
}

/** A REPLY WITH NO WORDS IN IT. Mid-work, a model sometimes comes back blank
 *  — four rounds into a task on hypercomb.io the fifth returned nothing and
 *  the whole turn ended with it (jwize's drive session, 2026-09-30). A blank
 *  is not an answer and not a refusal: the same question a moment later is a
 *  different roll, so it is asked once more, and only once. */
const EMPTY_ANSWER = 'returned no visible text'
const isEmptyAnswer = (error: unknown): boolean =>
  error instanceof LlmDispatchError && error.status === undefined && error.message.endsWith(EMPTY_ANSWER)

/** How many more passes a failure is worth. Rate-limited, timed out,
 *  unavailable, overloaded — the vendor said "busy", and earns every patient
 *  pass. Any other 5xx is asked once more and no further; nothing else is
 *  asked again at all. */
const retryPassesFor = (error: unknown): number => {
  if (!isRetryWorthy(error)) return 0
  if (isEmptyAnswer(error)) return 1
  const status = (error as LlmDispatchError).status
  return status === 429 || status === 408 || status === 503 || status === 529 ? ROUTE_RETRY_PASSES : 1
}

/** A router told to skip every host it may use: the ignore list emptied the
 *  route. OpenRouter says so with a 404 that names the step. */
const ignoredEveryHost = (error: unknown): boolean =>
  error instanceof LlmDispatchError && error.status === 404
  && /providers have been ignored|Filter by Ignored Providers/i.test(error.message)

const waitFor = (ms: number, signal?: AbortSignal): Promise<void> => new Promise(resolve => {
  if (ms <= 0 || signal?.aborted) { resolve(); return }
  const done = (): void => { clearTimeout(timer); signal?.removeEventListener('abort', done); resolve() }
  const timer = setTimeout(done, ms)
  signal?.addEventListener('abort', done, { once: true })
})

const isAbort = (error: unknown, signal?: AbortSignal): boolean =>
  !!signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')

const isTransient = (error: unknown): boolean => {
  if (!(error instanceof LlmDispatchError)) return true
  const status = error.status
  return status === undefined || status === 408 || status === 409 || status === 425
    || status === 429 || status >= 500
}

/** The ordered, callable attempt plan. Explicit provider/model choices do not
 * silently change vendor; automatic choices may fall through their policy-
 * ranked alternatives. */
export const routeCandidates = (
  call: Pick<LlmCall, 'providerId' | 'model' | 'preferModel' | 'need' | 'fallbackWithin' | 'avoid'>,
): LlmProviderDescriptor[] => {
  const explicit = !!call.providerId || !!call.model
  let candidates = explicit ? [resolveProvider(call)] : rankProviders(call.need ?? {})
  if (!explicit && call.avoid?.length) {
    const avoid = new Set(call.avoid.map(id => id.toLowerCase()))
    candidates = candidates.filter(provider => !avoid.has(provider.id.toLowerCase()))
  }
  if (!explicit && call.fallbackWithin) {
    const owner = call.fallbackWithin.toLowerCase()
    candidates = candidates.filter(provider => credentialOwner(provider).toLowerCase() === owner)
  }
  // Session stickiness is a preference, not authority. Reuse the previous
  // model only while its provider is still eligible for this request.
  if (!explicit && call.preferModel) {
    const sticky = registry().providerForModel(call.preferModel)
    const index = sticky ? candidates.findIndex(provider => provider.id === sticky.id) : -1
    // A HARDER OR SIMPLER QUESTION MAY CHANGE MODELS: the previous one keeps
    // its place only while it offers the weight of work now asked for, or the
    // provider the policy ranked first does not offer it either.
    const tier = call.need?.tier
    const offers = (provider: LlmProviderDescriptor): boolean => !tier || provider.models.some(model => model.tier === tier)
    if (index > 0 && (offers(candidates[index]) || !offers(candidates[0]))) {
      candidates = [candidates[index], ...candidates.slice(0, index), ...candidates.slice(index + 1)]
    }
  }
  const callable = candidates.filter(provider =>
    isCallable(provider)
    && (provider.transport !== 'peer-swarm' || !!peerCaller))
  if (explicit || callable.length < 2) return callable.slice(0, MAX_ROUTE_ATTEMPTS)

  const now = Date.now()
  const ready = callable.filter(provider => (coolingUntil.get(provider.id) ?? 0) <= now)
  const cooling = callable.filter(provider => (coolingUntil.get(provider.id) ?? 0) > now)
  return [...(ready.length ? ready : callable), ...(ready.length ? cooling : [])]
    .slice(0, MAX_ROUTE_ATTEMPTS)
}

/**
 * Route and stream with bounded fallbacks.
 *
 * Fallback is allowed only before a provider emits text or a tool call. Once
 * output is on screen or handed to a caller, switching models would splice
 * two answers into one turn. Abort is
 * always final. An empty successful response counts as a failed attempt —
 * this catches reasoning-only/incompatible responses instead of persisting a
 * blank assistant turn.
 */
export async function* streamRoutedModel(call: LlmCall): AsyncGenerator<LlmRoutedChunk> {
  const candidates = routeCandidates(call)
  if (!candidates.length) {
    throw new LlmDispatchError(
      'no callable AI provider is available for this request', call.providerId ?? '', call.model ?? '',
    )
  }

  const automatic = !call.providerId && !call.model
  const failures: string[] = []
  // A KEY THE VENDOR REFUSED (401/403) is refused for every model that pays
  // with it: models added through OpenRouter all borrow one key, so falling
  // to the next of them only repeats the same refusal.
  const refusedOwners = new Set<string>()
  let attempt = 0
  let lastError: unknown
  // THE HOST THAT WAS BUSY IS NOT ASKED AGAIN (jwize's Solomon chat,
  // 2026-09-28: one model, tried twice, the same upstream inside OpenRouter
  // overloaded both times). A busy answer that names its upstream puts that
  // host on the retry's ignore list, so the second pass routes the same
  // model through another host instead of back into the same queue.
  const busyUpstreams = new Set<string>(call.ignoreUpstreams ?? [])
  // ...UNLESS IT IS THE ONLY ROAD (the same drive session): an account that
  // allows one host for a model answers "all providers have been ignored"
  // when that host is skipped — a busy second turned into a dead turn. The
  // router said the ignore list cannot be honoured, so the same provider is
  // asked again plainly, at once, and is sent no ignore list for the rest
  // of this call; its busy host is then simply waited for.
  //
  // THE REFUSAL IS THAT CANDIDATE'S OWN. As one flag for the whole call it
  // switched route-around off for every other candidate too: a model with
  // several hosts, ranked beside a one-road model, went back into the busy
  // queue pass after pass. The busy list is shared and never cleared; who
  // may not be sent it is remembered by provider id.
  const ignoreRefusedBy = new Set<string>()
  for (let pass = 0; pass <= ROUTE_RETRY_PASSES; pass++) {
    // How many more passes THIS pass's failures are worth — the least any of
    // them earned, none once one cannot be helped by asking again — the
    // longest wait any vendor asked for before the next, and whether every
    // one of them asked for a wait past the cap with no other host to try.
    let tried = 0
    let patience = ROUTE_RETRY_PASSES
    let retryAfter: number | undefined
    let outOfReach = true
    // A BUSY SECOND IS NOT A REASON TO ASK A LESSER MODEL (jwize's drive
    // session, 2026-10-01): deepseek answered 429 "retry shortly" on a deep
    // turn, the next ranked choice was a 12B model that holds no deep tier,
    // and it chatted instead of working — a turn spent and called answered.
    // While passes remain, a model that offers the weight asked for and was
    // only busy is waited for; the step down is the last pass's, not the
    // first's.
    let busyAtTier = false
    const askedTier = call.need?.tier
    const offersTier = (provider: LlmProviderDescriptor): boolean =>
      !!askedTier && provider.models.some(model => model.tier === askedTier)
    for (let at = 0; at < candidates.length; at++) {
      const provider = candidates[at]
      if (refusedOwners.has(credentialOwner(provider))) continue
      if (automatic && busyAtTier && pass < ROUTE_RETRY_PASSES && !offersTier(provider)) break
      const passCall: LlmCall = ignoreRefusedBy.has(provider.id) ? { ...call, ignoreUpstreams: [] }
        : busyUpstreams.size ? { ...call, ignoreUpstreams: [...busyUpstreams] } : call
      tried += 1
      attempt += 1
      let emitted = false
      let usage: LlmAttemptUsage | undefined
      const startedAt = Date.now()
      let request: LlmRequest
      try {
        request = buildRequest(provider, passCall, { stream: !!provider.fromStreamEvent })
      } catch (error) {
        const model = call.model ?? provider.defaultModel
        safeObserve(call, { phase: 'start', attempt, providerId: provider.id, model, durationMs: 0, outputEmitted: false, category: 'start' })
        const dispatch = error instanceof LlmDispatchError ? error : undefined
        safeObserve(call, { phase: 'failure', attempt, providerId: provider.id, model, durationMs: Date.now() - startedAt, outputEmitted: false, category: attemptCategory(error, dispatch?.status), ...(dispatch?.status !== undefined ? { status: dispatch.status } : {}) })
        if (isAbort(error, call.signal) || !automatic) throw error
        const message = error instanceof Error ? error.message : String(error)
        failures.push(`${provider.label}: ${message}`)
        // A request that could not be built will not build next time either.
        patience = 0
        if (isTransient(error)) coolingUntil.set(provider.id, Date.now() + ROUTE_COOLDOWN_MS)
        if (dispatch?.status === 401 || dispatch?.status === 403) refusedOwners.add(credentialOwner(provider))
        EffectBus.emit('llm:route-fallback', { providerId: provider.id, message })
        continue
      }
      safeObserve(call, { phase: 'start', attempt, providerId: provider.id, model: request.model, durationMs: 0, outputEmitted: false, category: 'start' })
      let answeredModel = request.model
      try {
        for await (const chunk of streamProvider(provider, call, request)) {
          // Usage-only terminal frames are informative, not visible output and
          // must not disable automatic fallback or turn an empty answer into a
          // success.
          emitted = emitted || !!chunk.text || !!chunk.toolCalls?.length
          usage = chunk.usage
            ? attemptUsage(provider, { ...(usage ?? {}), ...chunk.usage }, request.model)
            : usage
          if (!chunk.text && !chunk.toolCalls?.length) continue
          answeredModel = chunk.model || answeredModel
          coolingUntil.delete(provider.id)
          yield {
            text: chunk.text,
            ...(chunk.toolCalls?.length ? { toolCalls: chunk.toolCalls } : {}),
            providerId: provider.id,
            providerLabel: provider.label,
            vendor: provider.vendor,
            model: chunk.model,
          }
        }
        if (!emitted) {
          throw new LlmDispatchError(
            `${provider.label} ${EMPTY_ANSWER}`, provider.id,
            call.model ?? modelForTier(provider, call.need?.tier ?? 'balanced'),
          )
        }
        safeObserve(call, { phase: 'success', attempt, providerId: provider.id, model: answeredModel, durationMs: Date.now() - startedAt, outputEmitted: emitted, category: 'success', ...(usage ? { usage } : {}) })
        return
      } catch (error) {
        const status = error instanceof LlmDispatchError ? error.status : undefined
        safeObserve(call, { phase: 'failure', attempt, providerId: provider.id, model: answeredModel, durationMs: Date.now() - startedAt, outputEmitted: emitted, category: attemptCategory(error, status), ...(status !== undefined ? { status } : {}), ...(usage ? { usage } : {}) })
        if (isAbort(error, call.signal) || emitted) throw error
        if (!ignoreRefusedBy.has(provider.id) && passCall.ignoreUpstreams?.length && ignoredEveryHost(error)) {
          ignoreRefusedBy.add(provider.id)
          tried -= 1
          at -= 1
          continue
        }
        // A NAMED provider never changes vendor — but a busy one is asked
        // again like any other, since that is the same vendor a moment
        // later. The chat names its granted provider on every turn, so
        // without this the retry only ever covered the route nobody takes.
        const worth = retryPassesFor(error)
        if (!automatic && pass >= worth) throw error
        lastError = error
        const message = error instanceof Error ? error.message : String(error)
        failures.push(`${provider.label}: ${message}`)
        patience = Math.min(patience, worth)
        if (worth && offersTier(provider)) busyAtTier = true
        const dispatch = error instanceof LlmDispatchError ? error : undefined
        const asked = dispatch?.retryAfterMs
        if (asked !== undefined) retryAfter = Math.max(retryAfter ?? 0, asked)
        const busyHost = worth ? dispatch?.upstream : undefined
        if (busyHost) busyUpstreams.add(busyHost)
        // A wait past the cap is out of reach — unless the next pass takes
        // this provider around the host that asked for it.
        outOfReach &&= asked !== undefined && asked > ROUTE_RETRY_MAX_WAIT_MS
          && !(busyHost && !ignoreRefusedBy.has(provider.id))
        if (isTransient(error)) coolingUntil.set(provider.id, Date.now() + ROUTE_COOLDOWN_MS)
        if (status === 401 || status === 403) refusedOwners.add(credentialOwner(provider))
        EffectBus.emit('llm:route-fallback', { providerId: provider.id, message })
      }
    }
    if (!tried || pass >= patience) break
    // EVERY CHOICE ASKED FOR LONGER THAN WE WILL WAIT. Waiting the cap and
    // asking again lands inside the window each vendor named — a near-certain
    // second refusal, eight seconds later, three times over. The failure is
    // the answer now. One choice that asked for less, or for nothing, keeps
    // the plan alive: it may well answer after the capped wait.
    if (outOfReach) break
    await waitFor(Math.min(retryAfter ?? ROUTE_RETRY_DELAY_MS * 2 ** pass, ROUTE_RETRY_MAX_WAIT_MS), call.signal)
    if (call.signal?.aborted) throw new DOMException('The model request was aborted', 'AbortError')
  }

  // A named provider's own last failure is the answer — it was the only one asked.
  if (!automatic && lastError) throw lastError
  // THE REMEDY, NOT ONLY THE FAILURE. One model switched on is one queue to
  // stand in; say so, so the next act is the right one.
  const remedy = candidates.length === 1
    ? ' Only one model is switched on; switch on another in the providers console so the work can move to it.'
    : ''
  throw new LlmDispatchError(
    `every eligible AI provider failed: ${failures.join(' | ')}${remedy}`,
    candidates[candidates.length - 1]?.id ?? '', call.model ?? '',
  )
}

/**
 * Ask a model and receive its answer in pieces. Yields text deltas only —
 * concatenating everything the generator yields gives the full answer.
 *
 * A provider that cannot stream yields once with the whole thing, so the
 * caller's loop is the same either way.
 */
export async function* streamModel(call: LlmCall): AsyncGenerator<string> {
  const provider = resolveProvider(call)
  for await (const chunk of streamProvider(provider, call)) {
    if (chunk.text) yield chunk.text
  }
}

/** Structural seam for shells that may not import essentials. */
export const LLM_ROUTER_IOC_KEY = '@diamondcoreprocessor.com/LlmRouter'
export const llmRouter = {
  /** Resolve a model without exposing the provider registry across the shell
   * boundary. The chat surface uses this to keep an explicitly named remote
   * model answer-only while granting grammar tools only to `local`. */
  providerIdForModel: (model: string): string | undefined =>
    registry().providerForModel(model)?.id,
  /** Published capacity for the exact model, when its provider declared it. */
  contextLengthForModel: (model: string): number | undefined => {
    const provider = registry().providerForModel(model)
    return provider?.models.find(candidate => candidate.id === model || candidate.name === model)?.contextLength
  },
  /** Execution authority depends on where the endpoint really is, never on a
   * provider's friendly id. In particular, changing the built-in `local`
   * host to a LAN or Internet URL must make it answer-only immediately. */
  providerIsMachineLocal: (providerId: string): boolean => {
    const provider = registry().get(providerId)
    return !!provider && !!machineLocalEndpoint(provider)
  },
  /** Stable endpoint identity for a privileged multi-round local exchange.
   * If the participant changes the configured loopback server mid-turn, the
   * caller drops the observation instead of disclosing it to another process. */
  providerMachineEndpoint: (providerId: string): string | undefined => {
    const provider = registry().get(providerId)
    return provider ? machineLocalEndpoint(provider) || undefined : undefined
  },
  /** Is there somebody who can answer RIGHT NOW? A machine-local provider is
   *  only counted while its server is answering — an explicit choice still
   *  reaches `routeCandidates`, so naming a stopped server attempts the call
   *  and gets the honest error rather than being quietly unavailable. */
  ready: (call: Pick<LlmCall, 'providerId' | 'model' | 'preferModel' | 'need' | 'avoid'> = {}): boolean => {
    try { return routeCandidates(call).some(provider => localModelServerUp(provider)) } catch { return false }
  },
  /** Why the silence, when there is one thing worth saying about it. A token,
   *  not a sentence: the shell owns the words. */
  reason: (): '' | 'local-down' | 'local-blocked' | 'local-permission' => {
    try { return localTierReason() } catch { return '' }
  },
  /** Who the mediator would pick for this need right now. The shell asks so
   *  it can tell whether that pick has been granted hive access before it
   *  attaches any tool (llm-hive-access.ts). */
  designatedProviderId: (need: ModelNeed = {}): string | undefined => {
    try { return chooseProvider(need)?.id } catch { return undefined }
  },
  /** Whose key, grant and budget a provider uses — its own id, or the
   *  configurator it came from (a model added through OpenRouter). */
  credentialOwnerOf: (providerId: string): string | undefined => {
    const provider = registry().get(providerId)
    return provider ? credentialOwner(provider) : undefined
  },
  stream: (call: LlmCall): AsyncGenerator<LlmRoutedChunk> => streamRoutedModel(call),
}
