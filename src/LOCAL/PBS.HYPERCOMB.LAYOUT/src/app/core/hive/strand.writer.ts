// src/app/core/hive/strand-writer.ts

import { inject, Injectable, signal } from '@angular/core'
import { OpfsManager } from './opfs.manager'

/**
 * a strand is an immutable historical record
 * every committed intent produces exactly one strand
 */
export interface Strand {
  readonly ordinal: number
  readonly kind: 'select' | 'create'
  readonly seed: string
  readonly parentSeed?: string
  readonly payload?: unknown
}

export interface Intent {
  readonly text: string
  readonly contextSeed?: string
}

@Injectable({ providedIn: 'root' })
export class StrandWriter {

  // ─────────────────────────────────────────────
  // dependencies
  // ─────────────────────────────────────────────

  private readonly opfs = inject(OpfsManager)

  // ─────────────────────────────────────────────
  // reactive write sequence (observers, caches)
  // ─────────────────────────────────────────────

  private readonly _writeSeq = signal(0)
  public readonly writeSeq = this._writeSeq.asReadonly()

  private bump = (): void => {
    this._writeSeq.update(v => v + 1)
  }

  // ─────────────────────────────────────────────
  // processor rule (diamond core, inlined)
  // ─────────────────────────────────────────────

  /**
   * decides which strand must exist
   * pure logic – no io, no mutation
   */
  private readonly processor = (intent: Intent): Omit<Strand, 'ordinal'> => {
    // resolution is intentionally minimal for now
    // future: local → branch → public lookup

    const resolved = this.resolve(intent)

    if (resolved) {
      return {
        kind: 'select',
        seed: resolved
      }
    }

    // silence → creation
    return {
      kind: 'create',
      seed: this.toSeed(intent.text),
      parentSeed: intent.contextSeed
    }
  }

  // ─────────────────────────────────────────────
  // public api
  // ─────────────────────────────────────────────

  /**
   * entry point
   * every call results in exactly one written strand
   */
  public writeIntent = async (intent: Intent): Promise<Strand> => {
    const decision = this.processor(intent)
    const ordinal = await this.nextOrdinal(intent.contextSeed)

    const strand: Strand = {
      ordinal,
      ...decision
    }

    await this.persist(intent.contextSeed, strand)
    this.bump()

    return strand
  }

  // ─────────────────────────────────────────────
  // persistence
  // ─────────────────────────────────────────────

  private persist = async (
    contextSeed: string | undefined,
    strand: Strand
  ): Promise<void> => {

    const dir = await this.opfs.ensureDirs(
      contextSeed ? ['genome', contextSeed] : ['genome', '_root']
    )

    const name = this.formatName(strand)
    const payload = JSON.stringify(strand.payload ?? null)

    await this.opfs.writeFile(dir, name, payload)
  }

  // ─────────────────────────────────────────────
  // helpers
  // ─────────────────────────────────────────────

  private resolve = (_intent: Intent): string | null => {
    // intentionally empty for now
    // resolution layers get added later
    return null
  }

  private toSeed = (raw: string): string => {
    return raw
      .trim()
      .toLowerCase()
      .replaceAll('/', ' ')
      .replace(/\s+/g, '_')
  }

  private nextOrdinal = async (
    contextSeed: string | undefined
  ): Promise<number> => {

    const dir = await this.opfs.ensureDirs(
      contextSeed ? ['genome', contextSeed] : ['genome', '_root']
    )

    const entries = await this.opfs.listEntries(dir)

    return entries.length + 1
  }

  private formatName = (strand: Strand): string => {
    const ordinal = strand.ordinal.toString().padStart(8, '0')
    return `${ordinal}-${strand.kind}-${strand.seed}`
  }
}
