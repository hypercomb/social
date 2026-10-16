// assistant/chats.queen.ts
//
// `chats tidy` — put away the one-off job conversations sessions hand the hive
// (chat-tidy.ts says which, and why). It was a private bridge op until
// 2026-10-15 ("retire the bridge and fix the dialect whenever we reach for the
// bridge"): said as a word, a participant can run it too, and a session says
// the same sentence a person would.
//
//   chats tidy        put them away; your own chats and tile chats stay
//   chats tidy dry    say what would be put away, change nothing

import { QueenBee, EffectBus, type MachineGrammar } from '@hypercomb/core'
import { tidyJobConversations } from './chat-tidy.js'

const SHOWN = 12

export class ChatsQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'assistant'
  readonly command = 'chats'
  override description = 'Put away finished job conversations: chats tidy, or chats tidy dry to see them first'
  override descriptionKey = 'slash.chats'
  override options = ['tidy', 'tidy dry']
  override examples = [
    { input: '/chats tidy', result: 'Answered and abandoned job conversations move to the archive' },
    { input: '/chats tidy dry', result: 'Lists what would move, and moves nothing' },
  ]
  override machine: MachineGrammar = {
    forms: 'chats tidy | chats tidy dry',
    example: 'chats tidy',
    reach: 'editing',
    scope: 'local',
  }

  protected async execute(args: string): Promise<void> {
    const words = args.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (words[0] !== 'tidy' || words.length > 2 || (words[1] !== undefined && words[1] !== 'dry')) {
      this.#say('Chats: say "chats tidy", or "chats tidy dry" to see what would move first')
      return
    }
    const dryRun = words[1] === 'dry'
    const result = await tidyJobConversations({ dryRun })
    const unanswered = result.jobs.filter(job => !job.replied).length
    const left = Object.entries(result.passed).map(([why, n]) => `${n} ${why}`).join(', ')
    if (!result.jobs.length) {
      this.#say(`Chats: nothing to put away${left ? ` (left: ${left})` : ''}`)
      return
    }
    const count = dryRun ? result.jobs.length : result.archived
    this.#say(`Chats: ${dryRun ? 'would put away' : 'put away'} ${count} job conversation${count === 1 ? '' : 's'}`
      + `${unanswered ? `, ${unanswered} never answered` : ''}${left ? `; left: ${left}` : ''}`
      + `${dryRun ? '' : ' — the archive in the chat window lists them'}`)
    for (const job of result.jobs.slice(0, SHOWN)) this.#say(`  ${job.replied ? 'answered' : 'unanswered'}: ${job.title || job.convoId}`)
    if (result.jobs.length > SHOWN) this.#say(`  and ${result.jobs.length - SHOWN} more`)
    if (!dryRun) EffectBus.emit('chat:threads-changed', {})
  }

  #say(message: string): void {
    EffectBus.emit('activity:log', { message, icon: '🗂' })
  }
}

const _chats = new ChatsQueenBee()
window.ioc.register('@diamondcoreprocessor.com/ChatsQueenBee', _chats)
