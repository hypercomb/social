// hypercomb-web/src/app/core/layer-installer.service.ts

import { Injectable, inject } from '@angular/core'
import { LayerInstallCollectionService } from './layer-install-collection.service'
import { Store } from './store'
import { environment } from '../../environments/environment'

type LayerInstallFile = {
  signature: string
  name?: string
  children?: string[]
  drones?: string[]
}

@Injectable({ providedIn: 'root' })
export class LayerInstallerService {

  private readonly installs = inject(LayerInstallCollectionService)
  private readonly store = inject(Store)

  private static readonly LOCATION_FILE = '__location__'
  private static readonly INSTALL_SUFFIX = '-install'

  public install = async (): Promise<void> => {
    const layersRoot = this.store.layersDirectory()

    for await (const [domain, entry] of layersRoot.entries()) {
      if (entry.kind !== 'directory') continue
      await this.installDomain( domain, entry as FileSystemDirectoryHandle)
    }
  }

  private installDomain = async (
    domain: string,
    domainLayersDir: FileSystemDirectoryHandle
  ): Promise<void> => {

    const location = await this.readLocation(domainLayersDir)

    const seeds: string[] = []

    for await (const [name, entry] of domainLayersDir.entries()) {
      if (entry.kind !== 'file') continue
      if (!name.endsWith(LayerInstallerService.INSTALL_SUFFIX)) continue

      const sig = name.slice(0, -LayerInstallerService.INSTALL_SUFFIX.length).toLowerCase()
      if (!this.isSignature(sig)) continue

      seeds.push(sig)
    }

    const visited = new Set<string>()

    for (const sig of seeds) {
      await this.installRecursive( domain, domainLayersDir, location, sig, visited)
    }
  }

  private installRecursive = async (
    domain: string,
    domainLayersDir: FileSystemDirectoryHandle,
    location: string | null,
    signature: string,
    visited: Set<string>
  ): Promise<void> => {

    if (visited.has(signature)) return
    visited.add(signature)

    const manifest = await this.installs.resolve({ domain, location, signature, domainLayersDir })
    if (!manifest) return

    // in installed mode we persist resolved manifests into opfs so future boots are local
    if (environment.production === false) {
      await this.writeInstallManifest(domainLayersDir, `${signature}${LayerInstallerService.INSTALL_SUFFIX}`, manifest)
    }

    // always ensure child markers exist so the graph is discoverable from opfs
    const children = (manifest.children ?? []).filter(s => this.isSignature(s))

    for (const childSig of children) {
      const childFile = `${childSig}${LayerInstallerService.INSTALL_SUFFIX}`

      const exists = await this.fileExists(domainLayersDir, childFile)
      if (!exists) {
        // stub marker only
        await this.writeText(domainLayersDir, childFile, JSON.stringify({ signature: childSig }))
      }

      await this.installRecursive( domain, domainLayersDir, location, childSig, visited)
    }
  }

  private writeInstallManifest = async (
    dir: FileSystemDirectoryHandle,
    fileName: string,
    manifest: LayerInstallFile
  ): Promise<void> => {

    const payload = JSON.stringify({
      signature: manifest.signature,
      name: manifest.name ?? '',
      children: (manifest.children ?? []).filter(x => this.isSignature(String(x ?? ''))),
      drones: (manifest.drones ?? []).filter(x => this.isSignature(String(x ?? '')))
    })

    await this.writeText(dir, fileName, payload)
  }

  private writeText = async (
    dir: FileSystemDirectoryHandle,
    name: string,
    text: string
  ): Promise<void> => {
    const handle = await dir.getFileHandle(name, { create: true })
    const writable = await handle.createWritable({ keepExistingData: false })
    try {
      await writable.write(text)
    } finally {
      await writable.close()
    }
  }

  private readLocation = async (dir: FileSystemDirectoryHandle): Promise<string | null> => {
    try {
      const handle = await dir.getFileHandle(LayerInstallerService.LOCATION_FILE, { create: false })
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
