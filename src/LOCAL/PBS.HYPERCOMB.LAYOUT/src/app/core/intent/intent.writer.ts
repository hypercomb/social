// src/app/core/intent/intent.writer.ts

import { Injectable, inject } from '@angular/core'
import { StrandManager } from '../hive/strand.manager'
import { HashService } from '../hash.service'
import { IntentScanResult } from './intent.scanner'
import { SemanticResolver } from './semantic.resolver'
import { Intent } from './models/intent.model'
import { ParsedPhrase } from './models/parsed-phrase.model'
import { StrandOp } from '../hive/i-dna.token'
import { SignatureRegistry } from './signature.registry'

@Injectable({ providedIn: 'root' })
export class IntentWriter {

  private readonly resolver = inject(SemanticResolver)
  private readonly strands = inject(StrandManager)
  private readonly signatures = inject(SignatureRegistry)

  public scan = (
    text: string,
    scan: IntentScanResult
  ): {
    op?: StrandOp
    object?: string
    signature?: string
    executable: boolean
    confidence: number
  } | null => {

    const phrase = this.parse(text)
    if (!phrase) return null

    const intent = this.inferIntent(phrase)
    const resolution = this.resolver.resolve(intent, scan)

    const op: StrandOp | undefined =
      resolution?.op ??
      (intent.key !== 'unknown' ? intent.key as StrandOp : undefined)

    const sig = this.signatures.match(phrase.noun)

    const executable =
      op === 'add.cell' &&
      sig?.exact === true &&
      sig.kind === 'cell'

    return {
      op,
      object: phrase.noun || undefined,
      signature: sig?.kind,
      executable,
      confidence: intent.confidence
    }
  }

  public process = async (
    lineage: string,
    text: string,
    scan: IntentScanResult
  ): Promise<void> => {

    const preview = this.scan(text, scan)
    if (!preview?.executable || !preview.op) return

    const seed = await HashService.seed(preview.signature!)
    const ordinal = (await this.strands.list(lineage)).length

    await this.strands.add(lineage, {
      ordinal,
      seed,
      op: preview.op
    })
  }

  private inferIntent = (phrase: ParsedPhrase): Intent => {

    if (phrase.verb === 'add' || phrase.verb === 'create' || phrase.verb === 'make') {
      return { key: 'add.cell', noun: phrase.noun, confidence: 1 }
    }

    if (phrase.verb === 'remove' || phrase.verb === 'delete') {
      return { key: 'remove.cell', noun: phrase.noun, confidence: 1 }
    }

    return { key: 'unknown', confidence: 0 }
  }

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
