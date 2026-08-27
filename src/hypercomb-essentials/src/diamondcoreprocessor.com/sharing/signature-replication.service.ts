// Pull replication client. This service is deliberately demand-driven: it is
// not subscribed to content writes or any render/navigation effect.

import { SignatureService } from '@hypercomb/core'

const SIG_RE = /^[a-f0-9]{64}$/
const SIGNER_KEY = '@diamondcoreprocessor.com/NostrSigner'

type SignerLike = {
  signEvent(event: { kind: number; created_at: number; tags: string[][]; content: string }): Promise<Record<string, unknown>>
}

export type ReceiptDocument = {
  version: 1
  revision: number
  updatedAt: string
  signatures: string[]
}

export type ReplicationRequest = {
  signature: string
  sources: string[]
  limit?: number
  inventory?: boolean
}

export type ReplicationStatus = {
  state: 'running' | 'complete' | 'failed'
  signature: string
  total?: number
  present?: number
  fetched?: number
  held?: string[]
  holes?: string[]
  refused?: string[]
  limited?: boolean
  error?: string
}

type DomainState = { receipts: Set<string>; etag: string | null; updatedAt: string | null }

export class SignatureReplicationService {
  readonly #domains = new Map<string, DomainState>()
  readonly #domainsBySignature = new Map<string, Set<string>>()
  readonly #signer: () => SignerLike | undefined

  constructor(signer = () => window.ioc?.get?.(SIGNER_KEY) as SignerLike | undefined) {
    this.#signer = signer
  }

  public readonly replicate = async (domain: string, request: ReplicationRequest): Promise<boolean> => {
    const base = this.#base(domain)
    if (!SIG_RE.test(request.signature) || !request.sources.length) throw new TypeError('invalid replication request')
    const body = new TextEncoder().encode(JSON.stringify(request))
    const url = `${base}/replicate`
    const auth = await this.#nip98(url, 'POST', body)
    if (!auth) return false
    try {
      const response = await fetch(url, {
        method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' }, body,
      })
      return response.status === 202
    } catch { return false }
  }

  public readonly refreshReceipts = async (domain: string): Promise<ReceiptDocument | null> => {
    const base = this.#base(domain)
    const state = this.#domains.get(base) ?? { receipts: new Set(), etag: null, updatedAt: null }
    const url = `${base}/receipts`
    const auth = await this.#nip98(url, 'GET')
    if (!auth) return null
    const headers: Record<string, string> = { Authorization: auth }
    if (state.etag) headers['If-None-Match'] = state.etag
    try {
      const response = await fetch(url, { headers, cache: 'no-store' })
      if (response.status === 304) return this.#document(state)
      if (!response.ok) return null
      const document = await response.json() as ReceiptDocument
      if (!Array.isArray(document.signatures)) return null
      this.#replace(base, state, document.signatures.filter(sig => SIG_RE.test(sig)))
      state.etag = response.headers.get('ETag')
      state.updatedAt = document.updatedAt
      this.#domains.set(base, state)
      return this.#document(state, document.revision)
    } catch { return null }
  }

  public readonly status = async (domain: string, signature: string): Promise<ReplicationStatus | null> => {
    if (!SIG_RE.test(signature)) return null
    const url = `${this.#base(domain)}/replicate/${signature}`
    const auth = await this.#nip98(url, 'GET')
    if (!auth) return null
    try {
      const response = await fetch(url, { headers: { Authorization: auth }, cache: 'no-store' })
      return response.ok ? await response.json() as ReplicationStatus : null
    } catch { return null }
  }

  public readonly hasReceipt = (domain: string, signature: string): boolean =>
    this.#domains.get(this.#base(domain))?.receipts.has(signature) ?? false

  public readonly getKnownDomains = (signature: string): string[] =>
    [...(this.#domainsBySignature.get(signature) ?? [])]

  /** HEAD is the final proof and repair check; a miss revokes local provenance. */
  public readonly verify = async (domain: string, signature: string): Promise<boolean> => {
    if (!SIG_RE.test(signature)) return false
    const base = this.#base(domain)
    let held = false
    try { held = (await fetch(`${base}/${signature}`, { method: 'HEAD', cache: 'no-store' })).status === 200 } catch {}
    const state = this.#domains.get(base) ?? { receipts: new Set(), etag: null, updatedAt: null }
    if (held) state.receipts.add(signature)
    else state.receipts.delete(signature)
    this.#domains.set(base, state)
    this.#reindex(signature)
    return held
  }

  #replace(base: string, state: DomainState, signatures: string[]): void {
    const old = state.receipts
    state.receipts = new Set(signatures)
    for (const signature of new Set([...old, ...state.receipts])) this.#reindex(signature, base, state)
  }

  #reindex(signature: string, changedBase?: string, changedState?: DomainState): void {
    const domains = this.#domainsBySignature.get(signature) ?? new Set<string>()
    if (changedBase && changedState) {
      if (changedState.receipts.has(signature)) domains.add(changedBase); else domains.delete(changedBase)
    } else {
      domains.clear()
      for (const [base, state] of this.#domains) if (state.receipts.has(signature)) domains.add(base)
    }
    if (domains.size) this.#domainsBySignature.set(signature, domains); else this.#domainsBySignature.delete(signature)
  }

  #document(state: DomainState, revision = Number(state.etag?.match(/(\d+)/)?.[1] ?? 0)): ReceiptDocument {
    return { version: 1, revision, updatedAt: state.updatedAt ?? new Date(0).toISOString(), signatures: [...state.receipts] }
  }

  #base(domain: string): string {
    const raw = domain.trim().replace(/\/+$/, '')
    if (/^https?:\/\//i.test(raw)) return raw
    return `${/^(localhost|127(?:\.\d+){3}|\[?::1\]?)(?::\d+)?$/i.test(raw) ? 'http' : 'https'}://${raw}`
  }

  async #nip98(url: string, method: string, payload?: Uint8Array): Promise<string | null> {
    const signer = this.#signer()
    if (!signer?.signEvent) return null
    const tags = [['u', url], ['method', method]]
    if (payload) tags.push(['payload', await SignatureService.sign(payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength) as ArrayBuffer)])
    try {
      const signed = await signer.signEvent({ kind: 27235, created_at: Math.floor(Date.now() / 1000), tags, content: '' })
      return `Nostr ${btoa(unescape(encodeURIComponent(JSON.stringify(signed))))}`
    } catch { return null }
  }
}
