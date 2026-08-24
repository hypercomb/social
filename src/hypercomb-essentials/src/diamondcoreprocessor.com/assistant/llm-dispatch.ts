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

import { llmKeyStore } from '@hypercomb/core'
import { llmActivation } from './llm-activation.js'
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
  /** Provider id. Omitted → inferred from `model`, else the only configured one. */
  readonly providerId?: string
  /** Wire id or the descriptor's human name (`opus`, `gemini`). */
  readonly model?: string
  readonly messages: readonly LlmChatMessage[]
  readonly system?: string
  readonly maxTokens?: number
  /** Hint that `system` is stable and worth prompt-caching where supported. */
  readonly cacheSystem?: boolean
  readonly signal?: AbortSignal
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

/** Can this provider be reached by `fetch` at all? An `agent-bridge` cannot:
 *  it answers through the broker (an ask record a parked CLI drains), so it
 *  belongs to the ask path, never to this seam. Keeping the test here means
 *  one definition of "callable" for the roster and the resolver both. */
const isCallable = (provider: LlmProviderDescriptor): boolean =>
  provider.transport !== 'agent-bridge'

/** The roster that can answer HTTP calls: reachable by fetch, has a key (or
 *  needs none), AND has not been switched off in the providers console.
 *  Naming a provider or a model explicitly still wins over the activation
 *  filter — an explicit ask is the participant overriding their own default,
 *  not the orchestrator choosing. */
export const configuredProviders = (): LlmProviderDescriptor[] =>
  registry().all().filter(p =>
    isCallable(p) && llmActivation.isEnabled(p.id)
    && (p.requiresKey === false || llmKeyStore.has(p.id)))

/** Every ACTIVE provider whatever its transport — what the orchestrator picks
 *  from when it is choosing WHO answers rather than building a fetch. Bridges
 *  belong here: they are the only tier that can read the hive. */
export const activeProviders = (): LlmProviderDescriptor[] =>
  registry().all().filter(p =>
    llmActivation.isEnabled(p.id)
    && (!isCallable(p) || p.requiresKey === false || llmKeyStore.has(p.id)))

/**
 * Which provider answers this call. In order: the id the caller named, the
 * provider that owns the named model, the single configured provider if there
 * is exactly one, then anthropic as the historical default.
 */
export const resolveProvider = (call: Pick<LlmCall, 'providerId' | 'model'>): LlmProviderDescriptor => {
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

  const configured = configuredProviders()
  if (configured.length === 1) return configured[0]

  const fallback = reg.get('anthropic') ?? configured[0] ?? reg.all()[0]
  if (!fallback) {
    throw new LlmDispatchError('no LLM providers registered', '', call.model ?? '')
  }
  return fallback
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
    model: registry().resolveModelId(provider, call.model),
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

/** Ask a model. The normalized answer, whoever answered it. */
export const callModel = async (call: LlmCall): Promise<LlmCallResult> => {
  const provider = resolveProvider(call)
  const request = buildRequest(provider, call)
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

/**
 * Ask a model and receive its answer in pieces. Yields text deltas only —
 * concatenating everything the generator yields gives the full answer.
 *
 * A provider that cannot stream yields once with the whole thing, so the
 * caller's loop is the same either way.
 */
export async function* streamModel(call: LlmCall): AsyncGenerator<string> {
  const provider = resolveProvider(call)
  if (!provider.fromStreamEvent) {
    const result = await callModel(call)
    if (result.text) yield result.text
    return
  }
  const request = buildRequest(provider, call, { stream: true })
  const response = await send(provider, request, call.signal)
  for await (const frame of sseFrames(response, call.signal)) {
    const delta = provider.fromStreamEvent(frame)
    if (delta) yield delta
  }
}
