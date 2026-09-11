// assistant/providers/local.provider.ts
//
// A MODEL RUNNING ON YOUR OWN MACHINE. Ollama serves the OpenAI shape on
// localhost:11434, so the adapter is the shared one — but two fields make
// this descriptor different in kind from the six vendor ones:
//
//   requiresKey: false   there is nobody to bill, so there is no key to ask
//                        for, and the guided-setup step is skipped entirely.
//   endpoint             a HOST the participant may move. The override lives
//                        in localStorage, never in a layer — the address of
//                        someone's own machine is device-local truth in the
//                        same way a credential is.
//
// The model list is a starting suggestion, not a catalog: what is installed
// is whatever the participant pulled, and `resolveModelId` passes an
// unrecognised name straight through for exactly this case.

import { registerLlmProvider } from '../llm-provider-registry.js'
import type { LlmProviderDescriptor } from './llm-provider.types.js'
import { openAiRequest, openAiResponse, openAiStreamEvent } from './openai-shape.js'

export const LOCAL_HOST_STORAGE_KEY = 'hc:llm:local:host'

// 127.0.0.1, NOT localhost. On Windows `localhost` resolves to ::1 first and
// Ollama binds 127.0.0.1 only, so the friendlier spelling is the one that
// hangs: the fetch waits out a dead IPv6 connection before anything else can
// happen, and the participant sees "not running" for a server that is running
// fine. The numeric address is the one the server actually printed.
const DEFAULT_HOST = 'http://127.0.0.1:11434'

/** Every loopback spelling a local server might be listening on, in the order
 *  worth trying. The probe (local-liveness.ts) walks these ONLY when the
 *  primary answers nothing and the participant has set no address of their
 *  own — a server bound to ::1 is rare, and never worth a second request once
 *  the first one works. */
export const LOCAL_HOST_CANDIDATES: readonly string[] = [
  'http://127.0.0.1:11434',
  'http://localhost:11434',
  'http://[::1]:11434',
]

/** Where the probe last found a server, when the participant named none.
 *  Device-local like the override itself, and never allowed to outrank it. */
const FOUND_HOST_KEY = 'hc:llm:local:host:found'

const read = (key: string): string => {
  try { return (globalThis.localStorage?.getItem(key) ?? '').trim().replace(/\/+$/, '') }
  catch { return '' }
}

/** Has the participant named the address themselves? Their answer is final —
 *  discovery may never overwrite it. */
export const hasExplicitLocalHost = (): boolean => !!read(LOCAL_HOST_STORAGE_KEY)

/** The participant's local server: what they typed, else where one was last
 *  found, else the default port. */
export const localLlmHost = (): string =>
  read(LOCAL_HOST_STORAGE_KEY) || read(FOUND_HOST_KEY) || DEFAULT_HOST

/** The probe found a server at this spelling. Remembered so the next boot
 *  asks the right door first — never written over a participant's own. */
export const rememberLocalLlmHost = (host: string): void => {
  const found = String(host ?? '').trim().replace(/\/+$/, '')
  if (!found || hasExplicitLocalHost()) return
  try { globalThis.localStorage?.setItem(FOUND_HOST_KEY, found) } catch { /* session-only */ }
}

export const LOCAL_PROVIDER: LlmProviderDescriptor = {
  id: 'local',
  label: 'Local model',
  vendor: 'local',
  transport: 'browser-http',
  endpoint: DEFAULT_HOST,
  requiresKey: false,
  // Keep the built-in local choice conservative: it must fit wholly in the
  // common 8 GB GPU tier and produce visible output through Ollama's OpenAI
  // compatibility endpoint. Larger or reasoning-first models can still be
  // addressed explicitly; resolveModelId deliberately passes unknown ids
  // through to Ollama.
  models: [
    { name: 'qwen-coder', id: 'qwen2.5-coder:7b', tier: 'fast' },
  ],
  defaultModel: 'qwen2.5-coder:7b',
  docsUrl: 'https://ollama.com/download',
  // No Authorization header: a local server has no account behind it, and
  // sending `Bearer ` with an empty key makes some builds reject the call.
  //
  // THREE KNOBS ONLY THIS PROVIDER HONOURS. A thinking model spends 197–4000
  // tokens reasoning before it answers, and a structured answer under a token
  // cap then arrives empty; `reasoning_effort: 'none'` turned a 2.9 s call into
  // 0.13 s on qwen3:8b through Ollama's OpenAI layer, and `response_format`
  // holds the answer to the schema the caller validates anyway
  // (documentation/chat-route.md §4.1.2). They are added to the shared body
  // here and nowhere else, so a request that sets none of them is byte for
  // byte what it was, and no other vendor's body ever carries them.
  toRequest: request => {
    const http = openAiRequest(`${localLlmHost()}/v1/chat/completions`, request, () => ({}))
    if (request.thinking !== false && !request.jsonSchema && request.temperature === undefined) return http
    const body = JSON.parse(String(http.init.body)) as Record<string, unknown>
    if (request.thinking === false) body['reasoning_effort'] = 'none'
    if (request.jsonSchema) body['response_format'] = { type: 'json_schema', json_schema: { name: 'answer', schema: request.jsonSchema } }
    if (request.temperature !== undefined) body['temperature'] = request.temperature
    return { url: http.url, init: { ...http.init, body: JSON.stringify(body) } }
  },
  fromResponse: openAiResponse,
  fromStreamEvent: openAiStreamEvent,
}

registerLlmProvider(LOCAL_PROVIDER)
