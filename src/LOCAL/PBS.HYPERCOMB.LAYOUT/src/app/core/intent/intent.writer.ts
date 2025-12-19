// src/app/core/intent/intent.writer.ts

import { Injectable, inject } from '@angular/core'
import { DebugService } from '../diagnostics/debug.service'

@Injectable({ providedIn: 'root' })
export class IntentWriter {
  private readonly debug = inject(DebugService)

  public commit = async (lineage: string, text: string): Promise<void> => {
    // next step is to parse `text` into one or more strand writes
    // examples you can support first:
    // - "add cell <seed>"      -> add.cell at lineage
    // - "remove cell <seed>"   -> remove.cell at lineage
    // - "toggle <capability>"  -> add.capability/remove.capability events on the focused seed (once focus exists)

    this.debug.log('intent-commit', lineage, text)

    // placeholder only
    return
  }
}
