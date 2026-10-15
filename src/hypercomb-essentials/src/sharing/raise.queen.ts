// sharing/raise.queen.ts
//
// `raise` — bring a linked creation's layer to the top (jwize, 2026-10-15:
// "a control that allows us to move the layers to the top for individual
// links in the hive"; "it is like a limitless rubik's cube"). The addresses
// never move; a raise is a twist that puts another face on top.
//
//   raise business-card                 one of ours, by name: walk to its layer
//   raise business-card.jwize.com       by address — ours, or someone else's
//   raise https://card.pointblanksolutions.ca
//
// One of OUR creations is already in this hive, so raising it is walking to
// it. Someone else's is read at its live head and OFFERED — the same shaded
// peer the publications view's "show it in your hive" places — then walked
// to. Nothing is copied or kept: an offer is a view, withdrawn like any other.
// The link control on a coloured name says this word on a click.

import { EffectBus, get, QueenBee, type MachineGrammar } from '@hypercomb/core'
import { hostZone } from './community-hosts.js'
import { readLinkHead, resolveLink } from './link-acts.js'
import type { StaticOffer } from './static-peers.js'

type NavigationLike = { goRaw?: (segments: readonly string[]) => void }

export class RaiseQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'raise'
  override description = 'Bring a linked creation to the top: yours by name or address walks to its layer; another host\'s is offered in your hive, shaded, and walked to'
  override descriptionKey = 'slash.raise'
  override options = ['<name>', '<address>']
  override examples = [
    { input: '/raise business-card', result: 'You are in your creation "business-card"' },
    { input: '/raise card.pointblanksolutions.ca', result: 'That creation is shown in your hive, shaded, and you are in it' },
  ]
  override rawArgs = true
  override machine: MachineGrammar = {
    forms: 'raise <name> | raise <address>',
    example: 'raise business-card',
    reach: 'additive',
    scope: 'hive',
  }

  protected async execute(args: string): Promise<void> {
    const what = args.trim()
    if (!what) { this.#say('Raise: say which — a creation\'s name or its address, for example "raise business-card"'); return }
    const navigation = get<NavigationLike>('@hypercomb.social/Navigation')
    if (!navigation?.goRaw) { this.#say('Raise: navigation is not ready'); return }

    const link = await resolveLink(what)
    if (link.kind === 'none') { this.#say(`Raise: nothing published is called "${what}"`); return }
    if (link.kind === 'own') {
      navigation.goRaw(link.door.segments)
      this.#say(`Raise: ${link.door.name} is on top — /${link.door.segments.join('/')}`)
      return
    }

    const head = await readLinkHead(link.address)
    if ('error' in head) { this.#say(`Raise: ${link.address} could not be read (${head.error})`); return }
    const peers = get<{ isOffered?: (name: string) => boolean }>('@diamondcoreprocessor.com/StaticPeersDrone')
    if (!peers) { this.#say('Raise: this shell cannot show another host\'s creation'); return }
    const segments = head.lineage.split('/').map(s => s.trim()).filter(Boolean)
    const name = segments[segments.length - 1] ?? ''
    if (!name) { this.#say(`Raise: ${link.address} names no creation`); return }
    const here = hostZone(head.host)
    const above = here.split('.').slice(1).join('.')
    const offer: StaticOffer = {
      name,
      pubkey: head.pubkey,
      hosts: [...new Set([here, above].filter(z => z && z.includes('.')))],
      lineageKey: head.lineage,
      segments,
      head: head.head,
    }
    if (!peers.isOffered?.(name)) EffectBus.emit('community:offer', offer)
    navigation.goRaw([name])
    this.#say(`Raise: ${head.title || name} from ${here} is on top, shaded — the publications view puts it back`)
  }

  #say(message: string): void {
    EffectBus.emit('activity:log', { message, icon: '⬆' })
  }
}

const _raise = new RaiseQueenBee()
window.ioc.register('@diamondcoreprocessor.com/RaiseQueenBee', _raise)
