// sharing/community.queen.ts
//
//   community <domain>          open the community of a domain: groups, Manage, undo
//   community publish           sign the showcase being edited, for visitors
//
// The window and its acts live in community.view.ts; this is only the word.

import { EffectBus, QueenBee } from '@hypercomb/core'
import './community.view.js'
import './showcase-bridge.js'

export class CommunityQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'sharing'
  readonly command = 'community'
  override description = 'Manage the groups of your showcase — which tiles are on, and for whom'
  override descriptionKey = 'slash.community'
  override options = ['<domain>', 'publish']
  override examples = [
    { input: '/community example.com', result: 'Opens the community of example.com' },
    { input: '/community publish', result: 'Signs the showcase for visitors' },
  ]

  override rawArgs = true

  protected execute(args: string): void {
    const text = args.trim()
    if (text.toLowerCase() === 'publish') { EffectBus.emit('community:publish', {}); return }
    EffectBus.emit('community:open', { zone: text })
  }
}

const _community = new CommunityQueenBee()
window.ioc.register('@diamondcoreprocessor.com/CommunityQueenBee', _community)
