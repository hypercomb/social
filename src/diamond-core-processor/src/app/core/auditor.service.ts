// src/app/core/auditor.service.ts
import { Injectable } from '@angular/core'
import { SignatureService } from '@hypercomb/core'

export interface AuditorEndpoint {
  url: string
  name: string
}

export interface AuditResult {
  signature: string
  approvedBy: string[]
  total: number
  meetsThreshold: boolean
}

const AUDITORS_KEY = 'dcp.auditors'
const THRESHOLD_KEY = 'dcp.auditThreshold'

@Injectable({ providedIn: 'root' })
export class AuditorService {

  #endpoints: AuditorEndpoint[] = this.#loadEndpoints()
  #threshold: number = this.#loadThreshold()
  #cache = new Map<string, string[]>()

  get endpoints(): readonly AuditorEndpoint[] { return this.#endpoints }
  get threshold(): number { return this.#threshold }

  addEndpoint(url: string, name: string): void {
    const clean = (url ?? '').replace(/\/+$/, '')
    if (!clean) return
    if (this.#endpoints.some(e => e.url === clean)) return
    this.#endpoints = [...this.#endpoints, { url: clean, name: name || clean }]
    localStorage.setItem(AUDITORS_KEY, JSON.stringify(this.#endpoints))
  }

  removeEndpoint(url: string): void {
    this.#endpoints = this.#endpoints.filter(e => e.url !== url)
    localStorage.setItem(AUDITORS_KEY, JSON.stringify(this.#endpoints))
  }

  setThreshold(n: number): void {
    this.#threshold = Math.max(0, Math.floor(n))
    localStorage.setItem(THRESHOLD_KEY, String(this.#threshold))
  }

  async fetchApprovals(endpoint: AuditorEndpoint): Promise<string[]> {
    const cached = this.#cache.get(endpoint.url)
    if (cached) return cached

    const res = await fetch(endpoint.url, { cache: 'no-store' })
    if (!res.ok) return []

    const bytes = await res.arrayBuffer()
    const actual = await SignatureService.sign(bytes)

    // extract filename from URL — the last path segment should be the expected sig
    const segments = new URL(endpoint.url).pathname.split('/').filter(Boolean)
    const expectedSig = segments[segments.length - 1] ?? ''

    if (expectedSig && actual !== expectedSig) return []

    try {
      const text = new TextDecoder().decode(bytes)
      const parsed = JSON.parse(text)
      if (!Array.isArray(parsed)) return []
      const sigs = parsed.filter((s: unknown) => typeof s === 'string' && s.length === 64)
      this.#cache.set(endpoint.url, sigs)
      return sigs
    } catch {
      return []
    }
  }

  async audit(signature: string): Promise<AuditResult> {
    const approvedBy: string[] = []

    for (const ep of this.#endpoints) {
      try {
        const approvals = await this.fetchApprovals(ep)
        if (approvals.includes(signature)) {
          approvedBy.push(ep.name)
        }
      } catch {
        // auditor unavailable — skip
      }
    }

    return {
      signature,
      approvedBy,
      total: this.#endpoints.length,
      meetsThreshold: approvedBy.length >= this.#threshold
    }
  }

  async auditBatch(signatures: string[]): Promise<Map<string, AuditResult>> {
    // pre-fetch all approval lists in parallel
    const lists = await Promise.allSettled(
      this.#endpoints.map(ep => this.fetchApprovals(ep).then(sigs => ({ ep, sigs })))
    )

    const approvalMap = new Map<string, string[]>()
    for (const result of lists) {
      if (result.status !== 'fulfilled') continue
      const { ep, sigs } = result.value
      for (const sig of sigs) {
        const existing = approvalMap.get(sig) ?? []
        existing.push(ep.name)
        approvalMap.set(sig, existing)
      }
    }

    const results = new Map<string, AuditResult>()
    for (const sig of signatures) {
      const approvedBy = approvalMap.get(sig) ?? []
      results.set(sig, {
        signature: sig,
        approvedBy,
        total: this.#endpoints.length,
        meetsThreshold: approvedBy.length >= this.#threshold
      })
    }
    return results
  }

  clearCache(): void {
    this.#cache.clear()
  }

  #loadEndpoints(): AuditorEndpoint[] {
    try {
      return JSON.parse(localStorage.getItem(AUDITORS_KEY) ?? '[]')
    } catch {
      return []
    }
  }

  #loadThreshold(): number {
    try {
      return Math.max(0, parseInt(localStorage.getItem(THRESHOLD_KEY) ?? '1', 10))
    } catch {
      return 1
    }
  }
}
