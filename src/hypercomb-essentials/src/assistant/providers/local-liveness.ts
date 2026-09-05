// assistant/providers/local-liveness.ts
//
// IS THE MACHINE'S OWN MODEL SERVER ACTUALLY AWAKE?
//
// Every other provider on the roster answers the question "can you answer?"
// with a fact the browser already holds: a key is pasted or it is not. A
// LOCAL server is the one tier whose readiness is not a stored bit — it is a
// process that may simply not be running, and nothing in the descriptor can
// know that. Without this file the availability line said "Local model
// answers" while nothing was listening on the port, which is the worst thing
// a status line can do: state a fact that is false.
//
// So a machine-local provider is READY ONLY AFTER IT ANSWERED A PROBE, and
// `unknown` counts as not ready. The probe is one GET to the participant's
// own machine; it is cheap enough to repeat on a slow heartbeat, which is
// what keeps the line true after the server is started or stopped without
// the page reloading.
//
// ── three failures, three different sentences ─────────────────────────────
//
// A browser reports "connection refused" and "the server refused your
// origin" identically: one rejected fetch, no status, no body. They need
// opposite fixes, so the probe separates them the only way a page can — an
// opaque `no-cors` request. If THAT resolves, something is listening and the
// CORS policy is what turned us away (Ollama: `OLLAMA_ORIGINS`); if it
// rejects too, nothing is there.
//
//   awake    the server answered and named its models
//   empty    the server answered but has no model pulled — it cannot reply
//   blocked  the server is up and refused this origin
//   asleep   nothing is listening on that host
//
// ── the roster is the participant's, not ours ─────────────────────────────
//
// The descriptor ships one suggested model. What is installed is whatever
// they pulled, so a successful probe REPLACES the local descriptor's model
// list with the server's own — the console then shows what is really there,
// the policy designates a model that really exists, and the availability
// line names it. Nothing else in the codebase learns that this happened: the
// registry's `change` event does the rest.

import { EffectBus } from '@hypercomb/core'
import { llmProviderRegistry, replaceDiscoveredLlmProvider } from '../llm-provider-registry.js'
import {
  LOCAL_HOST_CANDIDATES,
  LOCAL_PROVIDER,
  hasExplicitLocalHost,
  localLlmHost,
  rememberLocalLlmHost,
} from './local.provider.js'
import type { LlmModelDescriptor, LlmProviderDescriptor, LlmTier } from './llm-provider.types.js'

export type LocalServerState =
  | 'unknown'
  /** The server answered and named its models. */
  | 'awake'
  /** Answered, but holds no model — it cannot reply to anything. */
  | 'empty'
  /** Up, and refused THIS ORIGIN (the server's own CORS list). */
  | 'blocked'
  /** Up or down, unknowable: the BROWSER will not let this page reach the
   *  local network until the participant allows it. */
  | 'needs-permission'
  /** Nothing is listening. */
  | 'asleep'

/** What one probe learned. `models` are wire ids exactly as the server names
 *  them — never rewritten, because that is what has to go back on the wire. */
export type LocalServerReport = {
  readonly state: LocalServerState
  readonly host: string
  readonly models: readonly string[]
  readonly checkedAt: number
}

const PROBE_TIMEOUT_MS = 2_500
/** How old a report may be before consulting it kicks a fresh probe. */
const STALE_MS = 10_000
/** The unattended heartbeat: enough to notice a server started in another
 *  window within half a minute, rare enough to cost nothing. */
const HEARTBEAT_MS = 30_000

const UNKNOWN = (host: string): LocalServerReport =>
  ({ state: 'unknown', host, models: [], checkedAt: 0 })

const reports = new Map<string, LocalServerReport>()
const inFlight = new Map<string, Promise<LocalServerReport>>()

// ── which providers this file speaks for ──────────────────────────────────

// EVERY SPELLING HERE HAS TO NAME THE PARTICIPANT'S OWN PROCESS, because
// this test is one of the three conditions that hand a model hive EXECUTION
// authority (chat-window.component.ts:3066-3068). `0.0.0.0` used to be in
// this set and does not belong: it is the wildcard a server BINDS to — "accept
// on every interface" — never an address a client DIALS. Servers print it
// (llama.cpp, vLLM and LM Studio all announce `0.0.0.0:<port>`), so it is a
// plausible thing to paste into the host field, which is exactly why it must
// not pass silently: as a DESTINATION it is undefined, resolved differently by
// every OS, and refused outright by Chromium since the 0.0.0.0-day fix. So
// admitting it bought a participant nothing — the probe fails either way and
// the gate closes anyway — while asserting the one thing the string cannot
// support: that this is their own machine. The provider-spec compiler's
// endpoint gate never admitted it either (`isAcceptableEndpoint`).
//
// A participant whose server printed `0.0.0.0` reaches it at `127.0.0.1`; the
// whole 127/8 block, both `::1` spellings and `localhost` stay, since each of
// those IS self-evidently this machine. One consequence at the second call
// site below: a page SERVED from hostname `0.0.0.0` now counts as a public
// origin, which stands the automatic probe down until a real press. That is
// the conservative direction, and the only direction a bind address earns.
const LOOPBACK = /^(localhost|127(?:\.\d+){3}|\[::1\]|::1)$/i

/**
 * The base URL a MACHINE-LOCAL provider is reached at, or `''` when the
 * provider is not one. "Machine-local" is a fact about the endpoint, not a
 * name: the built-in local provider, a second server on another port, a spec
 * a domain published that happens to point at loopback — all the same tier,
 * and all equally unable to answer while the process is down.
 *
 * A descriptor with NO endpoint is deliberately not machine-local. Test
 * doubles and future transports must not silently acquire a liveness gate.
 */
export const machineLocalEndpoint = (provider: LlmProviderDescriptor): string => {
  if (provider.transport !== 'browser-http') return ''
  const raw = provider.id === LOCAL_PROVIDER.id ? localLlmHost() : (provider.endpoint ?? '')
  if (!raw) return ''
  try {
    const url = new URL(raw)
    return LOOPBACK.test(url.hostname) ? raw.replace(/\/+$/, '') : ''
  } catch { return '' }
}

// ── the browser's own barrier ─────────────────────────────────────────────
//
// A PAGE ON THE PUBLIC WEB REACHING 127.0.0.1 IS A PERMISSION, not a fetch.
// Chromium 138+ (Edge included) gates public-origin → local-network requests
// behind `local-network-access`: until it is granted the request does not
// fail, it HANGS on a prompt, which read as "not running" through a probe
// timeout. So the state is asked for directly and reported as its own thing —
// the fix is a click, and no amount of restarting Ollama would have helped.
//
// It also decides WHEN we may probe. A prompt wants a user gesture behind it;
// a 30-second heartbeat firing hanging requests at a permission nobody asked
// for is noise. On a public origin the automatic sweep therefore stands down
// until the permission is granted, and "Check again" — a real press — is what
// raises the prompt.

type PermissionState = 'granted' | 'prompt' | 'denied' | 'unsupported'

let networkPermission: PermissionState = 'unsupported'

/** Is this page served from somewhere OTHER than the machine it runs on? The
 *  dev shell on localhost is local-to-local and no permission applies. */
const onAPublicOrigin = (): boolean => {
  try {
    const { protocol, hostname } = globalThis.location ?? ({} as Location)
    if (!protocol || !/^https?:$/.test(protocol)) return false
    return !LOOPBACK.test(hostname)
  } catch { return false }
}

/** Ask the browser where the local-network permission stands. `unsupported`
 *  on any engine that does not know the name — which must behave exactly as
 *  before, never as a refusal. */
export const refreshNetworkPermission = async (): Promise<PermissionState> => {
  if (!onAPublicOrigin()) { networkPermission = 'granted'; return networkPermission }
  try {
    const status = await navigator.permissions.query(
      { name: 'local-network-access' } as unknown as PermissionDescriptor,
    )
    networkPermission = status.state as PermissionState
    // The participant may answer the prompt at any time; the roster should
    // learn about it without another press.
    status.onchange = () => {
      networkPermission = status.state as PermissionState
      if (networkPermission === 'granted') recheckLocalServers()
    }
  } catch { networkPermission = 'unsupported' }
  return networkPermission
}

/** The browser is standing in the way right now. */
const permissionPending = (): boolean =>
  onAPublicOrigin() && (networkPermission === 'prompt' || networkPermission === 'denied')

// ── the probe ─────────────────────────────────────────────────────────────

const getJson = async (url: string): Promise<unknown | null> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  try {
    const response = await fetch(url, { method: 'GET', signal: controller.signal })
    if (!response.ok) return null
    return await response.json()
  } catch { return null } finally { clearTimeout(timer) }
}

/** Is ANYTHING listening? An opaque response is still a response: the socket
 *  accepted us even though the reply is unreadable, which is exactly the
 *  distinction between "not running" and "not allowed". */
const somethingIsListening = async (host: string): Promise<boolean> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
  try {
    await fetch(host, { method: 'GET', mode: 'no-cors', signal: controller.signal })
    return true
  } catch { return false } finally { clearTimeout(timer) }
}

type OpenAiModelList = { data?: { id?: unknown }[] }
type OllamaTagList = { models?: { name?: unknown; model?: unknown }[] }

const modelIdsFrom = (json: unknown): string[] => {
  const openAi = (json as OpenAiModelList)?.data
  if (Array.isArray(openAi)) {
    return openAi.map(entry => String(entry?.id ?? '').trim()).filter(Boolean)
  }
  const ollama = (json as OllamaTagList)?.models
  if (Array.isArray(ollama)) {
    return ollama.map(entry => String(entry?.model ?? entry?.name ?? '').trim()).filter(Boolean)
  }
  return []
}

/**
 * Ask one machine-local server what it is and what it holds.
 *
 * `/v1/models` first: Ollama, LM Studio, llama.cpp's server, vLLM and LocalAI
 * all serve it, which is the same reason the request adapter is the OpenAI
 * one. `/api/tags` is the fallback for an Ollama build too old for the
 * compatibility layer.
 */
export const probeLocalServer = async (host: string): Promise<LocalServerReport> => {
  const at = Date.now()
  const openAi = await getJson(`${host}/v1/models`)
  const models = openAi ? modelIdsFrom(openAi) : modelIdsFrom(await getJson(`${host}/api/tags`))
  if (openAi || models.length) {
    return { state: models.length ? 'awake' : 'empty', host, models, checkedAt: at }
  }
  const listening = await somethingIsListening(host)
  if (listening) return { state: 'blocked', host, models: [], checkedAt: at }
  // NOTHING CAME BACK — and on a public origin that is exactly what a pending
  // permission looks like, so ask before calling the server dead.
  if (onAPublicOrigin() && (await refreshNetworkPermission()) !== 'granted') {
    return { state: 'needs-permission', host, models: [], checkedAt: at }
  }
  return { state: 'asleep', host, models: [], checkedAt: at }
}

// ── the cached answer every other surface reads ───────────────────────────

/** The last thing we learned about this provider's server. */
export const localServerReport = (provider: LlmProviderDescriptor): LocalServerReport => {
  const host = machineLocalEndpoint(provider)
  if (!host) return UNKNOWN('')
  // A report found at a SIBLING spelling is about the same machine, and
  // `localLlmHost` has already moved to it — so a report is stale only when
  // the address it was taken at is neither the current one nor a sibling
  // still in play.
  const cached = reports.get(provider.id)
  return cached && (cached.host === host || alternatesFor(provider, host).includes(cached.host))
    ? cached
    : UNKNOWN(host)
}

const remember = (provider: LlmProviderDescriptor, report: LocalServerReport): LocalServerReport => {
  const before = reports.get(provider.id)
  reports.set(provider.id, report)
  const moved = !before
    || before.state !== report.state
    || before.host !== report.host
    || before.models.length !== report.models.length
    || before.models.some((model, index) => model !== report.models[index])
  if (!moved) return report
  syncRoster(provider, report)
  // WHO ANSWERS MAY HAVE CHANGED. The registry's own `change` covers a roster
  // swap; a server merely waking or dying moves no descriptor, so the same
  // announcement is made here — one effect, one meaning, however it happened.
  try { EffectBus.emit('llm:policy-changed', { at: report.checkedAt }) } catch { /* no bus in tests */ }
  return report
}

/**
 * THE OTHER DOORS. A loopback server is reached by three spellings and binds
 * only some of them — Ollama binds 127.0.0.1, and on Windows `localhost`
 * resolves to ::1 first, which is the whole reason a running server can look
 * dead. So a primary that answers NOTHING is followed by the siblings, once,
 * concurrently; the one that answers is remembered and every later probe goes
 * straight there. A participant who typed an address is never second-guessed.
 */
const alternatesFor = (provider: LlmProviderDescriptor, primary: string): string[] =>
  provider.id === LOCAL_PROVIDER.id && !hasExplicitLocalHost()
    ? LOCAL_HOST_CANDIDATES.filter(host => host !== primary)
    : []

/** When the siblings were last tried, and how rarely that is worth repeating.
 *  A dead address does not merely refuse on this machine — `localhost` TIMES
 *  OUT on a dead ::1 — so an unattended walk costs seconds of pending
 *  requests. Once per five minutes is enough to notice a server that came up
 *  on the other spelling; pressing "Check again" always walks. */
const WALK_EVERY_MS = 5 * 60_000
let lastWalk = 0

const findTheServer = async (
  provider: LlmProviderDescriptor,
  primary: string,
): Promise<LocalServerReport> => {
  const first = await probeLocalServer(primary)
  // Anything but silence is an answer about THIS address, and the participant
  // is looking at this address: do not go wandering.
  if (first.state !== 'asleep') return first
  // (a pending permission already returned above: it is not `asleep`)
  const alternates = alternatesFor(provider, primary)
  if (!alternates.length || Date.now() - lastWalk < WALK_EVERY_MS) return first
  lastWalk = Date.now()
  const tried = await Promise.all(alternates.map(host => probeLocalServer(host)))
  const found = tried.find(report => report.state === 'awake' || report.state === 'empty')
    ?? tried.find(report => report.state === 'blocked')
  if (!found) return first
  rememberLocalLlmHost(found.host)
  return found
}

/**
 * Probe now (or join the probe already running). Callers that merely want a
 * fresh-enough answer should use `refreshLocalServer`.
 */
export const checkLocalServer = async (provider: LlmProviderDescriptor): Promise<LocalServerReport> => {
  const host = machineLocalEndpoint(provider)
  if (!host) return UNKNOWN('')
  const running = inFlight.get(provider.id)
  if (running) return running
  const probe = findTheServer(provider, host)
    .then(report => remember(provider, report))
    .catch(() => remember(provider, { state: 'asleep', host, models: [], checkedAt: Date.now() }))
    .finally(() => { inFlight.delete(provider.id) })
  inFlight.set(provider.id, probe)
  return probe
}

/** Kick a probe if what we hold is older than `STALE_MS`. Fire and forget:
 *  the answer arrives as `llm:policy-changed`, never as a blocked caller. */
export const refreshLocalServer = (provider: LlmProviderDescriptor): void => {
  const host = machineLocalEndpoint(provider)
  if (!host) return
  // While the BROWSER is the blocker, an automatic probe only hangs. The
  // sweep has already written the honest state; the next press does the rest.
  if (permissionPending()) return
  const cached = localServerReport(provider)
  if (cached.state !== 'unknown' && Date.now() - cached.checkedAt < STALE_MS) return
  void checkLocalServer(provider)
}

/**
 * THE GATE. A provider that is not machine-local is unaffected; one that is
 * counts as usable only while its server is answering with a model.
 *
 * Consulting it also keeps the answer fresh, which is why the roster filters
 * in `llm-dispatch` and `model-policy` need no timer of their own.
 */
export const localModelServerUp = (provider: LlmProviderDescriptor): boolean => {
  if (!machineLocalEndpoint(provider)) return true
  refreshLocalServer(provider)
  return localServerReport(provider).state === 'awake'
}

/**
 * WHY THE LOCAL TIER IS SILENT, as a token a shell localizes itself — never a
 * sentence, because the string belongs to whichever catalog the participant
 * is reading. `''` when the local tier has nothing to say.
 */
export const localTierReason = (): '' | 'local-down' | 'local-blocked' | 'local-permission' => {
  let down = false
  for (const provider of llmProviderRegistry().all()) {
    if (!machineLocalEndpoint(provider)) continue
    const { state } = localServerReport(provider)
    // The browser's barrier outranks the server's: until the page may reach
    // the machine at all, nothing else about the server can be known.
    if (state === 'needs-permission') return 'local-permission'
    if (state === 'blocked') return 'local-blocked'
    if (state === 'asleep' || state === 'empty') down = true
  }
  return down ? 'local-down' : ''
}

/** A failed call is evidence. Dispatch reports one here so the availability
 *  line corrects itself the moment a request finds nothing listening. */
export const noteLocalServerUnreachable = (provider: LlmProviderDescriptor): void => {
  if (!machineLocalEndpoint(provider)) return
  reports.delete(provider.id)
  void checkLocalServer(provider)
}

// ── the roster the server actually holds ──────────────────────────────────

/** Parameter count in billions, read off the model name — the only weight
 *  signal a local server offers. Unknown is not a failure: it ranks as the
 *  middle tier, which is what an unlabelled model behaves like. */
const billions = (id: string): number => {
  const match = /(\d+(?:\.\d+)?)\s*b\b/i.exec(id.replace(/[:_/-]+/g, ' '))
  return match ? Number.parseFloat(match[1]) : Number.NaN
}

const tierOf = (id: string): LlmTier => {
  const size = billions(id)
  if (!Number.isFinite(size)) return 'balanced'
  return size < 10 ? 'fast' : size < 35 ? 'balanced' : 'deep'
}

/**
 * Server ids → descriptor models. The command alias is the family name
 * (`qwen2.5-coder`) while it is unambiguous, so `/qwen2.5-coder` works; two
 * tags of one family both keep their full id rather than fight over the word.
 */
export const modelsFromServer = (ids: readonly string[]): LlmModelDescriptor[] => {
  const families = new Map<string, number>()
  for (const id of ids) {
    const family = id.split(':')[0].toLowerCase()
    families.set(family, (families.get(family) ?? 0) + 1)
  }
  return ids.map(id => {
    const family = id.split(':')[0].toLowerCase()
    return {
      name: families.get(family) === 1 ? family : id.toLowerCase(),
      id,
      tier: tierOf(id),
      label: id,
    }
  })
}

/** Keep the participant's own choice when the server still holds it — a
 *  designation that survives a restart is one less thing that moved. */
const defaultFrom = (current: string, models: readonly LlmModelDescriptor[]): string =>
  models.some(model => model.id === current) ? current : models[0].id

const syncRoster = (provider: LlmProviderDescriptor, report: LocalServerReport): void => {
  if (report.state !== 'awake' || !report.models.length) return
  const models = modelsFromServer(report.models)
  const same = provider.models.length === models.length
    && provider.models.every((model, index) => model.id === models[index].id)
  if (same) return
  replaceDiscoveredLlmProvider({
    ...provider,
    models,
    defaultModel: defaultFrom(provider.defaultModel, models),
  })
}

// ── the heartbeat ─────────────────────────────────────────────────────────
//
// Probing only when asked would leave a window that has been open for an hour
// showing an hour-old answer, and starting the server is exactly the moment a
// participant looks at the line. So: every machine-local provider is checked
// on a slow timer while the page is visible, on the page becoming visible,
// and whenever the participant edits the local host.

const sweep = (): void => {
  // A hanging request per provider per heartbeat, against a prompt nobody
  // raised, is worse than saying plainly what is in the way. One report is
  // written so the surfaces have something true to show, and the next press
  // of "Check again" carries the gesture the prompt wants.
  if (permissionPending()) {
    for (const provider of llmProviderRegistry().all()) {
      const host = machineLocalEndpoint(provider)
      if (!host || reports.get(provider.id)?.state === 'needs-permission') continue
      remember(provider, { state: 'needs-permission', host, models: [], checkedAt: Date.now() })
    }
    return
  }
  for (const provider of llmProviderRegistry().all()) {
    if (machineLocalEndpoint(provider)) refreshLocalServer(provider)
  }
}

let heartbeat: ReturnType<typeof setInterval> | null = null

/** Start the unattended check. Idempotent; a no-op where there is no page
 *  (tests, a worker) so nothing schedules work a suite has to wait for. */
export const startLocalLivenessWatch = (): void => {
  if (heartbeat || typeof document === 'undefined') return
  const visible = (): boolean => document.visibilityState !== 'hidden'
  void refreshNetworkPermission().then(() => sweep())
  heartbeat = setInterval(() => { if (visible()) sweep() }, HEARTBEAT_MS)
  document.addEventListener('visibilitychange', () => { if (visible()) sweep() })
  globalThis.addEventListener?.('online', () => sweep())
  sweep()
}

/** The participant moved the server (or believes they fixed it). Forget what
 *  we knew and ask again — a stale "asleep" must never outlive its cause. */
export const recheckLocalServers = (): void => {
  reports.clear()
  lastWalk = 0
  sweep()
}
