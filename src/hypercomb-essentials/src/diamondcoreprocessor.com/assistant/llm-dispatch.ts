// diamondcoreprocessor.com/assistant/llm-dispatch.ts
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
import { chooseProvider, modelForTier, rankProviders, type ModelNeed } from './model-policy.js'
import { llmProviderRegistry, type LlmProviderRegistry } from './llm-provider-registry.js'
import './providers/builtin-providers.js'
import type {
  LlmCallResult,
  LlmChatMessage,
  LlmProviderDescriptor,
  LlmRequest,
} from './providers/llm-provider.types.js'

export type {
  LlmCallResult,
  LlmChatMessage,
  LlmModelDescriptor,
  LlmProviderDescriptor,
  LlmRequest,
  LlmTier,
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
  /** Hint that `system` is stable and worth prompt-caching where supported. */
  readonly cacheSystem?: boolean
  readonly signal?: AbortSignal
}

/** One routed stream delta, carrying the truth about who actually answered. */
export type LlmRoutedChunk = {
  readonly text: string
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
  ) {
    super(message)
    this.name = 'LlmDispatchError'
  }
}

const MAX_ERROR_BODY = 600

const registry = (): LlmProviderRegistry => llmProviderRegistry()

/** Can this seam answer with this provider at all? An `agent-bridge` cannot:
 *  it answers through the broker (an ask record a parked CLI drains), so it
 *  belongs to the ask path. A `peer-swarm` provider CAN — not by fetch, but
 *  by asking the participant whose machine runs it — so it stays callable and
 *  is routed below. Keeping the test here means one definition of "callable"
 *  for the roster and the resolver both. */
const isCallable = (provider: LlmProviderDescriptor): boolean =>
  provider.transport !== 'agent-bridge'

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
    && (p.requiresKey === false || llmKeyStore.has(p.id)))

/** Every ACTIVE provider whatever its transport — what the orchestrator picks
 *  from when it is choosing WHO answers rather than building a fetch. Bridges
 *  belong here: they are the only tier that can read the hive. */
export const activeProviders = (): LlmProviderDescriptor[] =>
  registry().all().filter(p =>
    llmActivation.isEnabled(p.id)
    && (!isCallable(p) || p.requiresKey === false || llmKeyStore.has(p.id)))

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
  const apiKey = needsKey ? llmKeyStore.get(provider.id) : ''
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
    cacheSystem: call.cacheSystem,
    stream: options.stream === true,
    apiKey,
  }
}

const send = async (
  provider: LlmProviderDescriptor,
  request: LlmRequest,
  signal?: AbortSignal,
): Promise<Response> => {
  const { url, init } = provider.toRequest(request)
  const response = await fetch(url, { ...init, signal })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new LlmDispatchError(
      `${provider.label} API ${response.status}: ${body.slice(0, MAX_ERROR_BODY)}`,
      provider.id,
      request.model,
      response.status,
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
  if (provider.requiresKey === false && provider.transport === 'browser-http') {
    EffectBus.emit('llm:local-used', { providerId: provider.id })
  }

  const response = await send(provider, request, call.signal)
  return provider.fromResponse(await response.json(), request)
}

/**
 * SSE line framing. One `data:` payload per event; `[DONE]` ends the stream
 * (OpenAI's convention, which the shape-sharers inherited). Frames that fail
 * to parse are skipped rather than fatal — a keep-alive comment or a partial
 * flush must not kill a running answer.
 */
async function* sseFrames(response: Response, signal?: AbortSignal): AsyncGenerator<unknown> {
  const reader = response.body?.getReader()
  if (!reader) return
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (!signal?.aborted) {
      const { done, value } = await reader.read()
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

const emitLocalUse = (provider: LlmProviderDescriptor): void => {
  if (provider.requiresKey === false && provider.transport === 'browser-http') {
    EffectBus.emit('llm:local-used', { providerId: provider.id })
  }
}

/** Stream one already-selected provider. Selection and fallback live above it. */
async function* streamProvider(
  provider: LlmProviderDescriptor,
  call: LlmCall,
): AsyncGenerator<{ text: string; model: string }> {
  if (provider.transport === 'peer-swarm' || !provider.fromStreamEvent) {
    const request = buildRequest(provider, call)
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
      result = provider.fromResponse(await response.json(), request)
    }
    if (result.text) yield { text: result.text, model: result.model || request.model }
    return
  }

  const request = buildRequest(provider, call, { stream: true })
  emitLocalUse(provider)
  const response = await send(provider, request, call.signal)
  for await (const frame of sseFrames(response, call.signal)) {
    const delta = provider.fromStreamEvent(frame)
    if (delta) yield { text: delta, model: request.model }
  }
}

// A provider that just failed should not win every fresh automatic route and
// make each caller pay the same timeout. It is demoted, never banned: when all
// choices are cooling down they remain available in their original order.
const ROUTE_COOLDOWN_MS = 30_000
const MAX_ROUTE_ATTEMPTS = 3
const coolingUntil = new Map<string, number>()

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
  call: Pick<LlmCall, 'providerId' | 'model' | 'preferModel' | 'need'>,
): LlmProviderDescriptor[] => {
  const explicit = !!call.providerId || !!call.model
  let candidates = explicit ? [resolveProvider(call)] : rankProviders(call.need ?? {})
  // Session stickiness is a preference, not authority. Reuse the previous
  // model only while its provider is still eligible for this request.
  if (!explicit && call.preferModel) {
    const sticky = registry().providerForModel(call.preferModel)
    const index = sticky ? candidates.findIndex(provider => provider.id === sticky.id) : -1
    if (index > 0) candidates = [candidates[index], ...candidates.slice(0, index), ...candidates.slice(index + 1)]
  }
  const callable = candidates.filter(provider =>
    provider.transport !== 'agent-bridge'
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
 * Fallback is allowed only before a provider emits text. Once bytes are on
 * screen, switching models would splice two answers into one turn. Abort is
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
  for (const provider of candidates) {
    let emitted = false
    try {
      for await (const chunk of streamProvider(provider, call)) {
        emitted = true
        coolingUntil.delete(provider.id)
        yield {
          text: chunk.text,
          providerId: provider.id,
          providerLabel: provider.label,
          vendor: provider.vendor,
          model: chunk.model,
        }
      }
      if (!emitted) {
        throw new LlmDispatchError(
          `${provider.label} returned no visible text`, provider.id,
          call.model ?? modelForTier(provider, call.need?.tier ?? 'balanced'),
        )
      }
      return
    } catch (error) {
      if (isAbort(error, call.signal) || emitted || !automatic) throw error
      const message = error instanceof Error ? error.message : String(error)
      failures.push(`${provider.label}: ${message}`)
      if (isTransient(error)) coolingUntil.set(provider.id, Date.now() + ROUTE_COOLDOWN_MS)
      EffectBus.emit('llm:route-fallback', { providerId: provider.id, message })
    }
  }

  throw new LlmDispatchError(
    `every eligible AI provider failed: ${failures.join(' | ')}`,
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
  for await (const chunk of streamProvider(provider, call)) yield chunk.text
}

/** Structural seam for shells that may not import essentials. */
export const LLM_ROUTER_IOC_KEY = '@diamondcoreprocessor.com/LlmRouter'
export const llmRouter = {
  ready: (call: Pick<LlmCall, 'providerId' | 'model' | 'preferModel' | 'need'> = {}): boolean => {
    try { return routeCandidates(call).length > 0 } catch { return false }
  },
  stream: (call: LlmCall): AsyncGenerator<LlmRoutedChunk> => streamRoutedModel(call),
}
window.ioc?.register?.(LLM_ROUTER_IOC_KEY, llmRouter)
