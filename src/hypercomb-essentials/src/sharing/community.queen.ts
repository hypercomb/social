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
  override description = 'Manage the groups of your community — which tiles are on, and for whom'
  override descriptionKey = 'slash.community'
  override options = ['<domain>', 'publish']
  override examples = [
    { input: '/community example.com', result: 'Opens the community of example.com' },
    { input: '/community publish', result: 'Signs the community for visitors' },
  ]

  override rawArgs = true

  // OFFERED TO A MODEL (jwize, 2026-11-11: development by chat): it may open
  // a domain's community for the participant. Every switch in that window is
  // their press, and signing it for visitors is their word.
  override machine = {
    forms: '<domain>',
    example: '/community example.com',
    reach: 'additive' as const,
    scope: 'local' as const,
    consequence: 'Opens the community window of that domain. It changes nothing: which tiles are on, and for whom, is the participant\'s press there.',
    refuse: (args: string): string | undefined => {
      const text = args.trim().toLowerCase()
      if (!text) return 'community needs a domain'
      if (text === 'publish') return "community publish signs the community under the participant's key; only the participant says it"
      return undefined
    },
  }

  protected execute(args: string): void {
    const text = args.trim()
    if (text.toLowerCase() === 'publish') { EffectBus.emit('community:publish', {}); return }
    EffectBus.emit('community:open', { zone: text })
  }
}

const _community = new CommunityQueenBee()
window.ioc.register('@diamondcoreprocessor.com/CommunityQueenBee', _community)
