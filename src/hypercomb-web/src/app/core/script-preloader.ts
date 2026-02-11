// hypercomb-web/src/app/core/script-preloader.ts

import { inject, Injectable, signal } from '@angular/core'
import { environment } from '../../environments/environment'
import { Drone, type DroneResolver } from '@hypercomb/core'
import { Lineage } from './lineage'
import { Store, type DevManifest } from './store'

export interface ActionDescriptor {
  signature: string
  name: string // kebab-case, ux-facing
}

@Injectable({ providedIn: 'root' })
export class ScriptPreloader implements DroneResolver {

  private readonly lineage = inject(Lineage)
  private readonly store = inject(Store)

  private readonly bySignature = new Map<string, ActionDescriptor>()

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

  private preloadFromOpfs = async (): Promise<void> => {
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

    try {
      const globalResources = await this.store.opfsRoot.getDirectoryHandle(Store.RESOURCES_DIRECTORY)
      await this.loadAllFromDirectory(globalResources)
    } catch {
      // ignore
    }
  }

  private preloadFromDev = async (): Promise<void> => {
    const manifest = await this.store.getDevManifest()
    if (!manifest) return

    const resourcesByDomain = this.readResourcesByDomain(manifest)
    if (!resourcesByDomain) return

    for (const [domain, sigs] of Object.entries(resourcesByDomain).sort((a, b) => a[0].localeCompare(b[0]))) {
      for (const sig of sigs) {
        if (!this.isSignature(sig)) continue
        if (this.bySignature.has(sig)) continue

        let buffer: ArrayBuffer | null = null
        try {
          // IMPORTANT: fetch as non-js so vite will not import-analyze it
          const url = `/dev/${domain}/${Store.RESOURCES_DIRECTORY}/${sig}`
          const r = await fetch(url, { cache: 'no-store' })
          if (!r.ok) continue
          buffer = await r.arrayBuffer()
        } catch {
          // ignore
        }

        if (!buffer) continue

        const drone = await this.store.getDrone(sig, buffer)
        if (!drone) continue

        this.bySignature.set(sig, { signature: sig, name: drone.name })
        this.resourceCount.update(v => v + 1)
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

        this.bySignature.set(sig, { signature: sig, name: drone.name })
        this.resourceCount.update(v => v + 1)
      } catch {
        // ignore
      }
    }
  }

  private refreshProjection = (): void => {
    const list = [...this.bySignature.values()].sort((a, b) => a.name.localeCompare(b.name))
    this.actions.set(list)
    this.actionNames.set(list.map(a => a.name.replace(/-/g, ' ')))
  }

  private isSignature = (name: string): boolean =>
    /^[a-f0-9]{64}$/i.test(name)

  private isDomainName = (name: string): boolean => {
    const raw = (name ?? '').trim()
    if (!raw || raw.startsWith('__')) return false
    if (raw === Store.RESOURCES_DIRECTORY) return false
    if (raw === Store.DEPENDENCIES_DIRECTORY) return false
    if (raw === 'hypercomb') return false
    return /^[a-z0-9.-]+$/i.test(raw) && raw.includes('.')
  }
}
