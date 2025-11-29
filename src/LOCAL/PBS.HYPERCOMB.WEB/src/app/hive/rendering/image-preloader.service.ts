// src/app/hive/rendering/image-preloader.service.ts
import { Injectable, effect, inject } from "@angular/core"
import { Assets, Texture } from "pixi.js"
import { LocalAssets } from "src/app/helper/constants"
import { CarouselService } from "src/app/common/carousel-menu/carousel-service"
import { OpfsHiveService } from "../storage/opfs-hive-service"
import { OpfsImageService } from "../storage/opfs-image.service"
import { BlobService } from "./blob-service"

type LocalAssetsWithHash = typeof LocalAssets & { InitialImageHash?: string }

@Injectable({ providedIn: "root" })
export class ImagePreloader {
  // how many hives to keep preloaded above and below the current one
  private readonly depth = 3

  private readonly carousel = inject(CarouselService)
  private readonly opfsHives = inject(OpfsHiveService)
  private readonly images = inject(OpfsImageService)
  private readonly blobs = inject(BlobService)

  // recordkeeping
  private readonly seenHives = new Set<string>()
  private readonly seenHashes = new Set<string>()
  private readonly onDeckHives = new Set<string>()
  private isProcessingQueue = false

  private initialTileHash?: string

  constructor() {
    // preload default image + static assets first
    void this.preloadDefaults()

    // track carousel rotation and keep next / previous hives preloaded
    effect(() => {
      const upper = this.carousel.upper()
      const lower = this.carousel.lower()

      // combine both sides, skipping current hive (we only care about on-deck)
      const targets: string[] = []
      upper.slice(0, this.depth).forEach(h => targets.push(h.name))
      lower.slice(0, this.depth).forEach(h => targets.push(h.name))

      this.updateOnDeck(targets)
    })
  }

  // expose hash of the default tile image
  public getInitialTileHash = (): string | undefined =>
    this.initialTileHash ?? (LocalAssets as LocalAssetsWithHash).InitialImageHash

  // image cache key helper (image only, not full tile)
  private getImageCacheKey = (hash: string): string => `img:${hash}`

  // ─────────────────────────────────────────────
  //  defaults: initial tile + static assets
  // ─────────────────────────────────────────────
  private preloadDefaults = async (): Promise<void> => {
    try {
      const blob = await this.blobs.getInitialBlob()
      const hash = await this.images.hashName(blob)

      this.initialTileHash = hash
      ;(LocalAssets as LocalAssetsWithHash).InitialImageHash = hash

      // persist blob for later lookups (idempotent if already present)
      await this.images.saveSmall(hash, blob)

      // warm image texture cache for the initial tile asset
      const key = this.getImageCacheKey(hash)
      if (!Assets.cache.has(key)) {
        const bitmap = await createImageBitmap(blob)
        const texture = Texture.from(bitmap)
        Assets.cache.set(key, texture)
      }
    } catch (err) {
      console.warn("⚠️ failed to preload initial tile", err)
    }

    await this.preloadStaticAssets()
  }

  private preloadStaticAssets = async (): Promise<void> => {
    const assetPaths = [
      LocalAssets.InitialImagePath,
      LocalAssets.PlaceholderPath,
      LocalAssets.Background,
      LocalAssets.TileMask,
      LocalAssets.YouTube,
    ]

    for (const path of assetPaths) {
      if (!path) continue
      await this.ensureAssetTexture(path)
    }
  }

  private ensureAssetTexture = async (path: string): Promise<void> => {
    if (Assets.cache.has(path)) return
    try {
      const blob = await this.blobs.fetchImageAsBlob(path)
      const url = URL.createObjectURL(blob)
      const texture = Texture.from(url)
      Assets.cache.set(path, texture)
    } catch (err) {
      console.warn("⚠️ failed to preload asset", path, err)
    }
  }

  // ─────────────────────────────────────────────
  //  rolling on-deck queue logic
  // ─────────────────────────────────────────────
  private updateOnDeck = (names: string[]): void => {
    const next = new Set(names.filter(Boolean))
    this.onDeckHives.clear()
    for (const name of next) this.onDeckHives.add(name)
    void this.processQueue()
  }

  private processQueue = async (): Promise<void> => {
    if (this.isProcessingQueue) return
    this.isProcessingQueue = true

    try {
      while (true) {
        const pending = [...this.onDeckHives].filter(
          n => !!n && !this.seenHives.has(n)
        )
        if (!pending.length) break

        const name = pending[0]
        this.seenHives.add(name)
        await this.preloadHive(name)
        await this.microDelay()
      }
    } finally {
      this.isProcessingQueue = false
    }
  }

  private microDelay = (): Promise<void> =>
    new Promise(resolve => setTimeout(resolve, 1))

  // ─────────────────────────────────────────────
  //  hive preloading (image assets only)
  // ─────────────────────────────────────────────
  private preloadHive = async (name: string): Promise<void> => {
    try {
      const hive = await this.opfsHives.loadHive(name)
      const file = hive?.file
      if (!file) return

      const text = await file.text()
      const json = JSON.parse(text)
      const rows = json?.data?.data?.[0]?.rows ?? []

      for (const row of rows) {
        const hash = row?.imageHash as string | null
        if (!hash || this.seenHashes.has(hash)) continue
        this.seenHashes.add(hash)
        await this.preloadRowTexture(row)
      }
    } catch (err) {
      console.warn("⚠️ failed to preload hive", name, err)
    }
  }

  private preloadRowTexture = async (row: any): Promise<void> => {
    const hash = row?.imageHash as string | null
    if (!hash) return

    const key = this.getImageCacheKey(hash)
    if (Assets.cache.has(key)) return

    try {
      const blob =
        (await this.images.loadSmall(hash)) ??
        BlobService.getPlaceholder(row?.kind)

      const bitmap = await createImageBitmap(blob)
      const texture = Texture.from(bitmap)

      // only caches the image asset; tile layers are composed later
      Assets.cache.set(key, texture)
    } catch (err) {
      console.warn("⚠️ failed to preload row texture", hash, err)
    }
  }
}
