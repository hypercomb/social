import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { SIGNATURE_RE } from './replicate.js'

const hash = bytes => createHash('sha256').update(bytes).digest('hex')

export class ReceiptIndex {
  #contentDir
  #resolve
  #owners = new Map()

  constructor(contentDir, resolveSignature) {
    this.#contentDir = contentDir
    this.#resolve = resolveSignature
    try {
      for (const name of readdirSync(join(contentDir, '.receipts'))) {
        const match = /^([a-f0-9]{64})\.json$/.exec(name)
        if (match) this.load(match[1])
      }
    } catch { /* first boot has no receipt directory */ }
  }

  #path(owner) { return join(this.#contentDir, '.receipts', `${owner}.json`) }

  load(owner) {
    let state = this.#owners.get(owner)
    if (state) return state
    let document = null
    try { document = JSON.parse(readFileSync(this.#path(owner), 'utf8')) } catch {}
    const signatures = new Set(Array.isArray(document?.signatures) ? document.signatures.filter(sig => SIGNATURE_RE.test(sig)) : [])
    let changed = false
    for (const signature of signatures) {
      const hit = this.#resolve(signature)
      try {
        if (!hit || hash(readFileSync(hit.path)) !== signature) { signatures.delete(signature); changed = true }
      } catch { signatures.delete(signature); changed = true }
    }
    state = {
      owner,
      signatures,
      revision: Number.isSafeInteger(document?.revision) ? document.revision : 0,
      updatedAt: typeof document?.updatedAt === 'string' ? document.updatedAt : new Date(0).toISOString(),
    }
    this.#owners.set(owner, state)
    if (changed) this.#persist(state)
    return state
  }

  add(owner, signatures) {
    const state = this.load(owner)
    let changed = false
    for (const signature of signatures) {
      if (SIGNATURE_RE.test(signature) && !state.signatures.has(signature)) { state.signatures.add(signature); changed = true }
    }
    if (changed) this.#persist(state)
    return state
  }

  document(owner) {
    const state = this.load(owner)
    return {
      version: 1,
      revision: state.revision,
      updatedAt: state.updatedAt,
      signatures: [...state.signatures].sort(),
    }
  }

  etag(owner) { return `\"receipts-${this.load(owner).revision}\"` }

  #persist(state) {
    state.revision++
    state.updatedAt = new Date().toISOString()
    const dir = join(this.#contentDir, '.receipts')
    mkdirSync(dir, { recursive: true })
    const target = this.#path(state.owner)
    const part = `${target}.part-${randomBytes(6).toString('hex')}`
    const bytes = JSON.stringify(this.document(state.owner)) + '\n'
    try {
      writeFileSync(part, bytes, { flag: 'wx' })
      renameSync(part, target)
    } finally { try { rmSync(part, { force: true }) } catch {} }
  }
}
