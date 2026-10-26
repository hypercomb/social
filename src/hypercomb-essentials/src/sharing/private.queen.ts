// sharing/private.queen.ts
//
// `private` — a published page, sealed to the people you name (jwize 2026-10-25: "we can send the encrypted
// information there … and then the participants get the key to view it").
//
//   private                      who the page you stand on is sealed to, if it is
//   private <key> [<key> …]      seal it to them: ciphertext goes to your host, and each one opens it with their own key
//   private off                  stop naming the private versions (the ciphertext stays where hosts hold it, unnamed)
//
// A key is a 64-character hex public key or an npub. The page must already be published: a private version hangs off a
// published root (documentation/sealed-audiences.md). Hosts carry bytes they cannot read; the door secret reaches each person
// sealed to THEIR public key, so nothing secret is sent anywhere. Removing someone governs FUTURE versions only: what they
// already fetched, they keep. Sealing asks first, in words.

import { EffectBus, QueenBee, get, requestConfirm, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { privateAudience, publishPrivate, withdrawPrivate } from './sealed-publish.js'

const SIG = /^[0-9a-f]{64}$/i

const t = (key: string, fallback: string, params: Record<string, string> = {}): string => {
  const value = get<I18nProvider>(I18N_IOC_KEY)?.t?.(key, params)
  return value && value !== key ? value : fallback.replace(/\{(\w+)\}/g, (_, name: string) => params[name] ?? '')
}

export type PrivateWord = { form: 'show' } | { form: 'off' } | { form: 'seal'; members: string[]; unknown: string[] }

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

/** `private`, `private off`, `private <key> …`. Words it cannot read as keys come back as `unknown`, so none is dropped silently. */
export const parsePrivateWord = async (args: string): Promise<PrivateWord> => {
  const words = String(args ?? '').trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return { form: 'show' }
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
  override description = 'Seal the page you stand on to the people you name — hosts carry ciphertext only'
  override descriptionKey = 'slash.private'
  override options = ['<key> …', 'off']
  override examples = [
    { input: '/private npub1…', result: 'The page is sealed to that key; they open it with their own' },
    { input: '/private off', result: 'The private versions are no longer named' },
    { input: '/private', result: 'Who the page is sealed to' },
  ]

  // Keys are the whole argument.
  override rawArgs = true

  protected async execute(args: string): Promise<void> {
    const segments = (get<{ explorerSegments?: () => string[] }>('@hypercomb.social/Lineage')?.explorerSegments?.() ?? [])
      .map(s => String(s ?? '').trim()).filter(Boolean)
    if (segments.length === 0) { this.#say(t('private.nopage', 'Go into the page you want to seal first — the hive root is not a page.'), 'warning'); return }
    const word = await parsePrivateWord(args)
    if (word.form === 'show') return this.#show(segments)
    if (word.form === 'off') return this.#off(segments)
    return this.#seal(segments, word.members, word.unknown)
  }

  async #show(segments: string[]): Promise<void> {
    const audience = await privateAudience(segments)
    this.#say(audience
      ? t('private.audience', 'Sealed to {keys}. They open it with their own key.', { keys: audience.map(short).join(', ') })
      : t('private.none', 'This page has no private version. private <key> seals it to someone.'), 'info')
  }

  async #off(segments: string[]): Promise<void> {
    const result = await withdrawPrivate(segments)
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
      case 'no-host': return t('private.r.nohost', 'no host to keep it on')
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
