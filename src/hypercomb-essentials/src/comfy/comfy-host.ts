// comfy/comfy-host.ts
//
// THE COMFYUI HOST — a machine, named device-locally, never in content.
//
// A ComfyUI server is `http://127.0.0.1:8188` on one machine and
// `http://192.168.1.40:8818` on another, and both are the same participant's
// hive. The address is therefore NOT content: it is a fact about this device,
// kept in localStorage beside the LLM keys and for exactly the same reason —
// a spec that travelled with a machine address would name a machine the
// receiver does not have. Workflows travel (`comfy:workflows`); the host
// does not.
//
// THE TWO THINGS THAT ACTUALLY GO WRONG, both worth saying out loud because
// each one looks like "it is broken" and neither is:
//
//   1. CORS. ComfyUI does not send `Access-Control-Allow-Origin` unless it is
//      started with `--enable-cors-header "*"` (or your origin). Without it
//      every request from a browser fails at the fetch, with no status code
//      and no body — the same shape as "the server is down". This file tells
//      the two apart by asking `/system_stats` and reading the failure: a
//      thrown TypeError with the server plainly listening is a CORS refusal,
//      and the participant is told the flag rather than "unreachable".
//
//   2. MIXED CONTENT. A page served over https may talk to `http://localhost`
//      and `http://127.0.0.1` — the spec calls those potentially trustworthy
//      — but NOT to `http://192.168.x.x`. A LAN box therefore needs either a
//      tunnel, a certificate, or the hive opened over http. Also detectable,
//      also worth saying instead of failing silently.
//
// Everything here is one class with no dependencies beyond `fetch` and
// `WebSocket`, so it can be exercised against a stub in a spec.

import { EffectBus } from '@hypercomb/core'

/** Where the participant's ComfyUI lives. Device-local. */
export const COMFY_ENDPOINT_KEY = 'hc:comfy:endpoint'

/**
 * The addresses worth trying before asking. 8188 is ComfyUI's own default;
 * 8818 is the port this project has pointed at since the first Angular
 * build (helper/constants.ts, `comfyui: 'http://localhost:8818'`), so a
 * machine that has run either finds itself with no typing.
 */
export const COMFY_CANDIDATES: readonly string[] = [
  'http://127.0.0.1:8188',
  'http://127.0.0.1:8818',
  'http://localhost:8188',
  'http://localhost:8818',
]

/** One picture ComfyUI is holding for us. */
export interface ComfyFileRef {
  filename: string
  subfolder: string
  type: 'output' | 'temp' | 'input'
}

/** What `/history/<id>` says about one run. */
export interface ComfyRunOutputs {
  status?: { status_str?: string; completed?: boolean; messages?: unknown[] }
  outputs?: Record<string, { images?: ComfyFileRef[]; gifs?: ComfyFileRef[] }>
}

export interface ComfyReach {
  ok: boolean
  /** Present when the server answered — its self-reported version. */
  version?: string
  /** Present when it did not. Written for a person, not a log. */
  reason?: string
  /** The specific, fixable refusals, so a surface can offer the fix.
   *  `unknown` is the state before anyone has asked — NOT a failure, and it
   *  must never be drawn as one: a warning box on a window that has not yet
   *  made a request tells the participant something is wrong when nothing
   *  is. Absence of a reason is what makes that distinction renderable. */
  kind?: 'unknown' | 'cors' | 'mixed-content' | 'unreachable' | 'error'
}

/** Live progress, as ComfyUI reports it over the socket. */
export interface ComfyProgress {
  promptId?: string
  /** Which node is running, when it says. */
  node?: string | null
  /** Steps done / steps total for the running node. */
  value?: number
  max?: number
  /** How many runs are still queued behind this one. */
  queued?: number
}

type ProgressHandlers = {
  onProgress?: (progress: ComfyProgress) => void
  /** A node finished and produced files — the earliest a picture exists. */
  onExecuted?: (promptId: string, node: string, files: readonly ComfyFileRef[]) => void
  /** The whole run finished (ComfyUI signals this as `executing` with a
   *  null node — the one message that means "queue drained for this run"). */
  onDone?: (promptId: string) => void
  onError?: (promptId: string | undefined, message: string) => void
}

const trimSlash = (input: string): string => input.replace(/\/+$/, '')

/** What the participant typed, made into an origin. A bare `localhost:8188`
 *  is what people type; assuming http for it is the difference between the
 *  field working and the field being wrong in a way nobody can see. */
export const normalizeEndpoint = (input: string): string => {
  const raw = String(input ?? '').trim()
  if (!raw) return ''
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`
  try {
    const url = new URL(withScheme)
    return trimSlash(url.origin + (url.pathname === '/' ? '' : url.pathname))
  } catch {
    return ''
  }
}

/** Would this page be allowed to reach that endpoint at all? Pure — it reads
 *  only the two origins, so a spec can exercise the rule without a browser. */
export const mixedContentBlocked = (endpoint: string, pageProtocol: string, pageHost: string): boolean => {
  if (pageProtocol !== 'https:') return false
  let url: URL
  try { url = new URL(endpoint) } catch { return false }
  if (url.protocol === 'https:') return false
  const host = url.hostname
  // Potentially trustworthy per the mixed-content spec — the browser lets
  // these through from an https page, which is exactly why localhost is the
  // recommended way to run this.
  if (host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1' || host === '::1') return false
  // The page's own host over plain http is not a mix at all.
  if (host === pageHost) return false
  return true
}

export class ComfyHost extends EventTarget {
  #endpoint: string
  /** Our identity on the socket — one per document, so the server's
   *  `executed` messages for OUR runs can be told from anyone else's. */
  readonly clientId: string = (() => {
    try { return crypto.randomUUID() } catch { return `hc-${Math.random().toString(36).slice(2)}` }
  })()
  #socket: WebSocket | null = null
  #handlers: ProgressHandlers = {}
  #reach: ComfyReach = { ok: false, kind: 'unknown' }

  constructor() {
    super()
    let stored = ''
    try { stored = localStorage.getItem(COMFY_ENDPOINT_KEY) ?? '' } catch { /* session-only */ }
    this.#endpoint = normalizeEndpoint(stored) || COMFY_CANDIDATES[0] as string
  }

  get endpoint(): string { return this.#endpoint }

  /** Has the participant actually named a host, or is this still the guess?
   *  The window says "not connected yet" for a guess and "unreachable" for a
   *  choice, and those are different sentences. */
  get chosen(): boolean {
    try { return !!localStorage.getItem(COMFY_ENDPOINT_KEY) } catch { return false }
  }

  get reach(): ComfyReach { return this.#reach }

  setEndpoint(input: string): string {
    const next = normalizeEndpoint(input)
    if (!next) return this.#endpoint
    if (next === this.#endpoint) return next
    this.#endpoint = next
    try { localStorage.setItem(COMFY_ENDPOINT_KEY, next) } catch { /* session-only */ }
    this.#closeSocket()
    this.#announce()
    return next
  }

  #announce(): void {
    this.dispatchEvent(new CustomEvent('change'))
    EffectBus.emit('comfy:host-changed', { endpoint: this.#endpoint, reach: this.#reach })
  }

  url(path: string, query?: Record<string, string | number | undefined>): string {
    const base = `${this.#endpoint}${path.startsWith('/') ? path : `/${path}`}`
    if (!query) return base
    const params = new URLSearchParams()
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') params.set(key, String(value))
    }
    const qs = params.toString()
    return qs ? `${base}?${qs}` : base
  }

  /** A picture's address on the host — usable straight in an `<img src>`
   *  for a preview, which costs nothing until the participant keeps it. */
  viewUrl(file: ComfyFileRef): string {
    return this.url('/view', { filename: file.filename, subfolder: file.subfolder, type: file.type })
  }

  // ── asking whether it is there ────────────────────────────────────────────

  /**
   * One request, three possible answers, all of them useful: it works, it is
   * refusing the browser (CORS), or it is not there. Never throws.
   */
  async probe(endpoint?: string): Promise<ComfyReach> {
    const target = endpoint ? normalizeEndpoint(endpoint) : this.#endpoint
    if (!target) return { ok: false, kind: 'error', reason: 'no address' }

    if (typeof location !== 'undefined'
      && mixedContentBlocked(target, location.protocol, location.hostname)) {
      const reach: ComfyReach = {
        ok: false,
        kind: 'mixed-content',
        reason: 'this page is https and that address is plain http — run ComfyUI on localhost, '
          + 'or reach it through a tunnel that terminates TLS',
      }
      if (!endpoint) { this.#reach = reach; this.#announce() }
      return reach
    }

    let reach: ComfyReach
    try {
      const response = await fetch(`${target}/system_stats`, { method: 'GET', mode: 'cors' })
      if (!response.ok) {
        reach = { ok: false, kind: 'error', reason: `the server answered ${response.status}` }
      } else {
        const stats = await response.json().catch(() => null) as
          { system?: { comfyui_version?: string; python_version?: string } } | null
        reach = { ok: true, version: stats?.system?.comfyui_version ?? '' }
      }
    } catch {
      // A fetch that throws carries no status and no body — the browser will
      // not say whether it was refused or unanswered. Both fixes are worth
      // naming, and CORS is overwhelmingly the one that bites, because the
      // server IS running and every other client can see it.
      reach = {
        ok: false,
        kind: 'cors',
        reason: 'no answer the browser would accept — start ComfyUI with '
          + '--enable-cors-header "*" if it is running',
      }
    }
    if (!endpoint) { this.#reach = reach; this.#announce() }
    return reach
  }

  /**
   * Try the usual addresses and adopt the first that answers. Sequential on
   * purpose: a machine with ComfyUI on 8188 should not have four sockets
   * opened at it to find that out, and the list is short.
   */
  async discover(): Promise<string | null> {
    const tried = new Set<string>()
    const order = [this.#endpoint, ...COMFY_CANDIDATES]
    for (const candidate of order) {
      const target = normalizeEndpoint(candidate)
      if (!target || tried.has(target)) continue
      tried.add(target)
      const reach = await this.probe(target)
      if (reach.ok) {
        this.setEndpoint(target)
        this.#reach = reach
        this.#announce()
        return target
      }
    }
    return null
  }

  // ── running things ────────────────────────────────────────────────────────

  /** Queue a graph. Returns the prompt id; throws with ComfyUI's own
   *  validation message when the graph is refused, because "node 6: required
   *  input is missing" is the only sentence that helps. */
  async queue(graph: unknown): Promise<string> {
    const response = await fetch(this.url('/prompt'), {
      method: 'POST',
      mode: 'cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: graph, client_id: this.clientId }),
    })
    const body = await response.json().catch(() => null) as {
      prompt_id?: string
      error?: { message?: string; details?: string }
      node_errors?: Record<string, { errors?: { message?: string; details?: string }[] }>
    } | null

    if (!response.ok || !body?.prompt_id) {
      const nodeError = Object.entries(body?.node_errors ?? {})
        .map(([node, held]) => {
          const first = held?.errors?.[0]
          return `node ${node}: ${first?.message ?? 'refused'}${first?.details ? ` (${first.details})` : ''}`
        })[0]
      throw new Error(nodeError ?? body?.error?.message ?? `the server refused the workflow (${response.status})`)
    }
    return body.prompt_id
  }

  /** What a finished (or running) prompt produced. */
  async history(promptId: string): Promise<ComfyRunOutputs | null> {
    try {
      const response = await fetch(this.url(`/history/${encodeURIComponent(promptId)}`), { mode: 'cors' })
      if (!response.ok) return null
      const held = await response.json() as Record<string, ComfyRunOutputs>
      return held?.[promptId] ?? null
    } catch { return null }
  }

  /** Every picture a finished run made, in node order. */
  static filesOf(run: ComfyRunOutputs | null, only?: string): ComfyFileRef[] {
    const out: ComfyFileRef[] = []
    for (const [node, held] of Object.entries(run?.outputs ?? {})) {
      if (only && node !== only) continue
      for (const file of [...(held.images ?? []), ...(held.gifs ?? [])]) out.push(file)
    }
    return out
  }

  async fetchFile(file: ComfyFileRef): Promise<Blob | null> {
    try {
      const response = await fetch(this.viewUrl(file), { mode: 'cors' })
      if (!response.ok) return null
      return await response.blob()
    } catch { return null }
  }

  /** Put an image where a LoadImage node can find it — the img2img door. */
  async upload(blob: Blob, name: string): Promise<string | null> {
    try {
      const form = new FormData()
      form.append('image', blob, name)
      form.append('overwrite', 'true')
      const response = await fetch(this.url('/upload/image'), { method: 'POST', mode: 'cors', body: form })
      if (!response.ok) return null
      const held = await response.json() as { name?: string; subfolder?: string }
      return held?.subfolder ? `${held.subfolder}/${held.name}` : held?.name ?? null
    } catch { return null }
  }

  async interrupt(): Promise<void> {
    try { await fetch(this.url('/interrupt'), { method: 'POST', mode: 'cors' }) } catch { /* best effort */ }
  }

  /** How many runs are waiting, ours and anyone else's. */
  async queueDepth(): Promise<number> {
    try {
      const response = await fetch(this.url('/queue'), { mode: 'cors' })
      if (!response.ok) return 0
      const held = await response.json() as { queue_running?: unknown[]; queue_pending?: unknown[] }
      return (held?.queue_running?.length ?? 0) + (held?.queue_pending?.length ?? 0)
    } catch { return 0 }
  }

  /**
   * The names a seam can take — checkpoints, samplers, schedulers — read from
   * the server's own `/object_info`. Asking the host beats shipping a list:
   * the participant's models are whatever they downloaded, and a hardcoded
   * `v1-5-pruned-emaonly.safetensors` is a workflow that fails on every
   * machine but the one it was written on.
   */
  async choicesFor(classType: string, input: string): Promise<string[]> {
    try {
      const response = await fetch(this.url(`/object_info/${encodeURIComponent(classType)}`), { mode: 'cors' })
      if (!response.ok) return []
      const held = await response.json() as Record<string, {
        input?: { required?: Record<string, unknown>; optional?: Record<string, unknown> }
      }>
      const spec = held?.[classType]?.input
      const entry = (spec?.required?.[input] ?? spec?.optional?.[input]) as unknown
      // ComfyUI describes a dropdown as `[[...names], {...}]`.
      const first = Array.isArray(entry) ? entry[0] : null
      return Array.isArray(first) ? first.filter(v => typeof v === 'string') as string[] : []
    } catch { return [] }
  }

  // ── the socket ────────────────────────────────────────────────────────────

  /** `http://host` → `ws://host/ws?clientId=…`. */
  socketUrl(): string {
    const ws = this.#endpoint.replace(/^http/i, 'ws')
    return `${ws}/ws?clientId=${encodeURIComponent(this.clientId)}`
  }

  /**
   * Listen for progress. One socket per host, opened lazily and kept — the
   * server pushes every run this client queued down it, so a second run does
   * not need a second socket.
   *
   * THE SOCKET IS AN OPTIMISATION, NEVER THE TRUTH. A run's result is read
   * from `/history` regardless (see comfy.service), because a socket that
   * dropped mid-run must not lose a picture that was in fact made. What the
   * socket buys is the progress bar and the moment of arrival, which is a
   * better experience and not a correctness dependency.
   */
  listen(handlers: ProgressHandlers): void {
    this.#handlers = handlers
    if (this.#socket && this.#socket.readyState <= WebSocket.OPEN) return
    try {
      const socket = new WebSocket(this.socketUrl())
      this.#socket = socket
      socket.addEventListener('message', event => this.#onMessage(event))
      socket.addEventListener('close', () => { if (this.#socket === socket) this.#socket = null })
      socket.addEventListener('error', () => { /* the poll carries the run */ })
    } catch { /* no socket: the poll carries the run */ }
  }

  #onMessage(event: MessageEvent): void {
    // Binary frames are the live preview image — a nicety this window does
    // not show, and skipping them costs nothing.
    if (typeof event.data !== 'string') return
    let message: { type?: string; data?: Record<string, unknown> } | null = null
    try { message = JSON.parse(event.data) } catch { return }
    const data = message?.data ?? {}
    const promptId = typeof data['prompt_id'] === 'string' ? data['prompt_id'] : undefined

    switch (message?.type) {
      case 'status': {
        const info = (data['status'] as { exec_info?: { queue_remaining?: number } } | undefined)?.exec_info
        this.#handlers.onProgress?.({ queued: info?.queue_remaining ?? 0 })
        break
      }
      case 'progress': {
        this.#handlers.onProgress?.({
          promptId,
          node: typeof data['node'] === 'string' ? data['node'] : null,
          value: typeof data['value'] === 'number' ? data['value'] : undefined,
          max: typeof data['max'] === 'number' ? data['max'] : undefined,
        })
        break
      }
      case 'executing': {
        const node = data['node']
        // node === null is ComfyUI's "this prompt is finished".
        if (node === null || node === undefined) {
          if (promptId) this.#handlers.onDone?.(promptId)
        } else {
          this.#handlers.onProgress?.({ promptId, node: String(node) })
        }
        break
      }
      case 'executed': {
        const output = data['output'] as { images?: ComfyFileRef[]; gifs?: ComfyFileRef[] } | undefined
        const files = [...(output?.images ?? []), ...(output?.gifs ?? [])]
        if (promptId && files.length) this.#handlers.onExecuted?.(promptId, String(data['node'] ?? ''), files)
        break
      }
      case 'execution_error': {
        this.#handlers.onError?.(promptId, String(data['exception_message'] ?? 'the run failed'))
        break
      }
      default: break
    }
  }

  #closeSocket(): void {
    try { this.#socket?.close() } catch { /* already gone */ }
    this.#socket = null
  }

  dispose(): void { this.#closeSocket() }
}

export const comfyHost = new ComfyHost()
