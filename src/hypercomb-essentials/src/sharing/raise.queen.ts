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
import { latestByLineageKey, type PublishLedgerEntry } from './publish-heads.js'
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
    if (!what) { this.#say(this.#t('raise.usage', 'Raise: say which — a creation\'s name or its address, for example "raise business-card"')); return }
    const found = get<NavigationLike>('@hypercomb.social/Navigation')
    const navigation = found?.goRaw ? { goRaw: found.goRaw.bind(found) } : null
    if (!navigation) { this.#say(this.#t('raise.no-navigation', 'Raise: navigation is not ready')); return }

    const link = await resolveLink(what)
    if (link.kind === 'none') { this.#say(this.#t('raise.none', 'Raise: nothing published is called "{what}"', { what })); return }
    if (link.kind === 'own') { this.#walk(navigation, link.door.name, link.door.segments); return }

    const head = await readLinkHead(link.address)
    if ('error' in head) { this.#say(this.#t('raise.unread', 'Raise: {address} could not be read ({error})', { address: link.address, error: head.error })); return }

    // OURS AFTER ALL. The door table only knows what was published since it
    // existed; the publish ledger knows every head this device signed. A head
    // it holds under that very publisher and lineage is our own creation —
    // walk to it, never offer ourselves to ourselves.
    const ours = (await latestByLineageKey(head.pubkey).catch(() => new Map<string, PublishLedgerEntry>())).get(head.lineage)
    if (ours) { this.#walk(navigation, ours.record.segments[ours.record.segments.length - 1] ?? head.lineage, ours.record.segments); return }

    const peers = get<{ offers?: () => readonly StaticOffer[] }>('@diamondcoreprocessor.com/StaticPeersDrone')
    if (!peers) { this.#say(this.#t('raise.no-peers', 'Raise: this shell cannot show another host\'s creation')); return }
    const segments = head.lineage.split('/').map(s => s.trim()).filter(Boolean)
    const name = segments[segments.length - 1] ?? ''
    if (!name) { this.#say(this.#t('raise.nameless', 'Raise: {address} names no creation', { address: link.address })); return }
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
    // Offers are kept by name, so a name already offered may be ANOTHER
    // publisher's creation. Only the same publisher and lineage is the same
    // creation; anything else is offered in its place, and the log says so.
    const standing = peers.offers?.().find(o => o.name === name)
    const same = !!standing && standing.pubkey === offer.pubkey && standing.lineageKey === offer.lineageKey
    if (!same) EffectBus.emit('community:offer', offer)
    navigation.goRaw([name])
    const title = head.title || name
    this.#say(standing && !same
      ? this.#t('raise.replaced', 'Raise: {title} from {host} is on top, shaded, in place of the "{name}" you were shown from {prior}', { title, host: here, name, prior: standing.hosts[0] ?? '' })
      : this.#t('raise.offered', 'Raise: {title} from {host} is on top, shaded — the publications view puts it back', { title, host: here }))
  }

  /** One of ours: it is already in this hive, so raising it is walking to it. */
  #walk(navigation: Required<NavigationLike>, name: string, segments: readonly string[]): void {
    navigation.goRaw(segments)
    this.#say(this.#t('raise.walked', 'Raise: {name} is on top — {route}', { name, route: `/${segments.join('/')}` }))
  }

  /** Localized text; `t()` hands the key back when it has none. */
  #t(key: string, fallback: string, params?: Record<string, unknown>): string {
    const i18n = get<{ t(k: string, p?: Record<string, unknown>): string }>('@hypercomb.social/I18n')
    const text = i18n?.t?.(key, params)
    if (text && text !== key) return text
    return fallback.replace(/\{(\w+)\}/g, (all, token: string) => params && token in params ? String(params[token]) : all)
  }

  #say(message: string): void {
    EffectBus.emit('activity:log', { message, icon: '⬆' })
  }
}

const _raise = new RaiseQueenBee()
window.ioc.register('@diamondcoreprocessor.com/RaiseQueenBee', _raise)
