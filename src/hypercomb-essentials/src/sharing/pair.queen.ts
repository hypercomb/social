// sharing/pair.queen.ts
//
// `pair` — tell two of your own devices they are one participant, without the
// key ever leaving the device that holds it (documentation/device-sync.md).
//
//   pair                       this device's key, and whose it is
//   pair add <key> [name …]    you are the master: vouch for the device that showed you <key>
//   pair accept <token>        you are the new device: take the master's word that you belong to it
//   pair remove <key>          you are the master: take a device back out
//
// The flow is three steps. On the NEW device run `pair` and read out its key.
// On the MASTER run `pair add <that key> laptop`; it copies a token. On the new
// device run `pair accept <token>`; it shows whose word it is taking and asks.
// A token holds only the master's signed word, nothing secret, so it can travel
// by any channel. `pair remove` makes a token too: hand it to the master's other
// devices with `pair accept`, because a device can only turn away a revoked
// device it has heard about.
//
// Pairing alone moves no data. It records who belongs to whom; the replication
// layer checks it (device-handshake.ts) before a single atom flows.

import { EffectBus, QueenBee, get, requestConfirm, I18N_IOC_KEY, type I18nProvider } from '@hypercomb/core'
import { mintDelegation, mintRevocation, type EventSigner, type NostrEventLike } from './device-delegation.js'
import {
  DEVICE_PAIRING_CHANGED,
  activeDevices,
  decodeToken,
  encodeToken,
  loadPairing,
  recordMinted,
  savePairing,
  takeToken,
  type PairingStoreLike,
  type PairingState,
} from './device-pairing.js'

const HEX64 = /^[0-9a-f]{64}$/i
const NOSTR_SIGNER_KEY = '@diamondcoreprocessor.com/NostrSigner'

type SignerLike = EventSigner & { getPublicKeyHex?: () => Promise<string | null> }

const t = (key: string, fallback: string, params: Record<string, string> = {}): string => {
  const value = get<I18nProvider>(I18N_IOC_KEY)?.t?.(key, params)
  return value && value !== key ? value : fallback.replace(/\{(\w+)\}/g, (_, name: string) => params[name] ?? '')
}

const short = (key: string): string => `${key.slice(0, 8)}…${key.slice(-4)}`

const npubOf = async (hex: string): Promise<string> => {
  try { return (await import('nostr-tools/nip19')).npubEncode(hex) } catch { return hex }
}

/** A device key as hex: 64 hex characters as they are, an npub decoded; null for anything else. */
export const deviceKeyOf = async (raw: string): Promise<string | null> => {
  const text = String(raw ?? '').trim()
  if (HEX64.test(text)) return text.toLowerCase()
  if (!/^npub1[0-9a-z]+$/.test(text)) return null
  try {
    const decoded = (await import('nostr-tools/nip19')).decode(text)
    return decoded.type === 'npub' && HEX64.test(String(decoded.data)) ? String(decoded.data).toLowerCase() : null
  } catch { return null }
}

export type PairWord =
  | { form: 'show' }
  | { form: 'add'; key: string | null; label: string }
  | { form: 'accept'; token: string }
  | { form: 'remove'; key: string | null }
  | { form: 'unknown'; word: string }

/** `pair`, `pair add <key> [name …]`, `pair accept <token>`, `pair remove <key>`. */
export const parsePairWord = async (args: string): Promise<PairWord> => {
  const words = String(args ?? '').trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return { form: 'show' }
  const [head, ...rest] = words
  switch (head!.toLowerCase()) {
    case 'add': return { form: 'add', key: rest[0] ? await deviceKeyOf(rest[0]) : null, label: rest.slice(1).join(' ').slice(0, 80) }
    case 'accept': return { form: 'accept', token: rest.join('') }
    case 'remove': return { form: 'remove', key: rest[0] ? await deviceKeyOf(rest[0]) : null }
    default: return { form: 'unknown', word: head! }
  }
}

const signer = (): SignerLike | undefined => {
  try { return get(NOSTR_SIGNER_KEY) as SignerLike | undefined } catch { return undefined }
}

const store = (): PairingStoreLike | undefined => get<PairingStoreLike>('@hypercomb.social/Store')

export class PairQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'sharing'
  readonly command = 'pair'
  override description = 'Pair your own devices — one vouches for the other, no key is ever copied'
  override descriptionKey = 'slash.pair'
  override options = ['add <key>', 'accept <token>', 'remove <key>']
  override examples = [
    { input: '/pair', result: 'This device\'s key, and whether it is paired' },
    { input: '/pair add npub1… laptop', result: 'Vouch for that device and copy the token to hand it' },
    { input: '/pair accept hcpair1.…', result: 'Take the master\'s word that this device belongs to it' },
    { input: '/pair remove npub1…', result: 'Take that device back out' },
  ]

  // A key or a token is the whole argument.
  override rawArgs = true

  protected async execute(args: string): Promise<void> {
    const word = await parsePairWord(args)
    switch (word.form) {
      case 'show': return this.#show()
      case 'add': return this.#add(word.key, word.label)
      case 'accept': return this.#accept(word.token)
      case 'remove': return this.#remove(word.key)
      default:
        this.#say(t('pair.usage', 'pair: say "pair", "pair add <key>", "pair accept <token>" or "pair remove <key>"'), 'warning')
    }
  }

  /** This device's key. Pairing is the act where a device needs an identity, so asking for it here may mint one. */
  async #self(): Promise<string | null> {
    try {
      const key = String((await signer()?.getPublicKeyHex?.()) ?? '').toLowerCase()
      return HEX64.test(key) ? key : null
    } catch { return null }
  }

  async #show(): Promise<void> {
    const self = await this.#self()
    if (!self) { this.#say(t('pair.nokey', 'This place has no signing key to pair.'), 'warning'); return }
    const state = await loadPairing(store())
    const key = await npubOf(self)
    let role: string
    if (!state.master) role = t('pair.unpaired', 'Not paired yet.')
    else if (state.master === self) {
      const devices = activeDevices(state)
      role = devices.length
        ? t('pair.master', 'You are the master of {count} device(s): {names}', { count: String(devices.length), names: devices.map(d => d.label || short(d.device)).join(', ') })
        : t('pair.master.none', 'You are the master; no device is paired yet.')
    } else role = t('pair.device', 'Paired to {master}.', { master: short(state.master) })
    this.#say(`${t('pair.key', 'This device: {key}', { key })} — ${role}`, 'info')
  }

  async #add(device: string | null, label: string): Promise<void> {
    if (!device) { this.#say(t('pair.add.nokey', 'Name the new device\'s key (64 hex characters or an npub): pair add <key> [name].'), 'warning'); return }
    const self = await this.#self()
    const s = signer()
    if (!self || !s) { this.#say(t('pair.nokey', 'This place has no signing key to pair.'), 'warning'); return }
    if (device === self) { this.#say(t('pair.add.self', 'That is this device\'s own key.'), 'warning'); return }
    const state = await loadPairing(store())
    if (state.master && state.master !== self) { this.#say(t('pair.add.notmaster', 'This device is paired to another master and cannot vouch for devices.'), 'warning'); return }
    const ok = await requestConfirm({
      title: t('pair.add.title', 'Pair this device?'),
      message: t('pair.add.message', '{device} will be able to sync your hive with this one. It keeps its own key — yours is not copied. You can take it out again with pair remove.', { device: label || short(device) }),
      confirmLabel: t('pair.add.yes', 'Pair it'),
      cancelLabel: t('pair.add.no', 'Not now'),
    }).catch(() => false)
    if (!ok) return
    const grant = await mintDelegation(s, device, { label })
    if (!grant) { this.#say(t('pair.signfailed', 'Your signer would not sign it.'), 'warning'); return }
    await this.#keep(recordMinted(state, self, grant))
    await this.#hand(encodeToken([grant]), t('pair.add.done', 'Paired {device}. Run pair accept with this token on it.', { device: label || short(device) }))
  }

  async #accept(token: string): Promise<void> {
    if (!decodeToken(token)) { this.#say(t('pair.accept.notoken', 'That is not a pairing token — it starts with hcpair1.'), 'warning'); return }
    const self = await this.#self()
    if (!self) { this.#say(t('pair.nokey', 'This place has no signing key to pair.'), 'warning'); return }
    const state = await loadPairing(store())
    // Judge it first, change nothing: the participant sees whose word this is before anything is kept.
    const taken = takeToken(state, token, self)
    if (!taken.ok) { this.#say(this.#refusal(taken.reason), 'warning'); return }
    if (taken.self === 'paired' && taken.state.master) {
      const ok = await requestConfirm({
        title: t('pair.accept.title', 'Pair this device?'),
        message: t('pair.accept.message', 'This device will sync your hive with the participant {master}. Only accept if that is your own key on your other device.', { master: await npubOf(taken.state.master) }),
        confirmLabel: t('pair.accept.yes', 'Pair it'),
        cancelLabel: t('pair.accept.no', 'Not now'),
      }).catch(() => false)
      if (!ok) return
    }
    if (!(await this.#keep(taken.state))) return
    if (taken.self === 'paired') this.#say(t('pair.accept.done', 'Paired to {master}. This device may now sync with it.', { master: short(taken.state.master!) }), 'success')
    else if (taken.self === 'revoked') this.#say(t('pair.accept.revoked', 'The master has taken this device out. It no longer syncs.'), 'info')
    else this.#say(t('pair.accept.noted', 'Noted {count} change(s) from your master.', { count: String(taken.noted) }), 'success')
  }

  async #remove(device: string | null): Promise<void> {
    if (!device) { this.#say(t('pair.remove.nokey', 'Name the device\'s key: pair remove <key>.'), 'warning'); return }
    const self = await this.#self()
    const s = signer()
    if (!self || !s) { this.#say(t('pair.nokey', 'This place has no signing key to pair.'), 'warning'); return }
    const state = await loadPairing(store())
    if (state.master !== self) { this.#say(t('pair.remove.notmaster', 'Only the master device can take a device out.'), 'warning'); return }
    if (!activeDevices(state).some(row => row.device === device)) { this.#say(t('pair.remove.unknown', 'That device is not paired.'), 'warning'); return }
    const ok = await requestConfirm({
      title: t('pair.remove.title', 'Take this device out?'),
      message: t('pair.remove.message', '{device} will no longer sync with your devices once they are told. What it already holds, it keeps.', { device: short(device) }),
      confirmLabel: t('pair.remove.yes', 'Take it out'),
      cancelLabel: t('pair.remove.no', 'Not now'),
    }).catch(() => false)
    if (!ok) return
    const revocation = await mintRevocation(s, device)
    if (!revocation) { this.#say(t('pair.signfailed', 'Your signer would not sign it.'), 'warning'); return }
    await this.#keep(recordMinted(state, self, revocation))
    await this.#hand(encodeToken([revocation]), t('pair.remove.done', '{device} is out. Run pair accept with this token on your other devices so they turn it away.', { device: short(device) }))
  }

  #refusal(reason: string): string {
    switch (reason) {
      case 'other master': return t('pair.r.other', 'This device is already paired to a different master.')
      case 'no key': return t('pair.nokey', 'This place has no signing key to pair.')
      case 'not a token': return t('pair.accept.notoken', 'That is not a pairing token — it starts with hcpair1.')
      default: return t('pair.r.nothing', 'Nothing in that token is for this device, or it is not good any more.')
    }
  }

  async #keep(state: PairingState): Promise<boolean> {
    const kept = await savePairing(store(), state)
    if (!kept) this.#say(t('pair.notkept', 'Could not keep the pairing on this device.'), 'warning')
    else EffectBus.emit(DEVICE_PAIRING_CHANGED, {})
    return kept
  }

  /** The token goes to the clipboard; if the browser refuses, it is in the activity log to copy by hand. */
  async #hand(token: string, message: string): Promise<void> {
    let copied = false
    try { await navigator.clipboard.writeText(token); copied = true } catch { /* the log carries it */ }
    EffectBus.emit('activity:log', { message: copied ? message : `${message} ${token}`, icon: '🔗' })
    EffectBus.emit('toast:show', { type: 'success', message: copied ? `${message} ${t('pair.copied', '(copied)')}` : message })
  }

  #say(message: string, type = 'info'): void {
    EffectBus.emit('activity:log', { message, icon: '🔗' })
    EffectBus.emit('toast:show', { type, message })
  }
}

const _pair = new PairQueenBee()
window.ioc.register('@diamondcoreprocessor.com/PairQueenBee', _pair)
