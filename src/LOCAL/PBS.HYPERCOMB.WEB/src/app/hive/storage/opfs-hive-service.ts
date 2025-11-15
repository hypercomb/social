// src/app/hive/storage/opfs-hive-service.ts
import { Injectable, inject } from "@angular/core"
import { OpfsManager } from "src/app/common/opfs/opfs-manager"
import { IDexieHive } from "src/app/hive/hive-models"
import { DebugService } from "src/app/core/diagnostics/debug-service"
import { HiveNormalizationService } from "src/app/actions/propagation/hive-normalization-service"
import { OpfsImageService } from "./opfs-image.service"
import { BlobService } from "../rendering/blob-service"

/**
 * Registry entry stored in opfs-hives.json
 * Note: folder structure is the real state, ready flag is informational only.
 */
export interface IOpfsHiveRecord {
  name: string
  background: string
  importedAt: string
  imageHash: string
  ready?: boolean
}

@Injectable({ providedIn: "root" })
export class OpfsHiveService {
  private readonly blobsvc = inject(BlobService)
  private readonly opfs = inject(OpfsManager)
  private readonly debug = inject(DebugService)

  // new: use the existing normalizer + image store
  private readonly normalizer = inject(HiveNormalizationService)
  private readonly images = inject(OpfsImageService)

  // directory references
  private hivesDir = async (): Promise<FileSystemDirectoryHandle> =>
    await this.opfs.ensureDirs(["hives"])

  private pendingDir = async (): Promise<FileSystemDirectoryHandle> =>
    await this.opfs.ensureDirs(["hives", "pending"])

  // normalize for ".json"
  private normalize = (name: string): string =>
    name.endsWith(".json") ? name : `${name}.json`

  // ──────────────────────────────────────────────────────────────
  // IMPORT (samples and user-imported)
  // always goes to /hives/pending
  // ──────────────────────────────────────────────────────────────
  // ──────────────────────────────────────────────────────────────
  public import = async (files: File[]): Promise<void> => {
    const pending = await this.pendingDir()
    const registry = await this.getRegistry()

    for (const file of files) {
      const fileName = this.normalize(file.name)

      try {
        const text = await file.text()
        const json = JSON.parse(text)

        // ----------------------------------------------------------------------
        // extract preview info ONLY from first row
        // ----------------------------------------------------------------------
        const firstRow = json?.data?.data?.[0]?.rows?.[0]
        const bg = firstRow?.backgroundColor ?? "#000000"

        let hashName: string | null = null

        // only the FIRST blob is used as preview (very fast)
        if (!!firstRow.blob) {
          const previewBlob = firstRow.blob
          const blob = this.blobsvc.toBlob(previewBlob) // set the default menu image
          if (!blob) throw new Error("invalid blob in hive import")
          hashName = await this.images.hashName(blob)

          await this.images.saveSmall(hashName, blob)
        }

        // ----------------------------------------------------------------------
        // write original (un-normalized) file to pending
        // ----------------------------------------------------------------------
        await this.opfs.writeFile(pending, fileName, text)

        // ----------------------------------------------------------------------
        // store minimal meta entry (instant availability)
        // ----------------------------------------------------------------------
        registry.push({
          name: fileName,
          background: bg,
          imageHash: hashName ?? "", // default to empty hive image
          importedAt: new Date().toISOString(),
          ready: false
        })

        this.debug.log("import", `→ pending (preview extracted): ${fileName}`)

      } catch (err) {
        this.debug.log("import", `× failed: ${fileName}`, err)
      }
    }

    const unique = Array.from(new Map(registry.map(r => [r.name, r])).values())
    await this.updateRegistry(unique)
  }

  // ──────────────────────────────────────────────────────────────
  // PROMOTION: /hives/pending → /hives
  // now: normalize + save blobs → images, then write clean hive
  // ──────────────────────────────────────────────────────────────
  private promote = async (name: string): Promise<void> => {
    const fileName = this.normalize(name)
    const [pending, hives] = await Promise.all([this.pendingDir(), this.hivesDir()])

    // check if a ready hive already exists
    let readyExists = false
    try {
      await this.opfs.getFile(hives, fileName)
      readyExists = true
    } catch {
      // no ready hive yet
    }

    try {
      // try to read pending hive
      const fhPending = await this.opfs.getFile(pending, fileName)
      const pendingFile = await this.opfs.readFile(fhPending)
      const text = await pendingFile.text()
      const raw = JSON.parse(text)

      // normalize: convert row.blob → row.imageHash + collect small images
      const { normalized, smallImages } = await this.normalizer.normalize(raw)

      // save each small image by hash, but don't overwrite existing files
      for (const { hash, blob } of smallImages) {
        const existing = await this.images.loadSmall(hash)
        if (!existing) {
          await this.images.saveSmall(hash, blob)
        }
      }

      // only write the hive json if we don't already have a ready hive
      if (!readyExists) {
        await this.opfs.writeFile(
          hives,
          fileName,
          JSON.stringify(normalized)
        )
      }

      // delete pending copy after images + hive json are safely written
      await this.opfs.deleteEntry(pending, fileName).catch(() => { })

      // update registry
      const registry = await this.getRegistry()
      const rec = registry.find(r => r.name === fileName)
      if (rec) {
        rec.ready = true
        await this.updateRegistry(registry)
      }

      this.debug.log(
        "promote",
        readyExists
          ? `✓ normalized images (existing hive kept): ${fileName}`
          : `✓ normalized + promoted hive: ${fileName}`
      )
    } catch (err) {
      // if there's no pending hive and no ready hive, this is a real failure
      if (!readyExists) {
        this.debug.log("promote", `× failed: ${fileName}`, err)
      }
      // if ready exists, we silently fall back to the existing hive
    }
  }


  public ensureHiveReady = async (name: string): Promise<void> =>
    this.promote(name)

  // promote a few pending items lazily in the background
  public promoteNextPending = async (max = 1): Promise<void> => {
    const pending = await this.pendingDir()
    const entries = await this.opfs.listEntries(pending)
    const jsonFiles = entries.filter(e => e.handle.kind === "file" && e.name.endsWith(".json"))

    for (const e of jsonFiles.slice(0, max)) {
      await this.promote(e.name)
    }
  }

  // ──────────────────────────────────────────────────────────────
  // LISTING (merge both folders)
  // hives overrides pending
  // ──────────────────────────────────────────────────────────────
  public listHives = async (): Promise<IDexieHive[]> => {
    const [hives, pending] = await Promise.all([this.hivesDir(), this.pendingDir()])
    const [readyList, pendingList] = await Promise.all([
      this.opfs.listEntries(hives),
      this.opfs.listEntries(pending)
    ])

    const map = new Map<string, string>()

    for (const e of pendingList) {
      if (e.handle.kind === "file" && e.name.endsWith(".json"))
        map.set(e.name, e.name)
    }

    for (const e of readyList) {
      if (e.handle.kind === "file" && e.name.endsWith(".json"))
        map.set(e.name, e.name) // ready overrides
    }

    const registry = await this.getRegistry()

    return Array.from(map.values()).map(name => {
      const base = name.replace(/\.json$/, "")
      const rec = registry.find(r => r.name === name)

      return {
        name: base,
        file: undefined,
        background: rec?.background ?? '#242a30',
        imageHash: rec?.imageHash ?? ''
      }
    })
  }

  // ──────────────────────────────────────────────────────────────
  // LOADING (auto-promote if still pending)
  // ──────────────────────────────────────────────────────────────
  public loadHive = async (name: string): Promise<IDexieHive | null> => {
    const fileName = this.normalize(name)
    const [hives, pending] = await Promise.all([this.hivesDir(), this.pendingDir()])

    // try ready first
    try {
      const fh = await this.opfs.getFile(hives, fileName)
      const file = await this.opfs.readFile(fh)
      return { name: name.replace(/\.json$/, ""), file }
    } catch { }

    // not ready → promote → load
    try {
      await this.promote(fileName)

      const fh = await this.opfs.getFile(hives, fileName)
      const file = await this.opfs.readFile(fh)
      return { name: name.replace(/\.json$/, ""), file }
    } catch {
      return null
    }
  }

  // ──────────────────────────────────────────────────────────────
  // SAVE + DELETE
  // (always save into READY)
  // ──────────────────────────────────────────────────────────────
  public saveHive = async (name: string, data: Blob | string): Promise<void> => {
    const fileName = this.normalize(name)
    const hives = await this.hivesDir()

    await this.opfs.writeFile(hives, fileName, data)

    // cleanup from pending if it existed
    const pending = await this.pendingDir()
    await this.opfs.deleteEntry(pending, fileName).catch(() => { })
  }

  public deleteHive = async (name: string): Promise<void> => {
    const fileName = this.normalize(name)
    const [hives, pending] = await Promise.all([this.hivesDir(), this.pendingDir()])

    await this.opfs.deleteEntry(hives, fileName).catch(() => { })
    await this.opfs.deleteEntry(pending, fileName).catch(() => { })

    const registry = await this.getRegistry()
    await this.updateRegistry(registry.filter(r => r.name !== fileName))
  }

  public hasHive = async (name: string): Promise<boolean> => {
    const fileName = this.normalize(name)
    const [hives, pending] = await Promise.all([this.hivesDir(), this.pendingDir()])

    try { await this.opfs.getFile(hives, fileName); return true } catch { }
    try { await this.opfs.getFile(pending, fileName); return true } catch { }
    return false
  }

  public getFirstHive = async (): Promise<IDexieHive | null> => {
    const list = await this.listHives()
    if (!list.length) return null
    return await this.loadHive(list[0].name)
  }

  // ──────────────────────────────────────────────────────────────
  // REGISTRY (metadata only)
  // ──────────────────────────────────────────────────────────────
  public getRegistry = async (): Promise<IOpfsHiveRecord[]> => {
    const raw = (await this.opfs.readRegistry()) as IOpfsHiveRecord[]
    return raw ?? []
  }

  public updateRegistry = async (records: IOpfsHiveRecord[]): Promise<void> =>
    this.opfs.writeRegistry(records)
}
