import { Injectable, inject } from '@angular/core'
import { StrandManager } from '../hive/strand.manager'
import { HashService } from '../hash.service'
import { IStrand, StrandOp } from '../hive/i-dna.token'

@Injectable({ providedIn: 'root' })
export class IntentWriter {

  private readonly strands = inject(StrandManager)
  private readonly hash = inject(HashService)

  /**
   * commit user intent into history
   */
  public commit = async (lineage: string, text: string): Promise<void> => {
     debugger
    const parsed = this.parse(text)
    if (!parsed) return

    // identity collapse happens here (async boundary)
    const seed = await HashService.seed(parsed.noun)

    const ordinal = (await this.strands.list(lineage)).length

    const strand: IStrand = {
      ordinal,
      seed,
      op: parsed.op
    }

    await this.strands.add(lineage, strand, ...parsed.capabilities)
  }

  // --------------------------------------------------
  // parsing (pure, synchronous)
  // --------------------------------------------------

  private parse = (
    text: string
  ): { noun: string; op: StrandOp; capabilities: string[] } | null => {

    const parts = text.trim().split(/\s+/)
    if (parts.length < 2) return null

    const verb = parts[0].toLowerCase()
    const noun = parts.slice(1).join(' ')

    switch (verb) {
      case 'add':
        return { noun, op: 'add.cell', capabilities: [] }

      case 'remove':
        return { noun, op: 'remove.cell', capabilities: [] }

      case 'enable':
        return {
          noun,
          op: 'add.capability',
          capabilities: parts.slice(2)
        }

      case 'disable':
        return {
          noun,
          op: 'remove.capability',
          capabilities: parts.slice(2)
        }

      default:
        return null
    }
  }
}
