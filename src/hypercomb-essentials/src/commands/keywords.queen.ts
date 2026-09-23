// `/keywords` — transcript → reviewed keyword proposals.
//
// This is distinct from `/keyword`, the direct mutation command. `/keywords`
// opens a proposal surface; nothing is written until the participant checks
// items and presses Add.

import { QueenBee, EffectBus } from '@hypercomb/core'
import { KeywordGenerationService, KeywordSuggestionsView } from './keyword-suggestions.view.js'

export class KeywordsQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'keywords'
  override description = 'Generate grouped transcript keywords with Haiku in the background, then review and add the chosen ones'
  override options = ['<optional transcript>']
  override examples = [
    { input: '/keywords', result: 'Opens the background keyword request for the selected tile(s)' },
    { input: '/keywords We agreed to ship the mobile reader in September', result: 'Opens with that transcript ready to send to Haiku' },
    { input: 'meeting@keywords We agreed to ship in September', result: 'Targets the meeting tile; review opens from the ready icon' },
  ]

  protected async execute(args: string): Promise<void> {
    EffectBus.emit('keywords:open', { transcript: args.trim() })
  }
}

// The /keywords word owns the proposal surface it opens (atomic-modules-plan.md).
const keywordGeneration = new KeywordGenerationService()
window.ioc.register('@diamondcoreprocessor.com/KeywordGenerationService', keywordGeneration)
window.ioc.register('@diamondcoreprocessor.com/KeywordSuggestionsView', new KeywordSuggestionsView(keywordGeneration))

const _keywords = new KeywordsQueenBee()
window.ioc.register('@diamondcoreprocessor.com/KeywordsQueenBee', _keywords)
