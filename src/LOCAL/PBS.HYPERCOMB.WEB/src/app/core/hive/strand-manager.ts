// src/app/core/hive/strand-manager.ts
import { inject } from '@angular/core'
import { IStrand, IStrandManager, StrandOp, Seed } from './i-dna.token'
import { OpfsManager } from 'src/app/common/opfs/opfs-manager'
import { Hypercomb } from '../mixins/abstraction/hypercomb.base'
import { HashService } from 'src/app/hive/storage/hash.service'

/*
filename layout (positional, fixed offsets):
[0..7]    ordinal (8 chars, zero-padded)
[8]       '-'
[9..72]   seed (64-char hex hash)
[73]      '-'
[74..]    op (variable: add | remove   | update)

example:
00000001-<64hexhash>-add
*/

export class StrandManager extends Hypercomb implements IStrandManager {
  private readonly opfs = inject(OpfsManager)

  private static readonly ORDINAL_LEN = 8
  private static readonly DASH_LEN = 1
  private static readonly SEED_LEN = HashService.HASH_LENGTH // 64

  private static readonly SEED_START = StrandManager.ORDINAL_LEN + StrandManager.DASH_LEN
  private static readonly SEED_END   = StrandManager.SEED_START + StrandManager.SEED_LEN
  private static readonly OP_START   = StrandManager.SEED_END + StrandManager.DASH_LEN

  // creates an immutable strand file at: <lineage>/<ordinal>-<seed>-<op>
  public add = async (lineage: string, strand: IStrand): Promise<void> => {
    const name = this.formatName(strand)
    const dir = await this.opfs.ensureDirs(this.split(lineage))

    // strands are immutable, never overwrite
    if (await this.exists(dir, name)) {
      throw new Error(`strand already exists: ${lineage}/${name}`)
    }

    // empty file = instruction only
    await this.opfs.writeFile(dir, name, '')
  }

  // reads and parses strand files at: <lineage>
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
  // filename parsing (fixed offsets)
  // -------------------------
  private parseName = (name: string): IStrand | null => {
    // minimal length check: ordinal + '-' + seed + '-' + op(1)
    if (name.length <= StrandManager.OP_START) return null
    if (name[8] !== '-' || name[StrandManager.SEED_END] !== '-') return null

    const ordinal = Number(name.slice(0, StrandManager.ORDINAL_LEN))
    if (!Number.isFinite(ordinal)) return null

    const seed = name.slice(
      StrandManager.SEED_START,
      StrandManager.SEED_END
    )
    if (seed.length !== StrandManager.SEED_LEN) return null

    const op = name.slice(StrandManager.OP_START) as StrandOp
    if (op !== 'add' && op !== 'remove' && op !== 'update') return null

    return { ordinal, seed, op }
  }

  private formatName = (strand: IStrand): string => {
    return `${this.formatOrdinal(strand.ordinal)}-${strand.seed}-${strand.op}`
  }

  private formatOrdinal = (value: number): string => {
    return value.toString().padStart(StrandManager.ORDINAL_LEN, '0')
  }

  // -------------------------
  // helpers
  // -------------------------
  private split = (lineage: Seed): string[] => {
    // lineage is a path string like "hypercomb/<seed>/<seed>/..."
    return lineage.split('/').filter(Boolean)
  }

  private exists = async (dir: FileSystemDirectoryHandle, name: string): Promise<boolean> => {
    try {
      await dir.getFileHandle(name)
      return true
    } catch {
      return false
    }
  }
}
