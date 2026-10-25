// sharing/keys.queen.ts
//
// `keys` — who publishes for you (jwize, 2026-10-24: "we need a safe way to
// share our publish key between domains" … "That way I can pass it and unfold
// it (ie allow publishing to that device)").
//
//   keys                      who publishes for you, and which place this is
//   keys allow [<domain>]     let another place publish for you — a link to open there
//   keys accept [<link>]      take an invite: this place publishes for its anchor
//   keys off <place>          take a place off, by its label or the start of its key
//
// THE KEY NEVER MOVES. Every place makes its own key; `allow` writes a ten-minute
// invite into your signed key list and gives you a link, and `accept` — typed at
// the other place — adds that place's own key to the list. Nothing secret is
// copied (documentation/becoming-a-host.md, "Letting another place publish for
// you"; the rules are core key-list.ts, the acts are key-list.client.ts).
//
// ONLY THE PARTICIPANT SAYS ANY OF THE CHANGES. An invite is the power to
// publish as someone, so a link that merely lands is held and never spent:
// opening one tells you it arrived and what to type. A machine may read who
// publishes for the participant, and nothing more.

import { EffectBus, QueenBee, get, requestConfirm, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { AnchorBinding, ANCHOR_BINDING_IOC_KEY } from './anchor-binding.js'
import { fetchHiveIndex, putHiveManifest } from './hive-pointer.js'
import {
  acceptInvite, allowAnother, captureInvite, listKeys, parseInvite, pendingInvite, removeKey,
  type KeysAcceptResult, type KeysAllowResult, type KeysOffResult,
} from './key-list.client.js'
import { listCommunityHosts, listZoneBindings } from './community-hosts.js'
import { showInviteQr } from './invite-qr.view.js'
import { nodesFor } from './publish-branch.js'
import { isPublishNode } from './zone-door.js'

const HOST_SYNC_KEY = '@diamondcoreprocessor.com/HostSyncService'

const t = (key: string, fallback: string, params: Record<string, string> = {}): string => {
  const value = get<I18nProvider>(I18N_IOC_KEY)?.t?.(key, params)
  return value && value !== key ? value : fallback.replace(/\{(\w+)\}/g, (_, name: string) => params[name] ?? '')
}

export type KeysWord =
  | { form: 'list' }
  | { form: 'allow'; where: string }
  | { form: 'accept'; link: string; label: string }
  | { form: 'off'; place: string }

/** `keys`, `keys allow [<domain>]`, `keys accept [<link>] [as <label>]`, `keys off <place>`.
 *  A word it does not know is the list, which shows the forms. */
export const parseKeysWord = (args: string): KeysWord => {
  const text = String(args ?? '').trim()
  const [first = '', ...rest] = text.split(/\s+/)
  const word = first.toLowerCase()
  const tail = rest.join(' ').trim()
  if (word === 'allow') return { form: 'allow', where: tail.replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase() }
  if (word === 'accept') {
    // `keys accept <link> as <label>` names the place; the label is optional.
    const named = /^(.*?)\s+as\s+(.+)$/i.exec(tail)
    return { form: 'accept', link: (named ? named[1] : tail).trim(), label: named ? named[2].trim() : '' }
  }
  if (word === 'off') return { form: 'off', place: tail }
  return { form: 'list' }
}

/** A machine may read who publishes; changing it is the participant's. */
export const keysMachineRefusal = (args: string): string | undefined => {
  const word = parseKeysWord(args)
  if (word.form === 'list') return undefined
  return `/keys ${word.form} changes who may publish as the participant — only the participant says it`
}

const short = (key: string): string => `${key.slice(0, 8)}…`

export class KeysQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'sharing'
  readonly command = 'keys'
  override description = 'Who publishes for you — let another place publish, take an invite, or take a place off'
  override descriptionKey = 'slash.keys'
  override options = ['allow', 'accept <link>', 'off <place>']
  override examples = [
    { input: '/keys', result: 'Who publishes for you, and which place this is' },
    { input: '/keys allow example.org', result: 'A link to open at example.org — good for ten minutes' },
    { input: '/keys accept <link>', result: 'This place publishes for the participant who sent the link' },
    { input: '/keys off desktop', result: 'The place named desktop no longer publishes for you' },
  ]

  // A link is the whole argument: its dots and slashes are not a walk.
  override rawArgs = true

  override machine = {
    forms: '',
    example: '/keys',
    bare: true,
    consequence: "Shows who publishes for the participant, from their own hosts; every change is refused — an invite is the power to publish as them.",
    // Shows only: it reads the participant's own hosts and writes nothing.
    reach: 'additive' as const,
    scope: 'local' as const,
    refuse: keysMachineRefusal,
  }

  readonly #binding = new AnchorBinding()

  constructor() {
    super()
    // One instance, reachable by key: the publish path asks it whose index it writes.
    try { window.ioc.register(ANCHOR_BINDING_IOC_KEY, this.#binding) } catch { /* a spec without a registry */ }
    // An invite link that landed is held, never spent: say it arrived.
    try {
      const parts = captureInvite(window.location, window.history)
      if (parts) {
        this.#say(t('keys.arrived', 'An invitation to publish for {anchor} arrived. Type keys accept to take it, or ignore it.', { anchor: short(parts.anchor) }), 'info')
        void this.#offer()
      }
    } catch { /* no address to read */ }
  }

  /** THE ONE TAP (jwize 2026-10-25: "the transport and distribution of keys must be safe and easy"). An invite
   *  that landed is still never spent on its own: the participant is asked once, in words, and their tap is
   *  the act. "Not now" leaves it held, and `keys accept` still takes it. The device is named by what it is
   *  (a phone, or the host it is) so `keys off` can find it. */
  async #offer(): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, 1500))
    const parts = pendingInvite()
    if (!parts) return
    const asked = await requestConfirm({
      title: t('keys.offer.title', 'Add this device?'),
      message: t('keys.offer.message', 'Let this device publish for {anchor}. It keeps its own key — nothing secret is copied — the invite works once, and you can take this device off any time with keys off.', { anchor: short(parts.anchor) }),
      confirmLabel: t('keys.offer.yes', 'Add this device'),
      cancelLabel: t('keys.offer.no', 'Not now'),
    }).catch(() => false)
    if (!asked) return
    const coarse = !!globalThis.matchMedia?.('(pointer: coarse)')?.matches
    await this.#accept('', coarse ? 'phone' : '')
  }

  override slashComplete(args: string): readonly string[] {
    const typed = args.toLowerCase().replace(/^\s+/, '')
    const words = ['allow', 'accept ', 'off ']
    if (/\s/.test(typed)) return []
    return words.filter(w => w.startsWith(typed) && w !== typed)
  }

  protected async execute(args: string): Promise<void> {
    const word = parseKeysWord(args)
    switch (word.form) {
      case 'list': return this.#list()
      case 'allow': return this.#allow(word.where)
      case 'accept': return this.#accept(word.link, word.label)
      case 'off': return this.#off(word.place)
    }
  }

  /** The nodes this participant publishes to: where the list is kept. The domains the root is marked with,
   *  the standing targets, AND the zones this hive holds a binding for — a domain you have claimed is a
   *  place you publish to even when the root itself carries no host mark (jwize 2026-10-25: "but it was
   *  already there"). A followed host (`hosts add`) is tried only when nothing is marked or claimed. */
  async #hosts(): Promise<string[]> {
    const hostSync = get<Parameters<typeof nodesFor>[1]>(HOST_SYNC_KEY)
    const marked = await nodesFor([], hostSync).catch(() => [] as string[])
    const bound = (await listZoneBindings().catch(() => [])).map(binding => binding.zone)
    const nodes = [...new Set([...marked, ...bound])].filter(isPublishNode)
    if (nodes.length) return nodes
    // Nothing is marked or claimed: the hosts this hive follows are the last place to look. A host that is
    // not yours refuses the list, and that refusal is said in words — better than "no host" for one you named.
    return (await listCommunityHosts().catch(() => [] as string[])).filter(isPublishNode)
  }

  async #list(): Promise<void> {
    const hosts = await this.#hosts()
    const listing = hosts.length ? await listKeys(hosts) : null
    const anchor = this.#binding.anchor()
    if (!listing) {
      this.#say(anchor
        ? t('keys.bound', 'This place publishes for {anchor}, but no host you publish to holds its list.', { anchor: short(anchor) })
        : t('keys.alone', 'Only this place publishes for you. keys allow lets another place publish too.'), 'info')
      return
    }
    const names = listing.keys.map(k => {
      const name = k.label || short(k.pubkey)
      return k.you ? t('keys.you', '{name} (this place)', { name }) : name
    })
    this.#say(t('keys.list', 'Publishing for {anchor}: {names}', { anchor: short(listing.anchor), names: names.join(', ') })
      + (listing.invites ? ` — ${t('keys.open', '{count} open invite(s)', { count: String(listing.invites) })}` : ''), 'info')
  }

  async #allow(where: string): Promise<void> {
    const hosts = await this.#hosts()
    const result = await allowAnother(hosts, { where })
    if (!result.ok) { this.#say(this.#allowFailed(result), 'warning'); return }
    // The link is the invite itself: it goes to the clipboard, and nowhere else.
    let copied = false
    try { await navigator.clipboard.writeText(result.link); copied = true } catch { /* shown below */ }
    const minutes = String(Math.max(1, Math.round((result.until - Math.floor(Date.now() / 1000)) / 60)))
    // The same link as a code, for a phone in the room: its camera reads it and opens the link.
    const shown = showInviteQr(result.link, result.until)
    this.#say(copied
      ? t(shown ? 'keys.allowed.qr' : 'keys.allowed.copied', shown
        ? 'Link copied, and shown as a code. Point the phone at it, or open the link at the other place, within {minutes} minutes.'
        : 'Link copied. Open it at the other place within {minutes} minutes, then type keys accept there.', { minutes })
      : t('keys.allowed.shown', 'Open this at the other place within {minutes} minutes, then type keys accept there: {link}', { minutes, link: result.link }), 'success')
  }

  #allowFailed(result: Extract<KeysAllowResult, { ok: false }>): string {
    switch (result.reason) {
      case 'no-signer': return t('keys.nosigner', 'This place has no signing key yet.')
      case 'no-host': return t('keys.nohost', 'Name a host first — hosts add <your-domain> — so there is somewhere to keep your list.')
      case 'not-listed': return t('keys.notlisted', "This place is not on your list, so it cannot let another in. Do it from a place that is.")
      case 'unreachable': return t('keys.unreachable', 'No host you publish to answered.')
      default: return t('keys.refused', 'The list was not changed: {detail}', { detail: result.detail ?? 'refused' })
    }
  }

  async #accept(link: string, label: string): Promise<void> {
    const parts = parseInvite(link) ?? (link ? null : pendingInvite())
    if (!parts) { this.#say(t('keys.noinvite', 'Open an invite link at this place, or paste it: keys accept <link>'), 'warning'); return }
    const name = label || String(window.location?.hostname ?? '').toLowerCase()
    const result = await acceptInvite(`invite=${parts.host}/${parts.anchor}/${parts.secret}`, { label: name })
    this.#say(this.#acceptText(result, parts.anchor), result.ok ? 'success' : 'warning')
  }

  #acceptText(result: KeysAcceptResult, anchor: string): string {
    if (result.ok) {
      return result.already
        ? t('keys.alreadyin', 'This place was already on the list. It publishes for {anchor}.', { anchor: short(anchor) })
        : t('keys.accepted', 'This place now publishes for {anchor}. It keeps its own key; the list names it.', { anchor: short(anchor) })
    }
    switch (result.reason) {
      case 'own-anchor': return t('keys.ownanchor', 'This place is that participant\'s own anchor already.')
      case 'no-signer': return t('keys.nosigner', 'This place has no signing key yet.')
      case 'unreachable': return t('keys.unreachable', 'The host named in the invite did not answer.')
      case 'no-list': return t('keys.nolist', 'The host holds no list for that participant.')
      case 'unknown-invite': return t('keys.unknown', 'That invite is not on the list — it was used, taken back, or never written.')
      case 'expired': return t('keys.expired', 'That invite has expired. Ask for another.')
      case 'no-invite': return t('keys.noinvite', 'Open an invite link at this place, or paste it: keys accept <link>')
      default: return t('keys.refused', 'The list was not changed: {detail}', { detail: result.detail ?? 'refused' })
    }
  }

  async #off(place: string): Promise<void> {
    if (!place) { this.#say(t('keys.offwhich', 'Which place? keys off <label or the start of its key>'), 'warning'); return }
    const hosts = await this.#hosts()
    const result = await removeKey(hosts, place, {
      // So nothing the removed key signed is still the head.
      resign: async (host, anchor) => {
        const read = await fetchHiveIndex(host, anchor)
        if (read.ok) await putHiveManifest(host, read.manifest.roots, read.manifest.doors ?? {}, read.manifest.createdAt, read.manifest.signedContent)
      },
    })
    this.#say(this.#offText(result, place), result.ok ? 'success' : 'warning')
  }

  #offText(result: KeysOffResult, place: string): string {
    if (result.ok) {
      const name = result.removed.label || short(result.removed.pubkey)
      return result.ownRemoved
        ? t('keys.offself', 'This place no longer publishes for that participant.')
        : t('keys.off', '{name} no longer publishes for you. Hosts refuse what it signs from now on.', { name })
    }
    switch (result.reason) {
      case 'no-match': return t('keys.nomatch', 'No place on your list is called {place}.', { place })
      case 'ambiguous': return t('keys.ambiguous', 'More than one place matches {place} — type more of its key.', { place })
      case 'not-listed': return t('keys.notlisted', "This place is not on your list, so it cannot let another in. Do it from a place that is.")
      case 'no-host': return t('keys.nohost', 'Name a host first — hosts add <your-domain> — so there is somewhere to keep your list.')
      case 'unreachable': return t('keys.unreachable', 'No host you publish to answered.')
      case 'no-signer': return t('keys.nosigner', 'This place has no signing key yet.')
      default: return t('keys.refused', 'The list was not changed: {detail}', { detail: result.detail ?? 'refused' })
    }
  }

  #say(message: string, type = 'info'): void {
    EffectBus.emit('activity:log', { message, icon: '🔑' })
    EffectBus.emit('toast:show', { type, message })
  }
}

const _keys = new KeysQueenBee()
window.ioc.register('@diamondcoreprocessor.com/KeysQueenBee', _keys)
