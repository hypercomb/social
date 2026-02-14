// hypercomb-web/src/app/core/layer-installer.ts

import { Injectable, inject } from '@angular/core'
import { DevManifest, Store } from './store'

type LayerInstallFile = {
  signature: string
  name?: string
  layers?: string[]
  drones?: string[]
  dependencies?: string[]
}

@Injectable({ providedIn: 'root' })
export class LayerInstaller {

  private readonly store = inject(Store)

  private static readonly INSTALL_SUFFIX = '-install'

  public install = async (manifest: DevManifest): Promise<void> => {
    const domains = Array.from(manifest.domains as any) as string[]

    for (const domain of domains) {
      const domainLayersDir = await this.store.domainLayersDirectory(domain, true)

      // seed root install json once (no empty marker files)
      await this.ensureInstallJson(domain, domainLayersDir, manifest.root)

      await this.installDomain(domain, domainLayersDir)
    }

    console.log('[layer-installer] install complete for manifest')
  }

  private installDomain = async (domain: string, domainLayersDir: FileSystemDirectoryHandle): Promise<void> => {
    const visited = new Set<string>()
    await this.installLoop(domain, domainLayersDir, visited)
  }

  private installLoop = async (
    domain: string,
    layersDomainDir: FileSystemDirectoryHandle,
    visited: Set<string>
  ): Promise<void> => {

    // scan until no more install files exist
    // deterministic: opfs entries iteration order is not guaranteed, so we sort each pass
    for (;;) {
      const installNames: string[] = []

      for await (const [name, handle] of layersDomainDir.entries()) {
        if (handle.kind !== 'file') continue
        if (!name.endsWith(LayerInstaller.INSTALL_SUFFIX)) continue
        installNames.push(name)
      }

      installNames.sort((a, b) => a.localeCompare(b))

      if (!installNames.length) return

      let progressed = false

      for (const name of installNames) {
        const sig = this.installNameToSig(name)
        if (!sig) continue

        // if something re-seeded an already-consumed install file during this run, delete it
        if (visited.has(sig)) {
          await this.safeRemove(layersDomainDir, name)
          continue
        }

        // try to open the file by name (it may have been removed by a prior step)
        const handle = await this.tryGetFileHandle(layersDomainDir, name)
        if (!handle) continue

        const { ok, layerText, layer } = await this.readInstallLayer(domain, layersDomainDir, sig, handle)
        if (!ok || !layerText || !layer) {
          // bad/empty/invalid install json -> consume marker to avoid infinite loop
          // if you prefer to keep it for debugging, remove this line
          await this.safeRemove(layersDomainDir, name)
          continue
        }

        visited.add(sig)
        progressed = true

        console.log(`[layer-installer] installing layer ${sig} (${layerText.length} chars)`)

        // install dependencies (dev fetch -> opfs)
        await this.installDependencies(domain, layer)

        // install drones (dev fetch -> opfs)
        await this.installDrones(domain, layer)

        // seed children (write childSig-install json)
        for (const childSig of layer.layers ?? []) {
          await this.ensureInstallJson(domain, layersDomainDir, childSig)
        }

        // consume install marker into a stable file named by sig (optional but matches your convention)
        await this.writeTextFile(layersDomainDir, sig, layerText)

        // delete the install file
        await this.safeRemove(layersDomainDir, name)
      }

      if (!progressed) return
    }
  }

  // -------------------------------------------------
  // install steps
  // -------------------------------------------------

  private installDependencies = async (domain: string, layer: LayerInstallFile): Promise<void> => {
    const targetDirectory = this.store.dependenciesDirectory()
    const devBase = `/dev/${domain}/__dependencies__/`

    for (const dependency of layer.dependencies ?? []) {
      const exists = await this.tryGetFileHandle(targetDirectory, dependency)
      if (exists) {
        console.log(`[layer-installer] dependency already present: ${dependency}`)
        continue
      }

      const url = `${devBase}${dependency}`
      const bytes = await this.fetchBytes(url)
      if (!bytes) continue

      await this.writeBytesFile(targetDirectory, dependency, bytes)
      console.log(`[layer-installer] stored dependency ${dependency} (${bytes.byteLength} bytes)`)
    }
  }

  private installDrones = async (domain: string, layer: LayerInstallFile): Promise<void> => {
    const targetDirectory = this.store.dronesDirectory()
    const devBase = `/dev/${domain}/__drones__/`

    for (const drone of layer.drones ?? []) {
      const exists = await this.tryGetFileHandle(targetDirectory, drone)
      if (exists) {
        console.log(`[layer-installer] drone already present: ${drone}`)
        continue
      }

      const url = `${devBase}${drone}`
      const bytes = await this.fetchBytes(url)
      if (!bytes) continue

      await this.writeBytesFile(targetDirectory, drone, bytes)
      console.log(`[layer-installer] stored drone ${drone} (${bytes.byteLength} bytes)`)
    }
  }

  // -------------------------------------------------
  // install json handling
  // -------------------------------------------------

  private ensureInstallJson = async (
    domain: string,
    layersDomainDir: FileSystemDirectoryHandle,
    sig: string
  ): Promise<void> => {

    const installName = `${sig}${LayerInstaller.INSTALL_SUFFIX}`

    const existing = await this.tryGetFileHandle(layersDomainDir, installName)
    if (existing) {
      const file = await existing.getFile().catch(() => null)
      if (file && file.size > 0) return
    }

    const url = `/dev/${domain}/__layers__/${sig}.json`
    const bytes = await this.fetchBytes(url)
    if (!bytes) return

    await this.writeBytesFile(layersDomainDir, installName, bytes)
    console.log(`[layer-installer] seeded install ${installName} (${bytes.byteLength} bytes)`)
  }

  private readInstallLayer = async (
    domain: string,
    layersDomainDir: FileSystemDirectoryHandle,
    sig: string,
    handle: FileSystemFileHandle
  ): Promise<{ ok: boolean; layerText: string | null; layer: LayerInstallFile | null }> => {

    const file = await handle.getFile().catch(() => null)
    if (!file) return { ok: false, layerText: null, layer: null }

    let text = await file.text().catch(() => '')
    text = (text ?? '').trim()

    // if we ever ended up with an empty marker, repair it by refetching the real json
    if (!text) {
      await this.ensureInstallJson(domain, layersDomainDir, sig)
      const repaired = await this.tryGetFileHandle(layersDomainDir, `${sig}${LayerInstaller.INSTALL_SUFFIX}`)
      if (!repaired) return { ok: false, layerText: null, layer: null }

      const repairedFile = await repaired.getFile().catch(() => null)
      if (!repairedFile) return { ok: false, layerText: null, layer: null }

      text = (await repairedFile.text().catch(() => '')).trim()
      if (!text) return { ok: false, layerText: null, layer: null }
    }

    try {
      const json = JSON.parse(text) as LayerInstallFile
      return { ok: true, layerText: text, layer: json }
    } catch {
      console.log(`[layer-installer] invalid json in ${sig}${LayerInstaller.INSTALL_SUFFIX}`)
      return { ok: false, layerText: text, layer: null }
    }
  }

  private installNameToSig = (name: string): string | null => {
    if (!name.endsWith(LayerInstaller.INSTALL_SUFFIX)) return null
    const raw = name.slice(0, -LayerInstaller.INSTALL_SUFFIX.length)
    return raw.replace(/^install-/, '') || null
  }

  // -------------------------------------------------
  // opfs utilities
  // -------------------------------------------------

  private tryGetFileHandle = async (
    dir: FileSystemDirectoryHandle,
    name: string
  ): Promise<FileSystemFileHandle | null> => {
    try {
      return await dir.getFileHandle(name)
    } catch {
      return null
    }
  }

  private safeRemove = async (dir: FileSystemDirectoryHandle, name: string): Promise<void> => {
    try {
      await dir.removeEntry(name)
    } catch {
      // ignore
    }
  }

  private writeBytesFile = async (
    dir: FileSystemDirectoryHandle,
    name: string,
    bytes: Uint8Array
  ): Promise<void> => {
    const outHandle = await dir.getFileHandle(name, { create: true })
    const writable = await outHandle.createWritable()
    await writable.write(bytes)
    await writable.close()
  }

  private writeTextFile = async (
    dir: FileSystemDirectoryHandle,
    name: string,
    text: string
  ): Promise<void> => {
    const outHandle = await dir.getFileHandle(name, { create: true })
    const writable = await outHandle.createWritable()
    await writable.write(text)
    await writable.close()
  }

  // -------------------------------------------------
  // fetch utilities
  // -------------------------------------------------

  private fetchBytes = async (url: string): Promise<Uint8Array | null> => {
    try {
      const res = await fetch(url, { cache: 'no-store' })

      const ct = (res.headers.get('content-type') ?? '').toLowerCase()
      console.log(`[layer-installer] fetch ${url} -> ${res.status} ${ct}`)

      if (!res.ok) {
        const body = await res.text().catch(() => '')
        console.log(`[layer-installer] fetch failed body (first 200): ${body.slice(0, 200)}`)
        return null
      }

      if (ct.includes('text/html')) {
        const body = await res.text().catch(() => '')
        console.log(`[layer-installer] unexpected html (first 200): ${body.slice(0, 200)}`)
        return null
      }

      return new Uint8Array(await res.arrayBuffer())
    } catch (err) {
      console.log(`[layer-installer] fetch error ${url}`, err)
      return null
    }
  }
}
