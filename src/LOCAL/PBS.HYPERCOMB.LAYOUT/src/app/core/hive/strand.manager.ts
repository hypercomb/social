// src/app/core/hive/strand.manager.ts

import { inject, Injectable, signal } from '@angular/core'
import { IStrand, IStrandManager, StrandOp } from './i-dna.token'
import { Hypercomb } from '../hypercomb.base'
import { OpfsManager } from './opfs.manager'

@Injectable({ providedIn: 'root' })
export class StrandManager extends Hypercomb implements IStrandManager {

  // ─────────────────────────────────────────────
  // dependencies
  // ─────────────────────────────────────────────

  private readonly opfs = inject(OpfsManager)

  // ─────────────────────────────────────────────
  // constants
  // ─────────────────────────────────────────────

  private static readonly SEP = '-'
  private static readonly ORDINAL_LEN = 8

  private static readonly OPS = new Set<StrandOp>([
    'add.cell',
    'remove.cell',
    'add.capability',
    'remove.capability'
  ])

  // ─────────────────────────────────────────────
  // reactive state
  // ─────────────────────────────────────────────

  // monotonic write signal for observers (debuggers, views, caches)
  private readonly _writeSeq = signal(0)
  public readonly writeSeq = this._writeSeq.asReadonly()

  private notifyWrite = (): void => {
    this._writeSeq.update(v => v + 1)
  }

  // ─────────────────────────────────────────────
  // public api
  // ─────────────────────────────────────────────

  public add = async (
    lineage: string,
    strand: IStrand,
    ...capabilities: string[]
  ): Promise<void> => {

    const name = this.formatName(strand)
    const dir = await this.opfs.ensureDirs(this.split(lineage))

    if (await this.exists(dir, name)) {
      throw new Error(`strand already exists: ${lineage}/${name}`)
    }

    const payload =
      capabilities.length === 0
        ? ''
        : capabilities.map(c => JSON.stringify(c)).join('\n')

    await this.opfs.writeFile(dir, name, payload)

    // notify observers that strands changed
    this.notifyWrite()
  }

  public list = async (lineage: string): Promise<IStrand[]> => {
    const dir = await this.opfs.ensureDirs(this.split(lineage))
    const entries = await this.opfs.listEntries(dir)

    return entries
      .filter(e => e.handle.kind === 'file')
      .map(e => this.parseName(e.name))
      .filter((s): s is IStrand => s !== null)
      .sort((a, b) => a.ordinal - b.ordinal)
  }

  // ─────────────────────────────────────────────
  // helpers
  // ─────────────────────────────────────────────

  private parseName = (name: string): IStrand | null => {
    const parts = name.split(StrandManager.SEP)
    if (parts.length !== 3) return null

    const [ordinalRaw, seed, opRaw] = parts

    if (ordinalRaw.length !== StrandManager.ORDINAL_LEN) return null
    if (!/^\d{8}$/.test(ordinalRaw)) return null

    const ordinal = Number(ordinalRaw)
    if (!Number.isFinite(ordinal)) return null

    const op = opRaw as StrandOp
    if (!StrandManager.OPS.has(op)) return null

    return { ordinal, seed, op }
  }

  private formatName = (strand: IStrand): string =>
    `${this.formatOrdinal(strand.ordinal)}${StrandManager.SEP}${strand.seed}${StrandManager.SEP}${strand.op}`

  private formatOrdinal = (value: number): string =>
    value.toString().padStart(StrandManager.ORDINAL_LEN, '0')

  private split = (lineage: string): string[] =>
    lineage.split('/').filter(Boolean)

  private exists = async (
    dir: FileSystemDirectoryHandle,
    name: string
  ): Promise<boolean> => {
    try {
      await dir.getFileHandle(name)
      return true
    } catch {
      return false
    }
  }
}
