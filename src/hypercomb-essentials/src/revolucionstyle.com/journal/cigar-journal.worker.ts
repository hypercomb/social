// revolucionstyle.com/journal/cigar-journal.worker.ts
import { Worker, EffectBus } from '@hypercomb/core'

export class CigarJournalWorker extends Worker {
  readonly namespace = 'revolucionstyle.com'
  override genotype = 'revolucionstyle'

  public override description =
    'Open the cigar journal to log a new smoke session.'

  public override grammar = [
    { example: 'cigar journal' },
    { example: 'new smoke' },
  ]

  public override effects = ['memory'] as const

  protected override deps = { journal: '@revolucionstyle.com/journal' }

  protected override act = async (_grammar: string): Promise<void> => {
    this.resolve('journal')
    EffectBus.emit('journal:action', { action: 'new' })
  }
}
