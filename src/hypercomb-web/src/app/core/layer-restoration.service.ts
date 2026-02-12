// hypercomb-web/src/app/core/layer-restoration.service.ts

import { Injectable, inject } from '@angular/core'
import { DronePayloadResolver } from './drone-payload-resolver.service'
import { LayerInstallCollection } from './layer-install-collection'
import { Store } from './store'

@Injectable({ providedIn: 'root' })
export class LayerRestorationService {

  private readonly drones = inject(DronePayloadResolver)
  private readonly installs = inject(LayerInstallCollection)
  private readonly store = inject(Store)

  private static readonly LOCATION_FILE = '__location__'
  private static readonly INSTALL_SUFFIX = '-install'
  private static readonly HYDRATED_SUFFIX = '-hydrated'

  public restore = async (): Promise<void> => {
    const layersRoot = this.store.layersDirectory()

    for await (const [domain, entry] of layersRoot.entries()) {
      if (entry.kind !== 'directory') continue
      await this.restoreDomain(domain, entry as FileSystemDirectoryHandle)
    }
  }

  private restoreDomain = async (
    domain: string,
    domainLayersDir: FileSystemDirectoryHandle
  ): Promise<void> => {

    const location = await this.readLocation(domainLayersDir)

    const seeds: string[] = []

    for await (const [name, entry] of domainLayersDir.entries()) {
      if (entry.kind !== 'file') continue
      if (!name.endsWith(LayerRestorationService.INSTALL_SUFFIX)) continue

      const sig = name.slice(0, -LayerRestorationService.INSTALL_SUFFIX.length).toLowerCase()
      if (!this.isSignature(sig)) continue

      seeds.push(sig)
    }

    const visited = new Set<string>()

    for (const sig of seeds) {
      await this.restoreRecursive(domain, domainLayersDir, location, sig, visited)
    }
  }

  private restoreRecursive = async (
    domain: string,
    domainLayersDir: FileSystemDirectoryHandle,
    location: string | null,
    signature: string,
    visited: Set<string>
  ): Promise<void> => {

    if (visited.has(signature)) return
    visited.add(signature)

    // installed mode can short-circuit via hydrated markers
    if (mode === 'installed') {
      const hydrated = await this.fileExists(domainLayersDir, `${signature}${LayerRestorationService.HYDRATED_SUFFIX}`)
      if (hydrated) return
    }

    const manifest = await this.installs.resolve({  domain, location, signature, domainLayersDir })
    if (!manifest) return

    const drones = (manifest.drones ?? []).filter(s => this.isSignature(s))

    for (const sig of drones) {
      await this.drones.ensure(location ?? '', sig)
    }

    // installed mode persists hydration completion so boots are fast
    if (mode === 'installed') {
      await domainLayersDir.getFileHandle(`${signature}${LayerRestorationService.HYDRATED_SUFFIX}`, { create: true })
    }

    const children = (manifest.children ?? []).filter(s => this.isSignature(s))

    for (const childSig of children) {
      await this.restoreRecursive(mode, domain, domainLayersDir, location, childSig, visited)
    }
  }

  private readLocation = async (dir: FileSystemDirectoryHandle): Promise<string | null> => {
    try {
      const handle = await dir.getFileHandle(LayerRestorationService.LOCATION_FILE)
      const file = await handle.getFile()
      const text = (await file.text()).trim()
      return text ? text.replace(/\/+$/, '') : null
    } catch {
      return null
    }
  }

  private fileExists = async (dir: FileSystemDirectoryHandle, name: string): Promise<boolean> => {
    try {
      await dir.getFileHandle(name, { create: false })
      return true
    } catch {
      return false
    }
  }

  private isSignature = (value: string): boolean =>
    /^[a-f0-9]{64}$/i.test((value ?? '').trim())
}
