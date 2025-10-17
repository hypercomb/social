﻿import { uuidv4 } from "src/app/core/models/uuid"
import { CellFlags } from "./models/cell-flags"
import { IHiveImage } from "../core/models/i-hive-image"
import { BlobService } from "../hive/rendering/blob-service"
import { BlobOptions } from "buffer"

// simple deterministic hash for hive string → number
export function hashHive(hive: string): number {
  let hash = 0
  for (let i = 0; i < hive.length; i++) {
    hash = (hash * 31 + hive.charCodeAt(i)) >>> 0 // unsigned 32-bit
  }
  return hash
}

export type CellKind =
  | ""
  | "Cell"
  | "Ghost"
  | "Hive"
  | "Clipboard"
  | "Path"

/** pre-persist DTO (no cellId yet) */
export class NewCell extends CellFlags {
  cellId?: number

  // ─────────────────────────────────────────────
  // kind encapsulation
  // ─────────────────────────────────────────────
  private _kind: CellKind = ""
  public get kind(): CellKind {
    return this._kind
  }
  
  public setKind(value: CellKind): void {
    this._kind = value
  }

  uniqueId: string = uuidv4()
  public get hashedHive(): number {
    return hashHive(this.hive)
  }

  hive: string = ""
  name = ""
  link = ""
  etag?: string
  sourceId?: number
  sourcePath = ""
  index = -1
  smallImageId: number = 0
  largeImageId?: number

  dateCreated: string = new Date().toISOString()
  dateDeleted?: string
  updatedAt: string = new Date().toISOString()

  // always returns something (real blob or placeholder)
  private _blob: Blob | undefined = undefined
  private _image?: IHiveImage

  public set image(value: IHiveImage | undefined) {
    this._image = value
    this._blob = undefined // invalidate cache whenever image changes
  }

  public get image(): IHiveImage | undefined {
    return this._image
  }

  get blob(): Blob | undefined {
    if (this._image?.blob) {
      this._blob = this._image.blob
    }
    return this._blob
  }

  set blob(value: Blob) {
    this._blob = value
  }

  // misc fields
  backgroundColor = ""
  borderColor = "#222"
  scale = 1
  x = 0
  y = 0

  constructor(params: Partial<NewCell> = {}) {
    super()
    const { kind, ...rest}= params
    Object.assign(this, rest)
    
    this.dateCreated = params.dateCreated ?? new Date().toISOString()
    this.updatedAt = params.updatedAt ?? new Date().toISOString()
    this.hive = this.hive?.toLowerCase?.() ?? ""

    // allow initial override through constructor
    if (params.kind) this.setKind(params.kind)
  }
}

/** runtime domain Cell (must have cellId) */
export class Cell extends NewCell {
  override cellId: number
  hash?: any

  constructor(params: Partial<NewCell> & { cellId: number }) {
    super(params)
    if (params.cellId == null) {
      throw new Error("Cell requires a cellId")
    }
    this.cellId = params.cellId
    this.setKind("Cell")
  }

  get dateCreatedAsDate(): Date {
    return new Date(this.dateCreated)
  }

  get dateDeletedAsDate(): Date | undefined {
    return this.dateDeleted ? new Date(this.dateDeleted) : undefined
  }

  public setDateDeleted(value?: Date | string): void {
    this.dateDeleted = value instanceof Date ? value.toISOString() : value
  }
}

/** concrete subclasses with fixed kind */
export class Hive extends Cell {
  public _etag?: string
  constructor(params: Partial<Cell> & { cellId: number }) {
    super(params)
    this.setKind("Hive")
  }
}

export class ClipboardCell extends Cell {
  constructor(params: Partial<Cell> & { cellId: number }) {
    super(params)
    this.setKind("Clipboard")
  }
}

export class Ghost extends NewCell {
  constructor(params: Partial<NewCell> = {}) {
    super(params)
    this.setKind("Ghost")
  }
}

export class Path extends Cell {
  constructor(params: Partial<Cell> & { cellId: number }) {
    super(params)
    this.setKind("Path")
  }
}

export class EditCell extends Cell {
  originalImage?: IHiveImage
  largeImage?: IHiveImage
  imageDirty?: boolean = false
}
