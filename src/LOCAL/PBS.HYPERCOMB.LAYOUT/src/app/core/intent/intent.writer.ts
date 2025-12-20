// src/app/core/intent/intent.writer.ts

import { Injectable } from '@angular/core'
import { IntentScanResult } from './intent.scanner'

@Injectable({ providedIn: 'root' })
export class IntentWriter {

  public scan = (
    text: string,
    _scan: IntentScanResult
  ): { key: string; confidence: number } | null => {

    const cleaned = text.trim()
    if (!cleaned) return null

    return {
      key: cleaned,
      confidence: 1
    }
  }

  // intentionally empty:
  // no persistence
  // no structure
  // no ops
  public process = async (): Promise<void> => {}
}
