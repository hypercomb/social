// assistant/providers/provider-spec.ts
//
// A PROVIDER AS DATA. The seven built-in vendors are code because each was
// written by hand; everything discovered from a domain must instead be a
// sig-addressed JSON resource — sharable, dedupable, verifiable — and this
// file is the compiler that turns one into a live `LlmProviderDescriptor`.
//
// The observation that makes this possible: almost every API on earth speaks
// one of THREE wire shapes. OpenAI's `/chat/completions` (spoken by xAI,
// DeepSeek, Mistral, Ollama, vLLM, LM Studio, Groq, Together, OpenRouter, …),
// Anthropic's `/v1/messages`, and Gemini's `generateContent`. A spec names a
// shape family, an endpoint, and how the key travels — and the adapter is the
// already-tested shared one. A vendor too odd for any family stays a code
// descriptor, which is what the code path is for.
//
// Two of the shapes are not HTTP at all. `agent-bridge` A frontier
// CLI parked on the broker (Claude Code, Codex, Gemini CLI, …) answers by
// reading the hive and writing notes, not by returning a response body — so
// its descriptor carries models, colour and honesty flags but no endpoint,
// and building an HTTP request from it THROWS. `scripts/bridge/
// bridge-agents.cjs` announces these after probing the machine's PATH; the
// ask path (llm.queen → the broker) is how they are actually reached.
//
// `peer-swarm` is the other: a model running on ANOTHER PARTICIPANT'S
// machine, offered to the swarm. It has no endpoint this client could dial —
// the request travels over the mesh and the offering peer answers with their
// own hardware — so building an HTTP request from it throws too. It differs
// from a bridge in the one way that matters to a caller: a peer CAN answer a
// normal call, so the dispatch routes it instead of refusing it.
//
// SECURITY POSTURE. A spec names an endpoint the participant's key will be
// sent to. The compiler therefore refuses non-HTTPS endpoints (localhost
// excepted — your own machine is the one place plaintext is fine), and the
// console shows the endpoint before the first call ever leaves. A spec can
// never carry a key, executable code, or a response transformer — the shape
// families are the only code that runs.

import { KNOWN_VENDORS, identifyModel } from '../../presentation/avatars/agent-model.js'
import type {
  LlmHttpRequest,
  LlmModelDescriptor,
  LlmProviderDescriptor,
  LlmRequest,
  LlmTier,
} from './llm-provider.types.js'
import { anthropicRequest, anthropicResponse, anthropicStreamEvent } from './anthropic.provider.js'
import { googleRequest, googleResponse, googleStreamEvent } from './google.provider.js'
import { openAiRequest, openAiResponse, openAiStreamEvent } from './openai-shape.js'

/** The format tag a spec must carry. Version bumps are NEW tags — a spec is
 *  content-addressed, so an old one can never be migrated in place, only
 *  superseded by a new resource. */
export const PROVIDER_SPEC_FORMAT = 'llm-provider@1'

/** How the key travels on the `openai` shape (the other two shapes carry
 *  their vendor's fixed header). A string names a well-known style; the
 *  object form names any header a gateway invented. */
export type LlmAuthStyle =
  | 'bearer'
  | 'x-api-key'
  | 'none'
  | { readonly header: string; readonly prefix?: string }

/** The JSON a domain publishes. Pure data — see the module comment. */
export type LlmProviderSpec = {
  readonly format: typeof PROVIDER_SPEC_FORMAT
  readonly id: string
  readonly label: string
  /** Colour family hint. Unknown/omitted → inferred from the default model,
   *  else `local`. Never trusted into the registry unvalidated. */
  readonly vendor?: string
  readonly shape: 'openai' | 'anthropic' | 'google' | 'agent-bridge' | 'peer-swarm'
  /** Which tier reaches this provider. Omitted = `browser-http`. */
  readonly transport?: 'browser-http' | 'agent-bridge' | 'peer-swarm'
  /** Required for the HTTP shapes; meaningless (and refused) for a bridge. */
  readonly endpoint?: string
  readonly auth?: LlmAuthStyle
  readonly models: readonly { name: string; id: string; tier?: LlmTier }[]
  readonly defaultModel: string
  readonly docsUrl: string
  readonly keyPattern?: string
  readonly requiresKey?: boolean
  /** Only an agent-bridge may claim it — the registry's honesty badge. */
  readonly readsHive?: boolean
  /** peer-swarm only: the pubkey of the participant whose machine runs it.
   *  What makes two peers' identically-named models distinct providers. */
  readonly peer?: string
}

const TIERS: readonly LlmTier[] = ['deep', 'balanced', 'fast']
const SHAPES = ['openai', 'anthropic', 'google', 'agent-bridge', 'peer-swarm'] as const

/** A bridge is reached through the broker, so it declares no endpoint, needs
 *  no key, and is the one tier allowed to say it reads the hive. */
const isBridgeShape = (shape: string): boolean => shape === 'agent-bridge'

/** A peer's model is reached over the mesh: no endpoint, no key, no hive. */
const isPeerShape = (shape: string): boolean => shape === 'peer-swarm'

/** Neither of the two shapes that name no address. */
const isAddressless = (shape: string): boolean => isBridgeShape(shape) || isPeerShape(shape)

const fail = (reason: string): never => {
  throw new Error(`[provider-spec] ${reason}`)
}

const cleanString = (value: unknown): string => String(value ?? '').trim()

/** Is this an endpoint a key may be sent to? HTTPS, or your own machine. */
const isAcceptableEndpoint = (url: string): boolean => {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'https:') return true
    if (parsed.protocol !== 'http:') return false
    return ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)
  } catch { return false }
}

/**
 * Validate untrusted JSON into a spec, or throw with the reason. Every check
 * the registry would make is made HERE first, plus the ones only a
 * data-sourced provider needs (endpoint scheme, pattern compilability) — a
 * spec that parses always compiles and always registers.
 */
export const parseProviderSpec = (json: unknown): LlmProviderSpec => {
  const raw = (typeof json === 'string' ? JSON.parse(json) : json) as Record<string, unknown>
  if (!raw || typeof raw !== 'object') fail('spec must be a JSON object')
  if (raw['format'] !== PROVIDER_SPEC_FORMAT) {
    fail(`format must be "${PROVIDER_SPEC_FORMAT}" (got "${String(raw['format'] ?? '')}")`)
  }

  const id = cleanString(raw['id']).toLowerCase()
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(id)) fail(`id "${id}" must be a short lowercase slug`)
  const label = cleanString(raw['label'])
  if (!label) fail(`spec "${id}" must declare a label`)

  const shape = cleanString(raw['shape']) as LlmProviderSpec['shape']
  if (!SHAPES.includes(shape)) fail(`spec "${id}" shape must be one of ${SHAPES.join(', ')}`)

  // A BRIDGE HAS NO ENDPOINT. Refusing one is not pedantry: an endpoint on a
  // bridge spec would be an address nothing ever dials, and the console shows
  // endpoints as "where your key goes" — a bridge that appears to name one
  // would be lying about a key it never takes.
  const bridge = isBridgeShape(shape)
  const peer = isPeerShape(shape)
  const addressless = isAddressless(shape)
  const endpoint = cleanString(raw['endpoint'])
  if (addressless) {
    if (endpoint) fail(`spec "${id}" is a ${shape} and must not declare an endpoint`)
  } else if (!isAcceptableEndpoint(endpoint)) {
    fail(`spec "${id}" endpoint must be https (or http on localhost) — got "${endpoint}"`)
  }

  const docsUrl = cleanString(raw['docsUrl'])
  if (!docsUrl) fail(`spec "${id}" must declare a docsUrl`)

  const modelsRaw = Array.isArray(raw['models']) ? raw['models'] : fail(`spec "${id}" must declare models`)
  const models = (modelsRaw as unknown[]).map((entry): LlmProviderSpec['models'][number] => {
    const m = (entry ?? {}) as Record<string, unknown>
    const modelId = cleanString(m['id'])
    const name = cleanString(m['name']) || modelId
    if (!modelId) fail(`spec "${id}" has a model without an id`)
    const tier = cleanString(m['tier']) as LlmTier
    return { name, id: modelId, ...(TIERS.includes(tier) ? { tier } : {}) }
  })
  if (!models.length) fail(`spec "${id}" must declare at least one model`)

  const defaultModel = cleanString(raw['defaultModel']) || models[0].id
  if (!models.some(m => m.id === defaultModel)) {
    fail(`spec "${id}" defaultModel "${defaultModel}" is not one of its models`)
  }

  const keyPattern = cleanString(raw['keyPattern'])
  if (keyPattern) {
    try { new RegExp(keyPattern) } catch { fail(`spec "${id}" keyPattern does not compile`) }
  }

  const expectedTransport = bridge ? 'agent-bridge' : peer ? 'peer-swarm' : 'browser-http'
  const transport = cleanString(raw['transport']) || expectedTransport
  if (transport !== expectedTransport) {
    fail(`spec "${id}" transport "${transport}" does not match shape "${shape}"`)
  }
  // A peer's model runs on a named participant's machine; without the pubkey
  // there is nobody to send the request to, and two peers offering `llama`
  // would collapse into one row.
  const peerKey = cleanString(raw['peer']).toLowerCase()
  if (peer && !/^[0-9a-f]{64}$/.test(peerKey)) {
    fail(`spec "${id}" is a peer-swarm offer and must name the peer's pubkey`)
  }
  if (!peer && peerKey) fail(`spec "${id}" may not name a peer — only a peer-swarm offer runs on one`)
  // Only the bridge tier may wear the honesty badge — an HTTP vendor claiming
  // it would be telling the participant their key can walk the tree.
  if (raw['readsHive'] === true && !bridge) {
    fail(`spec "${id}" may not claim readsHive — only an agent-bridge reads the hive`)
  }

  const auth = raw['auth'] as LlmAuthStyle | undefined
  if (auth !== undefined) {
    if (addressless) fail(`spec "${id}" is a ${shape} and takes no auth`)
    const named = typeof auth === 'string' && ['bearer', 'x-api-key', 'none'].includes(auth)
    const custom = !!auth && typeof auth === 'object' && !!cleanString((auth as { header?: string }).header)
    if (!named && !custom) fail(`spec "${id}" auth must be bearer | x-api-key | none | { header }`)
  }

  return {
    format: PROVIDER_SPEC_FORMAT,
    id,
    label,
    ...(cleanString(raw['vendor']) ? { vendor: cleanString(raw['vendor']).toLowerCase() } : {}),
    shape,
    transport: expectedTransport,
    ...(addressless ? {} : { endpoint: endpoint.replace(/\/+$/, '') }),
    ...(peer ? { peer: peerKey } : {}),
    ...(auth !== undefined ? { auth } : {}),
    models,
    defaultModel,
    docsUrl,
    ...(keyPattern ? { keyPattern } : {}),
    ...(addressless || raw['requiresKey'] === false ? { requiresKey: false } : {}),
    ...(bridge ? { readsHive: true } : {}),
  }
}

/** The auth header builder for one openai-shape spec. */
const authHeaderOf = (spec: LlmProviderSpec): ((apiKey: string) => Record<string, string>) => {
  const auth = spec.auth ?? (spec.requiresKey === false ? 'none' : 'bearer')
  if (auth === 'none') return () => ({})
  if (auth === 'x-api-key') return apiKey => (apiKey ? { 'x-api-key': apiKey } : {} as Record<string, string>)
  if (auth === 'bearer') return apiKey => (apiKey ? { Authorization: `Bearer ${apiKey}` } : {} as Record<string, string>)
  const { header, prefix = '' } = auth
  return apiKey => (apiKey ? { [header]: `${prefix}${apiKey}` } : {} as Record<string, string>)
}

/** A vendor family the palette actually knows — never trusted raw. The
 *  registry throws on an unknown family, and a spec's author cannot edit
 *  VENDOR_BODY, so an unmatched spec lands in `local` (something running
 *  outside the named frontier vendors) rather than being refused. */
const vendorOf = (spec: LlmProviderSpec): string => {
  if (spec.vendor && KNOWN_VENDORS.includes(spec.vendor)) return spec.vendor
  const inferred = identifyModel(spec.defaultModel).vendor
  return KNOWN_VENDORS.includes(inferred) ? inferred : 'local'
}

/** Fill each model's tier where the spec left it out, by name pattern. */
const modelsOf = (spec: LlmProviderSpec): LlmModelDescriptor[] =>
  spec.models.map(m => ({ name: m.name, id: m.id, tier: m.tier ?? identifyModel(m.id).tier }))

/**
 * Spec → live descriptor. The result is indistinguishable from a hand-written
 * vendor file as far as the registry, the dispatch, and every UI surface are
 * concerned — that indistinguishability is the whole plug-in architecture.
 */
export const compileProviderSpec = (spec: LlmProviderSpec): LlmProviderDescriptor => {
  const bridge = spec.shape === 'agent-bridge'
  const peer = spec.shape === 'peer-swarm'
  const base: Omit<LlmProviderDescriptor, 'toRequest' | 'fromResponse' | 'fromStreamEvent'> = {
    id: spec.id,
    label: spec.label,
    vendor: vendorOf(spec),
    transport: bridge ? 'agent-bridge' : peer ? 'peer-swarm' : 'browser-http',
    ...(spec.endpoint ? { endpoint: spec.endpoint } : {}),
    models: modelsOf(spec),
    defaultModel: spec.defaultModel,
    docsUrl: spec.docsUrl,
    ...(spec.keyPattern ? { keyPattern: new RegExp(spec.keyPattern) } : {}),
    ...(bridge || peer || spec.requiresKey === false ? { requiresKey: false } : {}),
    ...(bridge ? { readsHive: true } : {}),
    ...(peer && spec.peer ? { peer: spec.peer } : {}),
  }

  if (peer) {
    // A PEER'S MODEL IS NOT AT AN ADDRESS THIS CLIENT CAN DIAL. The request
    // goes over the mesh to the participant running it, so these two throw —
    // but unlike a bridge, the dispatch does not stop here: it hands the call
    // to the peer transport, which is why the message says "over the swarm"
    // rather than "ask it a different way".
    const refuse = (): never => {
      throw new Error(
        `[${spec.id}] runs on another participant's machine: it is answered over the swarm, ` +
        `not by an HTTP request`,
      )
    }
    return { ...base, toRequest: refuse, fromResponse: refuse }
  }

  if (bridge) {
    // A BRIDGE IS NOT FETCHABLE. It answers by reading the hive and writing
    // back over the broker, which is the ask path — so these two throw rather
    // than inventing a URL. `llm-dispatch` keeps bridges out of the implicit
    // roster and gives a caller that names one explicitly this message.
    const refuse = (): never => {
      throw new Error(
        `[${spec.id}] is an agent-bridge: ask it through the bridge (a question from the ` +
        `command line, or an ask record) — it cannot be called over HTTP`,
      )
    }
    return { ...base, toRequest: refuse, fromResponse: refuse }
  }

  if (spec.shape === 'anthropic') {
    return {
      ...base,
      toRequest: request => anthropicRequest(String(spec.endpoint), request),
      fromResponse: anthropicResponse,
      fromStreamEvent: anthropicStreamEvent,
    }
  }
  if (spec.shape === 'google') {
    return {
      ...base,
      toRequest: request => googleRequest(String(spec.endpoint), request),
      fromResponse: googleResponse,
      fromStreamEvent: googleStreamEvent,
    }
  }
  const authHeader = authHeaderOf(spec)
  const endpoint = String(spec.endpoint)
  const url = /\/chat\/completions$/.test(endpoint) ? endpoint : `${endpoint}/chat/completions`
  return {
    ...base,
    toRequest: (request: LlmRequest): LlmHttpRequest => openAiRequest(url, request, authHeader),
    fromResponse: openAiResponse,
    fromStreamEvent: openAiStreamEvent,
  }
}
