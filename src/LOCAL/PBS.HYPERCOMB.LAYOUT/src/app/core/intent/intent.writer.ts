// src/app/core/intent/intent.writer.ts

import { Injectable, inject } from '@angular/core'
import { StrandManager } from '../hive/strand.manager'
import { HashService } from '../hash.service'
import { IntentScanResult } from './intent.scanner'
import { SemanticResolver } from './semantic.resolver'
import { Intent } from './models/intent.model'
import { ParsedPhrase } from './models/parsed-phrase.model'

@Injectable({ providedIn: 'root' })
export class IntentWriter {

  private readonly resolver = inject(SemanticResolver)
  private readonly strands = inject(StrandManager)

  public process = async (
    lineage: string,
    text: string,
    scan: IntentScanResult
  ): Promise<void> => {

    const phrase = this.parse(text)
    if (!phrase) return

    const intent = this.inferIntent(phrase)

    const resolution = this.resolver.resolve(intent, scan)
    if (!resolution || !resolution.executable) return

    const seed = await HashService.seed(resolution.object ?? '')
    const ordinal = (await this.strands.list(lineage)).length

    await this.strands.add(
      lineage,
      {
        ordinal,
        seed,
        op: resolution.op!
      }
    )
  }

  // ------------------------------------
  // semantic inference (explained above)
  // ------------------------------------

  private inferIntent = (phrase: ParsedPhrase): Intent => {

    if (
      phrase.verb === 'add' ||
      phrase.verb === 'create' ||
      phrase.verb === 'make'
    ) {
      return { key: 'add.cell', noun: phrase.noun, confidence: 1 }
    }

    if (phrase.verb === 'remove' || phrase.verb === 'delete') {
      return { key: 'remove.cell', noun: phrase.noun, confidence: 1 }
    }

    if (phrase.noun === 'tile') {
      return { key: 'object.tile', confidence: 0.6 }
    }

    return { key: 'unknown', confidence: 0 }
  }

  // ------------------------------------
  // parsing (syntax only)
  // ------------------------------------

  private parse = (text: string): ParsedPhrase | null => {
    const parts = text.trim().toLowerCase().split(/\s+/)
    if (!parts.length) return null

    return {
      verb: parts[0],
      noun: parts.slice(1).join(' '),
      modifiers: parts.slice(2)
    }
  }
}
