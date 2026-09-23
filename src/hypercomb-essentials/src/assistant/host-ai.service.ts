// assistant/host-ai.service.ts
//
// HostAiService — talk to your HOST's AI and get an answer NOW.
//
// The host (the blossom-worker on the operator's domain, e.g.
// content.jwize.com) fields `POST /ai/ask`, relays to the Anthropic API
// (Haiku by default) and streams the reply back as SSE. This service is the
// client half: it signs the request with the participant's OWN Nostr key
// (NIP-98 — the same identity envelope host-sync PUTs carry, no secrets on
// the wire), streams the answer, and mirrors every chunk onto the EffectBus
// so any surface (command line, a future chat sheet, mobile) can render it
// without importing anything.
//
//   ai:answer  { id, chunk?, text?, done, error? }   (per-ask stream)
//
// This is the SHALLOW immediate tier. The deep tier — the home Claude Code
// bridge on ws:2401 with full hive access — is unchanged and unrelated;
// when your home server is up you have both.
//
// Context rides as CONTENT SIGS (signature doctrine — reference, never
// inline): pass sigs of resources already pushed to the host and the worker
// inlines them server-side from its own heap.

import {
  EffectBus,
  PARTICIPANT_AI_HOST_STORAGE_KEY,
  isParticipantAiHostConfigured,
} from '@hypercomb/core'

const NOSTR_SIGNER_KEY = '@diamondcoreprocessor.com/NostrSigner'
const NIP98_KIND = 27235

/** localStorage key naming the AI host (domain only, no scheme). Defaults to
 *  the public content endpoint — the worker that actually runs /ai/ask. */
export const AI_HOST_STORAGE_KEY = PARTICIPANT_AI_HOST_STORAGE_KEY
export const AI_HOST_DEFAULT = 'content.jwize.com'

export const HOST_AI_IOC_KEY = '@diamondcoreprocessor.com/HostAi'

type SignerLike = {
  signEvent?: (evt: {
    kind: number
    created_at: number
    tags: string[][]
    content: string
  }) => Promise<{ [k: string]: unknown }>
}

export type AskOptions = {
  /** Content sigs (already on the host) to inline as grounding context. */
  contextSigs?: readonly string[]
  /** Abort mid-stream. */
  signal?: AbortSignal
}

export type AskEvent = { id: string; chunk?: string; text?: string; done: boolean; error?: string }

export class HostAiService extends EventTarget {
  #seq = 0

  /** True only when the participant explicitly supplied an AI host. */
  get configured(): boolean {
    return isParticipantAiHostConfigured()
  }

  /** The configured AI host (bare domain). */
  get host(): string {
    try {
      const raw = String(localStorage.getItem(AI_HOST_STORAGE_KEY) ?? '').trim()
      return raw || AI_HOST_DEFAULT
    } catch {
      return AI_HOST_DEFAULT
    }
  }

  /** Set (or clear with '') the AI host. Bare domain, scheme stripped. */
  setHost(domain: string): void {
    const bare = String(domain ?? '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '')
    try {
      if (bare) localStorage.setItem(AI_HOST_STORAGE_KEY, bare)
      else localStorage.removeItem(AI_HOST_STORAGE_KEY)
    } catch { /* private mode — non-fatal */ }
    EffectBus.emit('host-ai:configuration', { configured: this.configured, host: this.host })
  }

  /** Ask the host's AI. Yields text chunks as they stream; every chunk (and
   *  the final state) is mirrored to the `ai:answer` effect. Throws on
   *  transport/auth errors AFTER emitting the error on the bus, so callers
   *  may consume either surface. */
  async *ask(question: string, opts: AskOptions = {}): AsyncGenerator<string, string, void> {
    const id = `ask-${++this.#seq}-${Math.random().toString(36).slice(2, 8)}`
    const q = String(question ?? '').trim()
    if (!q) {
      const error = 'empty question'
      EffectBus.emit('ai:answer', { id, done: true, error } satisfies AskEvent)
      throw new Error(error)
    }

    const host = this.host
    // Loopback hosts use plain http (same rule as host-sync).
    const scheme = /^(localhost|127(?:\.\d+){3}|\[?::1\]?)(?::\d+)?$/i.test(host) ? 'http' : 'https'
    const url = `${scheme}://${host}/ai/ask`

    const auth = await this.#nip98(url, 'POST')
    if (!auth) {
      const error = 'no Nostr signer available — cannot sign the ask'
      EffectBus.emit('ai:answer', { id, done: true, error } satisfies AskEvent)
      throw new Error(error)
    }

    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: q,
          context: (opts.contextSigs ?? []).slice(0, 8),
          stream: true,
        }),
        signal: opts.signal,
      })
    } catch (err) {
      const error = `host unreachable (${host})`
      EffectBus.emit('ai:answer', { id, done: true, error } satisfies AskEvent)
      throw new Error(error, { cause: err })
    }

    if (!res.ok || !res.body) {
      const reason = res.headers.get('x-reason') ?? `${res.status}`
      const error = res.status === 503
        ? `the host has no AI configured yet (${host})`
        : res.status === 429
          ? `AI allowance exhausted: ${reason}`
          : `ask failed: ${reason}`
      EffectBus.emit('ai:answer', { id, done: true, error } satisfies AskEvent)
      throw new Error(error)
    }

    // Anthropic SSE passthrough: `data: {...}` lines; text rides
    // content_block_delta events as delta.text.
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let full = ''
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let nl: number
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).trim()
          buffer = buffer.slice(nl + 1)
          if (!line.startsWith('data:')) continue
          const payload = line.slice(5).trim()
          if (!payload || payload === '[DONE]') continue
          let evt: { type?: string; delta?: { type?: string; text?: string } }
          try { evt = JSON.parse(payload) } catch { continue }
          const text = evt?.type === 'content_block_delta' && evt.delta?.type === 'text_delta'
            ? evt.delta.text ?? ''
            : ''
          if (!text) continue
          full += text
          EffectBus.emit('ai:answer', { id, chunk: text, done: false } satisfies AskEvent)
          yield text
        }
      }
    } finally {
      try { reader.releaseLock() } catch { /* stream already closed */ }
    }

    EffectBus.emit('ai:answer', { id, text: full, done: true } satisfies AskEvent)
    return full
  }

  /**
   * ONE WHOLE ANSWER FROM A NAMED HOST — not the participant's AI host, the
   * host the question is about. A sandbox's review is asked of the host the
   * sandbox was published to, because that host holds the changed files the
   * context names (documentation/module-sandbox.md). Not streamed: a review is
   * read once, whole. The model that answered is reported by the host.
   */
  async askWhole(host: string, question: string, contextSigs: readonly string[] = [], signal?: AbortSignal): Promise<{ ok: true; text: string; model: string } | { ok: false; error: string }> {
    const bare = String(host ?? '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '')
    const q = String(question ?? '').trim()
    if (!bare || !q) return { ok: false, error: 'no host or no question' }
    const scheme = /^((?:[a-z0-9-]+\.)*localhost|127(?:\.\d+){3}|\[?::1\]?)(?::\d+)?$/i.test(bare) ? 'http' : 'https'
    const url = `${scheme}://${bare}/ai/ask`
    const auth = await this.#nip98(url, 'POST')
    if (!auth) return { ok: false, error: 'no Nostr signer is available to sign the ask' }
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q, context: contextSigs.slice(0, 8), stream: false }),
        signal,
      })
      if (!res.ok) return { ok: false, error: `${bare} said ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}` }
      const body = await res.json() as { content?: { type?: string; text?: string }[]; model?: string }
      const text = (body.content ?? []).filter(part => part.type === 'text').map(part => part.text ?? '').join('').trim()
      return text ? { ok: true, text, model: res.headers.get('x-ai-model') ?? body.model ?? '' } : { ok: false, error: `${bare} answered with no text` }
    } catch (error) {
      return { ok: false, error: `${bare} could not be reached${error instanceof Error ? ` (${error.message})` : ''}` }
    }
  }

  /** One-shot convenience: full answer as a string. */
  async askText(question: string, opts: AskOptions = {}): Promise<string> {
    let full = ''
    for await (const chunk of this.ask(question, opts)) full += chunk
    return full
  }

  /** NIP-98 Authorization header — identical construction to host-sync. */
  readonly #nip98 = async (url: string, method: string): Promise<string | null> => {
    const signer = (window as { ioc?: { get?: (k: string) => unknown } })
      .ioc?.get?.(NOSTR_SIGNER_KEY) as SignerLike | undefined
    if (!signer?.signEvent) return null
    try {
      const signed = await signer.signEvent({
        kind: NIP98_KIND,
        created_at: Math.floor(Date.now() / 1000),
        tags: [['u', url], ['method', method]],
        content: '',
      })
      return 'Nostr ' + btoa(unescape(encodeURIComponent(JSON.stringify(signed))))
    } catch {
      return null
    }
  }
}
