// hypercomb-legacy/src/app/core/hive/strand-manager.ts

import { inject } from '@angular/core'
import { IStrand, IStrandManager, StrandOp, Seed } from './i-dna.token'
import { OpfsManager } from 'src/app/common/opfs/opfs-manager'
import { Hypercomb } from '../mixins/abstraction/hypercomb.base'
import { HashService } from 'src/app/hive/storage/hash.service'


/*
filename layout (positional, fixed offsets):
[0..7]    ordinal (8 chars, zero-padded)
[8]       '-'
[9..72]   seed (64-char hex)
[73]      '-'
[74..]    op (strand operation)

payload format (file contents):
- newline-delimited JSON
- each line = StrandParam
- empty file = no nucleotides
*/

export class StrandManager extends Hypercomb implements IStrandManager {
  private readonly opfs = inject(OpfsManager)

  private static readonly ORDINAL_LEN = 8
  private static readonly DASH = '-'
  private static readonly SEED_LEN = HashService.HASH_LENGTH

  private static readonly SEED_START = 9
  private static readonly SEED_END = 9 + StrandManager.SEED_LEN
  private static readonly OP_START = StrandManager.SEED_END + 1

  private static readonly OPS = new Set<StrandOp>([
    'add.cell',
    'remove.cell',
    'add.capability',
    'remove.capability',
    'add.pheremone',
    'remove.pheremone'
  ] as StrandOp[])

  // append immutable strand file
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

    // params → newline-delimited json
    // empty params = empty file (no nucleotides)
    const payload =
      capabilities.length === 0
        ? ''
        : capabilities.map(p => JSON.stringify(p)).join('\n')

    await this.opfs.writeFile(dir, name, payload)
  }

  // list + parse strand headers
  public list = async (lineage: string): Promise<IStrand[]> => {
    const dir = await this.opfs.ensureDirs(this.split(lineage))
    const entries = await this.opfs.listEntries(dir)

    return entries
      .filter(e => e.handle.kind === 'file')
      .map(e => this.parseName(e.name))
      .filter((s): s is IStrand => s !== null)
      .sort((a, b) => a.ordinal - b.ordinal)
  }

  // -------------------------
  // filename parsing
  // -------------------------
  private parseName = (name: string): IStrand | null => {
    if (name.length <= StrandManager.OP_START) return null
    if (name[8] !== StrandManager.DASH) return null
    if (name[StrandManager.SEED_END] !== StrandManager.DASH) return null

    const ordinal = Number(name.slice(0, StrandManager.ORDINAL_LEN))
    if (!Number.isFinite(ordinal)) return null

    const seed = name.slice(
      StrandManager.SEED_START,
      StrandManager.SEED_END
    )
    if (!/^[0-9a-f]{64}$/.test(seed)) return null

    const op = name.slice(StrandManager.OP_START) as StrandOp
    if (!StrandManager.OPS.has(op)) return null

    return { ordinal, seed, op }
  }

  private formatName = (strand: IStrand): string =>
    `${this.formatOrdinal(strand.ordinal)}-${strand.seed}-${strand.op}`

  private formatOrdinal = (value: number): string =>
    value.toString().padStart(StrandManager.ORDINAL_LEN, '0')

  // -------------------------
  // helpers
  // -------------------------
  private split = (lineage: Seed): string[] =>
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
