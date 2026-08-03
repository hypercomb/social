// diamondcoreprocessor.com/substrate/heal.queen.ts
//
// /heal — put back the pictures a default overwrote.
//
//   /heal          — repair every tile in the hive
//   /heal check    — count the damage without changing anything
//
// A picture a person puts on a tile is theirs and nothing automatic may
// touch it. That was the intent all along, but the mark saying so leaked:
// a tile that once wore a theme default carried the default's mark forward
// into every later edit, so `/background <theme>.force-global` treated
// hand-made tiles as its own and re-dressed them.
//
// The pictures were not destroyed. A re-dress replaces only the two SMALL
// renders; the full-resolution original the editor keeps — and the framing
// chosen for it — were never touched, which is why the edit screen still
// shows the right picture on a tile whose hex shows a default. This
// behaviour draws the small renders again from that original, and marks
// every tile it heals as the participant's, permanently.
//
// Safe to run twice: it repairs only tiles that are marked as defaults yet
// hold a participant original underneath, and a healed tile stops matching.

import { QueenBee, EffectBus, hypercomb } from '@hypercomb/core'
import type { SubstrateService } from './substrate.service.js'

const get = (key: string) => (window as any).ioc?.get?.(key)

export class HealQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'heal'
  override readonly aliases = []
  override description = 'Restore participant pictures a default overwrote'
  override descriptionKey = 'slash.heal'
  override options = ['check']
  override examples = [
    { input: '/heal', result: 'Redraws every overwritten picture from its original' },
    { input: '/heal check', result: 'Reports the damage, changes nothing' },
  ]

  override slashComplete(args: string): readonly string[] {
    const q = args.trim().toLowerCase()
    return 'check'.startsWith(q) ? ['check'] : []
  }

  protected async execute(args: string): Promise<void> {
    const service = get('@diamondcoreprocessor.com/SubstrateService') as SubstrateService | undefined
    if (!service) { this.#log('substrate not ready'); return }
    await service.ensureLoaded()

    const checking = args.trim().toLowerCase() === 'check'
    this.#log(checking ? 'looking for overwritten pictures…' : 'healing pictures…')

    // The counting run is the healing run with the writes skipped — one
    // pass, one set of rules, so `check` can never disagree with `/heal`.
    const result = checking
      ? await service.surveyParticipantImages()
      : await service.healParticipantImages({
          onProgress: (done, total) => {
            if (done % 25 === 0) this.#log(`${done}/${total} tiles`, '◌')
          },
        })

    if (result.healed.length === 0 && result.unrecoverable.length === 0) {
      this.#log(`${result.scanned} tiles checked — nothing to heal`)
      return
    }

    const verb = checking ? 'can be healed' : 'healed'
    if (result.healed.length > 0) {
      this.#log(`${result.healed.length} picture${result.healed.length === 1 ? '' : 's'} ${verb}`)
      for (const label of result.healed.slice(0, 20)) this.#log(label, '▫')
      if (result.healed.length > 20) this.#log(`…and ${result.healed.length - 20} more`, '▫')
    }
    // Named, never guessed at: a tile with no original kept is one only the
    // participant can put right, and saying which ones is the honest answer.
    if (result.unrecoverable.length > 0) {
      this.#log(`${result.unrecoverable.length} tile${result.unrecoverable.length === 1 ? '' : 's'} keep no original — set those by hand`, '△')
      for (const label of result.unrecoverable.slice(0, 20)) this.#log(label, '△')
    }

    if (!checking && result.healed.length > 0) void new hypercomb().act()
  }

  #log(message: string, icon = '◈'): void {
    EffectBus.emit('activity:log', { message, icon })
  }
}

const _heal = new HealQueenBee()
window.ioc.register('@diamondcoreprocessor.com/HealQueenBee', _heal)
