// hypercomb-web/src/app/core/core-adapter.ts

import { Injectable, inject } from "@angular/core"
import { Navigation, Lineage, ScriptPreloader, Store, LayerInstaller, DependencyLoader, OpfsTreeLogger } from "@hypercomb/shared/core"
import { LocationParser } from "@hypercomb/shared/core/initializers/location-parser"
import { LayerService } from "./layer-service"
import { RuntimeMediator } from "@hypercomb/shared/ui/runtime-mediator"

const _ = [DependencyLoader, LayerInstaller, LayerService, Store]

@Injectable({ providedIn: 'root' })
export class CoreAdapter {
  private static readonly CONTENT_BASE_URL = 'https://storagehypercomb.blob.core.windows.net/content'
  private static readonly FALLBACK_SIGNATURE = '6a09457f907419eb03493cda1d8e43d24a76e8f72acbcdbebd894b4bed5d0c08'
  private static readonly SIGNATURE_REGEX = /^[a-f0-9]{64}$/i
  private static readonly INSTALLED_SIGNATURE_KEY = 'core-adapter.installed-signature'

  // -------------------------------------------------
  // dependencies
  // -------------------------------------------------

  private readonly navigation = inject(Navigation)
  private readonly lineage = inject(Lineage)
  private readonly preloader = inject(ScriptPreloader)
  private readonly runtime = inject(RuntimeMediator)

  // -------------------------------------------------
  // state
  // -------------------------------------------------

  private initialized = false

  // -------------------------------------------------
  // public api
  // -------------------------------------------------

  public initialize = async (): Promise<void> => {

    if (this.initialized) return
    this.initialized = true

    const logger = <OpfsTreeLogger>window.ioc.get("OpfsTreeLogger")
    await logger.log()

    const store = window.ioc.get('Store') as Store

    // opfs roots
    await store.initialize()

    const signature = await this.resolveLatestSignature() || CoreAdapter.FALLBACK_SIGNATURE
    const installUrl = `${CoreAdapter.CONTENT_BASE_URL}/${signature}`
    const parsed = LocationParser.parse(installUrl)
    console.log('[core-adapter] auto-install url:', installUrl)

    const shouldInstall = await this.shouldInstallSignature(store, signature)
    if (shouldInstall) {
      await this.resetRuntimeInstallState(store)
      await this.runtime.sync(parsed)
      this.setInstalledSignature(signature)
      console.log('[core-adapter] installed signature:', signature)
    } else {
      const dependency = window.ioc.get('DependencyLoader') as DependencyLoader | undefined
      await dependency?.load?.()
      console.log('[core-adapter] install skipped (already current):', signature)
    }

    await this.preloader.preload()

    // initialize navigation + lineage after content is available
    await this.lineage.initialize()

    const segments = this.navigation.segments().filter(Boolean)
    this.navigation.bootstrap(segments)


    const { list } = window.ioc
    const l = list();
    console.log('[core-adapter] ioc keys:', l)

    const hostkey = 'PixiHost'
    const host = window.ioc.get(hostkey) as { encounter?: (arg: string) => Promise<void> | void } | undefined
    await host?.encounter?.('testing')

    const showkey = 'ShowHoneycomb'
    const show = window.ioc.get(showkey) as { encounter?: (arg: string) => Promise<void> | void } | undefined
    await show?.encounter?.('testing')

    // const zoomkey = 'ZoomDrone'
    // const zoom = <any>get(zoomkey)!
    // await zoom.encounter('testing')

    //     const panningkey = 'PanningDrone'
    // const panning = <any>get(panningkey)!
    // await panning.encounter('testing')

    // const settingKey = 'Settings'
    // const setting = <any>get(settingKey)
    // await setting.encounter('testing')
    // console.log('got setting:', setting)
  }

  private readonly resetRuntimeInstallState = async (store: Store): Promise<void> => {
    await this.clearDirectory(store.layers)
    await this.clearDirectory(store.drones)
    await this.clearDirectory(store.dependencies)

    // optional legacy directory name used by older runtimes
    try {
      const resources = await store.opfsRoot.getDirectoryHandle('__resources__', { create: false })
      await this.clearDirectory(resources)
    } catch {
      // ignore when absent
    }
  }

  private readonly clearDirectory = async (dir: FileSystemDirectoryHandle): Promise<void> => {
    for await (const [name] of dir.entries()) {
      try {
        await dir.removeEntry(name, { recursive: true })
      } catch {
        // ignore individual remove failures; install pipeline will refill what it needs
      }
    }
  }

  private readonly shouldInstallSignature = async (store: Store, signature: string): Promise<boolean> => {
    const installed = this.getInstalledSignature()
    if (installed !== signature) return true

    const hasLayers = await this.hasAnyEntries(store.layers)
    const hasDrones = await this.hasAnyEntries(store.drones)
    const hasDependencies = await this.hasAnyEntries(store.dependencies)

    return !(hasLayers && hasDrones && hasDependencies)
  }

  private readonly hasAnyEntries = async (dir: FileSystemDirectoryHandle): Promise<boolean> => {
    for await (const _entry of dir.entries()) {
      return true
    }
    return false
  }

  private readonly getInstalledSignature = (): string => {
    return (localStorage.getItem(CoreAdapter.INSTALLED_SIGNATURE_KEY) ?? '').trim().toLowerCase()
  }

  private readonly setInstalledSignature = (signature: string): void => {
    localStorage.setItem(CoreAdapter.INSTALLED_SIGNATURE_KEY, signature)
  }

  private readonly resolveLatestSignature = async (): Promise<string | null> => {
    const fromPointer = await this.resolveFromPointerFiles()
    if (fromPointer) return fromPointer

    const fromListing = await this.resolveFromContainerListing()
    if (fromListing) return fromListing

    return null
  }

  private readonly resolveFromPointerFiles = async (): Promise<string | null> => {
    const candidates = [
      `${CoreAdapter.CONTENT_BASE_URL}/latest.txt`,
      `${CoreAdapter.CONTENT_BASE_URL}/latest`,
      `${CoreAdapter.CONTENT_BASE_URL}/latest.json`,
      `${CoreAdapter.CONTENT_BASE_URL}/__latest__.txt`,
      `${CoreAdapter.CONTENT_BASE_URL}/__latest__.json`
    ]

    for (const url of candidates) {
      const text = await this.fetchText(url)
      if (!text) continue

      const direct = this.extractSignature(text)
      if (direct) return direct

      try {
        const json = JSON.parse(text) as { signature?: string; latest?: string; root?: string }
        const parsed = this.extractSignature(json.signature) || this.extractSignature(json.latest) || this.extractSignature(json.root)
        if (parsed) return parsed
      } catch {
        // ignore non-json
      }
    }

    return null
  }

  private readonly resolveFromContainerListing = async (): Promise<string | null> => {
    const listUrl = `${CoreAdapter.CONTENT_BASE_URL}?restype=container&comp=list`
    const xml = await this.fetchText(listUrl)
    if (!xml) return null

    const blobBlocks = [...xml.matchAll(/<Blob>([\s\S]*?)<\/Blob>/g)]

    let winner: { signature: string; time: number } | null = null

    for (const block of blobBlocks) {
      const body = block[1] ?? ''
      const name = /<Name>([^<]+)<\/Name>/.exec(body)?.[1]?.trim() ?? ''
      if (!name.endsWith('/install.manifest.json')) continue

      const dateText = /<Last-Modified>([^<]+)<\/Last-Modified>/.exec(body)?.[1]?.trim() ?? ''
      const time = Date.parse(dateText)
      if (!Number.isFinite(time)) continue

      const signature = this.extractSignature(name)
      if (!signature) continue

      if (!winner || time > winner.time) {
        winner = { signature, time }
      }
    }

    return winner?.signature ?? null
  }

  private readonly fetchText = async (url: string): Promise<string | null> => {
    try {
      const response = await fetch(url, { cache: 'no-store' })
      if (!response.ok) return null
      return await response.text()
    } catch {
      return null
    }
  }

  private readonly extractSignature = (raw: string | null | undefined): string | null => {
    const text = (raw ?? '')
      .replace(/\uFEFF/g, '')
      .trim()
    if (!text) return null

    const fromPath = text.split('/').filter(Boolean).at(-1) ?? text
    const clean = fromPath.replace(/\.json$/i, '').replace(/\.txt$/i, '')

    return CoreAdapter.SIGNATURE_REGEX.test(clean) ? clean.toLowerCase() : null
  }
}