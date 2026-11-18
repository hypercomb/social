// sharing/private.queen.ts
//
// `private` — a published page, sealed to the people you name (jwize 2026-10-25: "we can send the encrypted
// information there … and then the participants get the key to view it").
//
//   private                      SET THE TILE PRIVATE (jwize 2026-11-18): kept on its hosts as ciphertext only your key
//                                opens, out of every community, its staged copy withdrawn and forgotten after you say
//                                yes (tile-visibility.ts, private-keep.ts). `private /a/b` names the tile by route. The
//                                counterpart is `public`.
//   private on <domain>          the same, naming that domain on the tile first: where a tile that was never staged is kept
//   private sync                 bring every private tile your key keeps on the hosts this hive knows into this device
//   private who                  who the page you stand on is sealed to, if it is
//   private <key> [<key> …]      seal it to them: ciphertext goes to your host, and each one opens it with their own key
//   private off                  stop naming the private versions (the ciphertext stays where hosts hold it, unnamed)
//
// A key is a 64-character hex public key or an npub. The page must already be published: a private version hangs off a
// published root (documentation/sealed-audiences.md). Hosts carry bytes they cannot read; the door secret reaches each person
// sealed to THEIR public key, so nothing secret is sent anywhere. Removing someone governs FUTURE versions only: what they
// already fetched, they keep. Sealing asks first, in words.

import { EffectBus, QueenBee, get, requestConfirm, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { privateAudience, publishPrivate, withdrawPrivate } from './sealed-publish.js'
import { liveVisibilityDeps, makePrivate } from './tile-visibility.js'

const SIG = /^[0-9a-f]{64}$/i

const t = (key: string, fallback: string, params: Record<string, string> = {}): string => {
  const value = get<I18nProvider>(I18N_IOC_KEY)?.t?.(key, params)
  return value && value !== key ? value : fallback.replace(/\{(\w+)\}/g, (_, name: string) => params[name] ?? '')
}

export type PrivateWord = { form: 'set'; route?: string[]; on?: string } | { form: 'show' } | { form: 'sync' } | { form: 'off' } | { form: 'seal'; members: string[]; unknown: string[] }

/** A public key as hex: 64 hex characters as they are, an npub decoded; null for anything else. */
export const memberKey = async (raw: string): Promise<string | null> => {
  const text = String(raw ?? '').trim()
  if (SIG.test(text)) return text.toLowerCase()
  if (!/^npub1[0-9a-z]+$/.test(text)) return null
  try {
    const { decode } = await import('nostr-tools/nip19')
    const decoded = decode(text)
    return decoded.type === 'npub' && SIG.test(String(decoded.data)) ? String(decoded.data).toLowerCase() : null
  } catch { return null }
}

/** `private`, `private /route`, `private who`, `private off`, `private <key> …`. Words it cannot read as keys come back as `unknown`, so none is dropped silently. */
export const parsePrivateWord = async (args: string): Promise<PrivateWord> => {
  const words = String(args ?? '').trim().split(/\s+/).filter(Boolean)
  // `private`, `private /a/b`, and either with `on <domain>` at the end.
  const rest = [...words]
  const route = rest[0]?.startsWith('/') ? rest.shift()!.split('/').map(s => s.trim()).filter(Boolean) : undefined
  const on = rest.length === 2 && rest[0]!.toLowerCase() === 'on' ? rest[1]!.toLowerCase() : undefined
  if (rest.length === 0 || on) return { form: 'set', ...(route ? { route } : {}), ...(on ? { on } : {}) }
  if (words.length === 1 && words[0]!.toLowerCase() === 'who') return { form: 'show' }
  if (words.length === 1 && words[0]!.toLowerCase() === 'sync') return { form: 'sync' }
  if (words.length === 1 && words[0]!.toLowerCase() === 'off') return { form: 'off' }
  const members: string[] = []
  const unknown: string[] = []
  for (const word of words) {
    const key = await memberKey(word)
    if (key) { if (!members.includes(key)) members.push(key) } else unknown.push(word)
  }
  return { form: 'seal', members, unknown }
}

const short = (key: string): string => `${key.slice(0, 8)}…${key.slice(-4)}`

export class PrivateQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'sharing'
  readonly command = 'private'
  override description = 'Set the tile you stand on private — kept sealed on its hosts for your key only; private sync brings your private tiles into this device; or seal it to the people you name'
  override descriptionKey = 'slash.private'
  override options = ['/<route>', 'on <domain>', 'sync', 'who', '<key> …', 'off']
  override examples = [
    { input: '/private npub1…', result: 'The page is sealed to that key; they open it with their own' },
    { input: '/private off', result: 'The private versions are no longer named' },
    { input: '/private', result: 'The tile is kept sealed on its hosts, for your key only, and is out of every community' },
    { input: '/private sync', result: 'Your private tiles on the hosts this hive knows are opened with your key and brought in' },
    { input: '/private who', result: 'Who the page is sealed to' },
  ]

  // Keys are the whole argument.
  override rawArgs = true

  protected async execute(args: string): Promise<void> {
    const word = await parsePrivateWord(args)
    if (word.form === 'sync') return this.#sync()
    const segments = ((word.form === 'set' ? word.route : undefined) ?? get<{ explorerSegments?: () => string[] }>('@hypercomb.social/Lineage')?.explorerSegments?.() ?? [])
      .map(s => String(s ?? '').trim()).filter(Boolean)
    if (segments.length === 0) { this.#say(t('private.nopage', 'Go into the page you want to seal first — the hive root is not a page.'), 'warning'); return }
    if (word.form === 'set') return this.#set(segments, word.on)
    if (word.form === 'show') return this.#show(segments)
    if (word.form === 'off') return this.#off(segments)
    return this.#seal(segments, word.members, word.unknown)
  }

  /** The tile kept on its hosts as ciphertext only, out of every community, its staged copy withdrawn and forgotten
   *  (tile-visibility.ts). Each line says one thing that is now true, or the one thing that is not. */
  async #set(segments: string[], on?: string): Promise<void> {
    const name = segments[segments.length - 1]!
    if (on) {
      // The host mark only: nothing is staged, so no plain byte leaves for it.
      const { addBranchHost, hostZone } = await import('./community-hosts.js')
      const zone = hostZone(on)
      if (!zone) { this.#say(t('private.nodomain', 'Say the domain: private on <domain>, for example private on example.com.'), 'warning'); return }
      await addBranchHost(segments, zone)
    }
    const result = await makePrivate(segments, liveVisibilityDeps())
    if (!result.ok) {
      if (result.reason !== 'declined') this.#say(t('private.failed', 'Not changed: {reason}', { reason: this.#reason(result.reason === 'no-signer' ? 'no-signer' : 'no-head') }), 'warning')
      return
    }
    const refused = result.refused.map(r => `${r.zone} (${r.reason})`).join(', ')
    if (refused) this.#say(t('private.stillon', '{name} is still in the community of {zones}.', { name, zones: refused }), 'warning')
    if (!result.kept.length) {
      this.#say(t('private.notkept', '{name} is not kept on a host: {reason}. It is in this hive only{staged}.', {
        name, reason: this.#reason(result.keepReason ?? ''), staged: result.staged.length ? `, and its staged copy on ${result.staged.join(', ')} was left as it was` : '',
      }), 'warning')
      return
    }
    this.#say(t('private.kept', '{name} is private: kept sealed on {hosts}, for your key only. On another device of yours, say private sync.', { name, hosts: result.kept.join(', ') }), 'success')
    if (!result.staged.length) return
    if (!result.withdrawn) { this.#say(t('private.notwithdrawn', 'Its staged copy is still on {zones}: {reason}. stage off <domain> withdraws it.', { zones: result.staged.join(', '), reason: result.withdrawReason ?? '' }), 'warning'); return }
    this.#say(result.forgetReason
      ? t('private.notforgotten', 'Its staged copy is withdrawn, but the hosts did not forget its bytes: {reason}. Anyone holding a signature can still fetch them.', { reason: result.forgetReason })
      : t('private.forgotten', 'Its staged copy is withdrawn and {count} item(s) were forgotten by the hosts. What anyone already fetched, they keep.', { count: String(result.forgotten ?? 0) }),
      result.forgetReason ? 'warning' : 'success')
  }

  /** Bring every private tile this key keeps on the hosts this hive knows into this device (private-keep.ts). */
  async #sync(): Promise<void> {
    const { bringPrivate, liveBringDeps } = await import('./private-keep.js')
    const result = await bringPrivate(await liveBringDeps())
    if (!result.ok) { this.#say(t('private.failed', 'Not changed: {reason}', { reason: this.#reason(result.reason) }), 'warning'); return }
    const names = result.brought.map(tile => `/${tile.route.join('/')}`).join(', ')
    this.#say(result.brought.length
      ? t('private.brought', 'Opened with your key and on their way in: {names}.', { names })
      : t('private.nothingnew', 'No private tile to bring in: {here} already here.', { here: String(result.here) }), result.brought.length ? 'success' : 'info')
    if (result.unopened) this.#say(t('private.unopened', '{count} private tile(s) did not open with this device\'s key, or are incomplete on the host.', { count: String(result.unopened) }), 'warning')
    if (result.unread.length) this.#say(t('private.unread', 'Not read: {hosts}.', { hosts: result.unread.join(', ') }), 'warning')
  }

  async #show(segments: string[]): Promise<void> {
    const audience = await privateAudience(segments)
    this.#say(audience
      ? t('private.audience', 'Sealed to {keys}. They open it with their own key.', { keys: audience.map(short).join(', ') })
      : t('private.none', 'This page has no private version. private seals it to your own devices; private <key> seals it to someone.'), 'info')
  }

  async #off(segments: string[]): Promise<void> {
    // The private copy of the tile itself (private-keep.ts) stops being named too.
    const { dropPrivate, liveDropDeps } = await import('./private-keep.js')
    const copy = await dropPrivate(segments, await liveDropDeps())
    if (copy.had) this.#say(t('private.copyoff', 'Its private copy is no longer named on {count} host(s). The ciphertext stays there, unnamed.', { count: String(copy.had) }), 'success')
    if (copy.failed.length) this.#say(t('private.copykept', 'Its private copy is still named on {hosts}.', { hosts: copy.failed.join(', ') }), 'warning')
    const result = await withdrawPrivate(segments)
    if (!result.ok && result.reason === 'not-published' && (copy.had || copy.failed.length)) return
    this.#say(result.ok
      ? (result.had ? t('private.off', 'The private versions are no longer named. Ciphertext already on hosts stays, unnamed; what anyone fetched, they keep.') : t('private.noneoff', 'This page had no private version.'))
      : t('private.failed', 'Not changed: {reason}', { reason: this.#reason(result.reason) }), result.ok ? 'success' : 'warning')
  }

  async #seal(segments: string[], members: string[], unknown: string[]): Promise<void> {
    if (unknown.length) { this.#say(t('private.unknown', 'These are not keys — use 64-character hex or an npub: {words}', { words: unknown.join(' ') }), 'warning'); return }
    if (members.length === 0) { this.#say(t('private.nokeys', 'Name at least one key: private <key>.'), 'warning'); return }
    const name = segments[segments.length - 1]!
    const ok = await requestConfirm({
      title: t('private.confirm.title', 'Seal this page?'),
      message: t('private.confirm.message', '{name} will be sealed to {count} key(s) and you. Hosts carry the ciphertext and cannot read it; each person opens it with their own key. Taking someone out later only governs future versions.', { name, count: String(members.length) }),
      confirmLabel: t('private.confirm.yes', 'Seal it'),
      cancelLabel: t('private.confirm.no', 'Not now'),
    }).catch(() => false)
    if (!ok) return
    const result = await publishPrivate(segments, members)
    this.#say(result.ok
      ? t('private.done', '{name} is sealed to {count} key(s). It opens only with their own keys.', { name, count: String(members.length) })
      : t('private.failed', 'Not changed: {reason}', { reason: this.#reason(result.reason, 'detail' in result ? result.detail : undefined) }), result.ok ? 'success' : 'warning')
  }

  #reason(reason: string, detail?: string): string {
    switch (reason) {
      case 'not-published': return t('private.r.unpublished', 'the page is not published yet — publish it first, a private version hangs off a published page')
      case 'no-host': return t('private.r.nohost', 'no host to keep it on — say private on <domain>')
      case 'no-signer': return t('private.r.nosigner', 'this place has no signing key')
      case 'no-nip44': return t('private.r.nonip44', 'your signer cannot seal to a key (NIP-44)')
      case 'no-head': return t('private.r.nohead', 'the published page could not be read here')
      case 'upload-failed': return t('private.r.upload', 'the host did not take the bytes') + (detail ? `: ${detail}` : '')
      case 'index-failed': return t('private.r.index', 'the index would not name it') + (detail ? `: ${detail}` : '')
      default: return detail ? `${reason}: ${detail}` : reason
    }
  }

  #say(message: string, type = 'info'): void {
    EffectBus.emit('activity:log', { message, icon: '🔒' })
    EffectBus.emit('toast:show', { type, message })
  }
}

const _private = new PrivateQueenBee()
window.ioc.register('@diamondcoreprocessor.com/PrivateQueenBee', _private)
