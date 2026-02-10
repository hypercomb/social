// hypercomb-web/src/app/core/script-preloader.ts

import { inject, Injectable, signal } from '@angular/core'
import { environment } from '../../environments/environment'
import { Drone, type DroneResolver } from '@hypercomb/core'
import { Lineage } from './lineage'
import { DirectoryWalkerService } from './directory-walker.service'
import { Store, type DevManifest } from './store'

export interface ActionDescriptor {
  signature: string
  name: string // kebab-case, ux-facing
}

@Injectable({ providedIn: 'root' })
export class ScriptPreloader implements DroneResolver {

  private readonly lineage = inject(Lineage)
  private readonly walker = inject(DirectoryWalkerService)
  private readonly store = inject(Store)

  // authoritative projection (no instances here)
  private readonly bySignature = new Map<string, ActionDescriptor>()

  // projected state (ui)
  public readonly actions = signal<readonly ActionDescriptor[]>([])
  public readonly actionNames = signal<readonly string[]>([])
  public readonly resourceCount = signal(0)

  public resolveBySignature = (signature: string): ActionDescriptor | undefined =>
    this.bySignature.get(signature)

  public getActionName = (signature: string): string | null =>
    this.bySignature.get(signature)?.name ?? null

  public find = async (_name: string): Promise<Drone[]> => {
    return []
  }

  // -------------------------------------------------
  // bulk initialization (discovery only)
  // -------------------------------------------------

  public preload = async (): Promise<void> => {
    this.bySignature.clear()
    this.actions.set([])
    this.actionNames.set([])
    this.resourceCount.set(0)

    if (environment.production) {
      await this.preloadFromOpfs()
    } else {
      await this.preloadFromDev()
    }

    this.refreshProjection()
  }

  // -------------------------------------------------
  // production: scan available opfs resource locations
  // -------------------------------------------------

  private preloadFromOpfs = async (): Promise<void> => {
    // a) scan domain folders: opfs/<domain>/__resources__/<sig>
    for await (const [name, entry] of this.store.opfsRoot.entries()) {
      if (entry.kind !== 'directory') continue
      if (!this.isDomainName(name)) continue

      const domainDir = entry as FileSystemDirectoryHandle

      let resourcesDir: FileSystemDirectoryHandle
      try {
        resourcesDir = await domainDir.getDirectoryHandle(Store.RESOURCES_DIRECTORY)
      } catch {
        continue
      }

      await this.loadAllFromDirectory(resourcesDir)
    }

    // b) compatibility: opfs/__resources__/<sig>
    try {
      const globalResources = await this.store.opfsRoot.getDirectoryHandle(Store.RESOURCES_DIRECTORY)
      await this.loadAllFromDirectory(globalResources)
    } catch {
      // ignore
    }
  }

  // -------------------------------------------------
  // development: use manifest.resources -> /dev/<domain>/__resources__/<sig>
  // -------------------------------------------------

  private preloadFromDev = async (): Promise<void> => {
    const manifest = await this.store.getDevManifest()
    if (!manifest) return

    // preferred contract (new):
    // name.manifest.js exports { imports, resources }
    const resourcesByDomain = this.readResourcesByDomain(manifest)

    if (resourcesByDomain) {
      for (const [domain, sigs] of Object.entries(resourcesByDomain).sort((a, b) => a[0].localeCompare(b[0]))) {
        for (const sig of sigs) {
          if (!this.isSignature(sig)) continue
          if (this.bySignature.has(sig)) continue

          let buffer: ArrayBuffer | null = null
          try {
            const url = `/dev/${domain}/${Store.RESOURCES_DIRECTORY}/${sig}`
            const r = await fetch(url)
            if (!r.ok) continue
            buffer = await r.arrayBuffer()
          } catch (err) {
            console.log(`[store] failed to fetch resource ${sig} for domain ${domain}:`, err)
          }

          if (!buffer) continue

          const drone = await this.store.getDrone(sig, buffer)
          if (!drone) continue

          const { register } = window.ioc
          register(sig, drone)
        }
      }

      return
    }

    // legacy fallback (old): manifest.domains -> runtime url -> runtime.resources[]
    const domains = manifest.domains as Record<string, unknown> | undefined
    if (!domains || typeof domains !== 'object') return

    for (const [domain, domainInfo] of Object.entries(domains)) {
      const runtimeUrl = this.getRuntimeUrl(domainInfo)
      if (!runtimeUrl) continue

      let runtime: any
      try {
        runtime = await import(/* @vite-ignore */ runtimeUrl)
      } catch {
        continue
      }

      const sigs = runtime?.resources
      if (!Array.isArray(sigs)) continue

      for (const sig of sigs) {
        if (!this.isSignature(sig)) continue
        if (this.bySignature.has(sig)) continue

        let buffer: ArrayBuffer | null = null
        try {
          const url = `/dev/${domain}/${Store.RESOURCES_DIRECTORY}/${sig}`
          const r = await fetch(url)
          if (!r.ok) continue
          buffer = await r.arrayBuffer()
        } catch (err) {
          console.log(`[store] failed to fetch resource ${sig} for domain ${domain}:`, err)
        }

        if (!buffer) continue

        const drone = await this.store.getDrone(sig, buffer)
        if (!drone) continue

        const { register } = window.ioc
        register(sig, drone)
      }
    }
  }

  private readResourcesByDomain = (manifest: DevManifest): Record<string, string[]> | null => {
    const v = manifest?.resources
    if (!v || typeof v !== 'object') return null

    const out: Record<string, string[]> = {}
    for (const [domain, raw] of Object.entries(v)) {
      if (typeof domain !== 'string' || !domain.trim()) continue
      if (!Array.isArray(raw)) continue

      const list = raw
        .filter(x => typeof x === 'string' && x.trim().length)
        .map(x => (x as string).trim())
        .filter(x => this.isSignature(x))

      if (!list.length) continue
      out[domain] = list
    }

    return Object.keys(out).length ? out : null
  }

  // -------------------------------------------------
  // helpers
  // -------------------------------------------------

  private loadAllFromDirectory = async (resourcesDir: FileSystemDirectoryHandle): Promise<void> => {
    for await (const [sig, entry] of resourcesDir.entries()) {
      if (entry.kind !== 'file') continue
      if (!this.isSignature(sig)) continue
      if (this.bySignature.has(sig)) continue

      try {
        const file = await (entry as FileSystemFileHandle).getFile()
        const buffer = await file.arrayBuffer()

        const drone = await this.store.getDrone(sig, buffer)
        if (!drone) continue

        const { register } = window.ioc
        register(sig, drone)
      } catch {
        // ignore and continue
      }
    }
  }

  private refreshProjection = (): void => {
    const list = [...this.bySignature.values()]
      .sort((a, b) => a.name.localeCompare(b.name))

    this.actions.set(list)
    this.actionNames.set(list.map(a => a.name.replace(/-/g, ' ')))
  }

  private getRuntimeUrl = (domainInfo: unknown): string | null => {
    if (typeof domainInfo === 'string') return domainInfo
    if (!domainInfo || typeof domainInfo !== 'object') return null

    const v = domainInfo as any
    const url = v.runtimeUrl ?? v.runtime ?? v.url
    return typeof url === 'string' ? url : null
  }

  private isSignature = (name: string): boolean =>
    /^[a-f0-9]{64}$/i.test(name)

  private isDomainName = (name: string): boolean => {
    const raw = (name ?? '').trim()
    if (!raw || raw.startsWith('__')) return false
    if (raw === Store.RESOURCES_DIRECTORY) return false
    if (raw === 'hypercomb') return false

    // "host-like" folders only
    return /^[a-z0-9.-]+$/i.test(raw) && raw.includes('.')
  }
}
