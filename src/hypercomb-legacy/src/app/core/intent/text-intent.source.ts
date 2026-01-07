import { Injectable, inject } from '@angular/core'
import { StrandManager } from 'src/app/core/hive/strand-manager'
import { HashService } from 'src/app/hive/storage/hash.service'

@Injectable({ providedIn: 'root' })
export class TextIntentSource {

  private readonly strandmgr = inject(StrandManager)

  public ingest = async (
    lineage: string,
    text: string
  ): Promise<void> => {

    if (!text) return

    const seed = await HashService.seed(text)

    // naive, expandable mapping
    const capabilities = this.map(text)

    if (capabilities.length === 0) return

    await this.strandmgr.add(
      lineage,
      {
        ordinal: Date.now(),
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
