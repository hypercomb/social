// src/app/core/module-resolver.service.ts
import { Injectable } from '@angular/core'
import { SignatureService, type DronePayloadV1 } from '@hypercomb/core'

export type ModuleDroneV1 = {
  signature: string
  payload: DronePayloadV1
}

export type ModuleFileV1 = {
  version?: number
  module?: { name?: string }
  drones: ModuleDroneV1[]
}

export type ResolvedModule = {
  url: string
  domain: string
  module: ModuleFileV1
}

@Injectable({ providedIn: 'root' })
export class ModuleResolverService {

  public resolve = async (moduleSignature: string, domains: readonly string[]): Promise<ResolvedModule> => {
    const cleanSig = (moduleSignature ?? '').trim()
    if (!cleanSig) throw new Error('missing module signature')
    if (!domains.length) throw new Error('no trusted domains configured')

    let lastErr: unknown = null

    for (const domain of domains) {
      const base = (domain ?? '').replace(/\/+$/, '')
      if (!base) continue

      const url = `${base}/${cleanSig}`

      try {
        const res = await fetch(url, { cache: 'no-store' })
        if (!res.ok) continue

        const bytes = await res.arrayBuffer()
        const actual = await SignatureService.sign(bytes)
        if (actual !== cleanSig) continue

        const json = new TextDecoder().decode(bytes).trim()
        const parsed = JSON.parse(json) as ModuleFileV1

        if (!parsed || typeof parsed !== 'object') throw new Error('invalid module file (not an object)')
        if (!Array.isArray(parsed.drones)) throw new Error('invalid module file (missing drones array)')

        // light validation for list rendering
        for (const a of parsed.drones) {
          if (!a?.signature || typeof a.signature !== 'string') throw new Error('invalid module file (drone missing signature)')
          if (!a?.payload || typeof a.payload !== 'object') throw new Error('invalid module file (drone missing payload)')
        }

        return { url, domain: base, module: parsed }
      } catch (e) {
        lastErr = e
        continue
      }
    }

    if (lastErr instanceof Error) throw lastErr
    throw new Error('module not found on any trusted domain')
  }
}
