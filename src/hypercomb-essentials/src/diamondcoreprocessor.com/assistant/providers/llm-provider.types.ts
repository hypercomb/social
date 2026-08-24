// diamondcoreprocessor.com/assistant/providers/llm-provider.types.ts
//
// ONE DESCRIPTOR, THREE TRANSPORTS — the shape every AI vendor is declared in.
//
// The repo already had three AI paths that shared nothing but a model-name
// string: a direct browser fetch with the participant's key, a NIP-98 POST to
// a host relay, and an ask record minted for a parked agent session. They are
// not competing designs; they are three TRANSPORT CLASSES of the same thing,
// and once `transport` is a field, everything else is one registry over it.
//
// A descriptor is DATA plus two small pure functions. `toRequest` says how
// this vendor wants to be asked, `fromResponse` says how to read its answer
// back into the one normalized result the rest of the app knows. Nothing else
// in the codebase may know an endpoint, a header name, or a response shape —
// that knowledge lives here and only here, one file per vendor.
//
// COLOUR IS NOT DECLARED HERE. `vendor` keys into VENDOR_BODY in
// presentation/avatars/agent-model.ts, which is the single source of vendor
// colour in this repo (a model bee, a provider tile, and a picker chip must
// all be the same clay/teal/sky). A second palette would be two answers to
// "whose model is that", so the registry rejects a vendor that file does not
// know by name.

/** How this provider is reached. See the module comment. */
export type LlmTransport =
  /** Direct fetch from the browser with the participant's own key. */
  | 'browser-http'
  /** Signed POST to a host the participant named; the host holds the key. */
  | 'host-relay'
  /** An ask record a parked agent session answers — the only tier that can READ THE HIVE. */
  | 'agent-bridge'
  /**
   * A MODEL ON SOMEBODY ELSE'S MACHINE, offered to the swarm. The request
   * travels over the mesh to the participant who runs it; they answer with
   * their own hardware and send the text back. No key, no endpoint you can
   * reach, and no hive access — and unlike every other tier, whether it can
   * answer at all depends on somebody else being awake and not busy.
   */
  | 'peer-swarm'

/** How heavy a model is within its vendor's line-up. Mirrors ModelTier. */
export type LlmTier = 'deep' | 'balanced' | 'fast'

/** One turn of a conversation. */
export type LlmChatMessage = { role: 'user' | 'assistant'; content: string }

/** A model this provider offers. `id` is the wire name, `name` the human one. */
export type LlmModelDescriptor = {
  readonly name: string
  readonly id: string
  readonly tier: LlmTier
}

/** Everything an adapter needs to build one request. */
export type LlmRequest = {
  /** Wire model id (already resolved from any alias). */
  readonly model: string
  readonly messages: readonly LlmChatMessage[]
  readonly system?: string
  readonly maxTokens?: number
  /** Ask the vendor to stream. Only meaningful with `fromStreamEvent`. */
  readonly stream?: boolean
  /**
   * Hint that the system prompt is stable across calls and worth caching.
   * Vendors that support prompt caching act on it; the rest ignore it.
   */
  readonly cacheSystem?: boolean
  /** The participant's key. `''` for transports that need none. */
  readonly apiKey: string
}

/** The one answer shape the rest of the app knows. */
export type LlmCallResult = {
  readonly text: string
  readonly stopReason: string
  readonly inputTokens: number
  readonly outputTokens: number
  readonly model: string
}

/** What an adapter builds: where to send it, and how. */
export type LlmHttpRequest = { readonly url: string; readonly init: RequestInit }

export type LlmProviderDescriptor = {
  /** Registry key. `'anthropic'`, `'openai'`, `'google'`, `'xai'`, … */
  readonly id: string

  /** What a participant calls it. `'Claude'`, `'ChatGPT'`, `'Gemini'`, … */
  readonly label: string

  /**
   * Colour family. MUST be a vendor `agent-model.ts` knows (KNOWN_VENDORS) —
   * the registry throws otherwise, so no surface can mint a second palette.
   */
  readonly vendor: string

  readonly transport: LlmTransport

  /** Base endpoint. Informational for transports that compute their own URL. */
  readonly endpoint?: string

  readonly models: readonly LlmModelDescriptor[]

  /** Wire id of the model used when the caller names none. Must be in `models`. */
  readonly defaultModel: string

  /** "Get your key here" — the link the guided setup shows. */
  readonly docsUrl: string

  /** Sanity-check a pasted key before spending a request on it. */
  readonly keyPattern?: RegExp

  /**
   * Whether this provider needs a key at all. Default true. A local model
   * (Ollama) and the host-relay tier do not.
   */
  readonly requiresKey?: boolean

  /**
   * HONESTY FLAG. Only `agent-bridge` responders can walk the participant's
   * tree; a browser-http key answers from the prompt plus whatever context
   * the ask carries. The picker badges this — it must never be implied.
   */
  readonly readsHive?: boolean

  /**
   * `peer-swarm` only: the pubkey of the participant whose machine answers.
   * Identity, not decoration — it is the address the request is sent to, and
   * what keeps two peers offering the same model from collapsing into one
   * provider.
   */
  readonly peer?: string

  /** Build the HTTP request for one call. Pure. */
  toRequest(request: LlmRequest): LlmHttpRequest

  /** Read this vendor's JSON body into the normalized result. Pure. */
  fromResponse(json: unknown, request: LlmRequest): LlmCallResult

  /**
   * Decode one SSE `data:` payload into the text it adds, or `''` for the
   * frames that carry no text. Absent = this provider does not stream, and
   * the dispatch falls back to one non-streaming call.
   */
  fromStreamEvent?(event: unknown): string
}
