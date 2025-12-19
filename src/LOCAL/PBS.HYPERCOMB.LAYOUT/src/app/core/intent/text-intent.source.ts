import { Injectable, inject } from '@angular/core'
import { StrandManager } from '../hive/strand.manager'
import { HashService } from '../hash.service'


@Injectable({ providedIn: 'root' })
export class TextIntentSource {
  private readonly strandmgr = inject(StrandManager)

  /**
   * Phase boundary:
   * - This source ONLY appends intent-as-strands (add.capability) to the lineage log.
   * - It does NOT dispatch Intent→Capability, does NOT execute capabilities, and does NOT reduce outputs into new strands/resources.
   * TODO(next-phase): add an Intent dispatcher + commit boundary (batch of intents) upstream of execution.
   */
  public ingest = async (
    lineage: string,
    text: string
  ): Promise<void> => {
    if (!text) return

    const seed = await HashService.seed(text)

    // naive, expandable mapping
    const capabilities = this.map(text)
    if (capabilities.length === 0) return

    const ordinal = (await this.strandmgr.list(lineage)).length

    await this.strandmgr.add(
      lineage,
      {
        ordinal,
        seed,
        op: 'add.capability'
      },
      ...capabilities
    )
  }

  private map(text: string): string[] {
    const t = text.toLowerCase()
    const caps: string[] = []

    if (t.includes('create') || t.includes('add')) caps.push('add.cell')
    if (t.includes('remove') || t.includes('delete')) caps.push('remove.cell')

    return caps
  }
}
