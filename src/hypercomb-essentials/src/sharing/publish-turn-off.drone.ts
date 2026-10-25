// sharing/publish-turn-off.drone.ts
//
// TURN A PUBLISH OFF, HANDED HERE FROM A FRONT DOOR (jwize 2026-10-24: "if
// it is my domain I should be able to unpublish directly from hypercomb.com
// because I have the ownership key"; turning off is reversible, unpublishing
// stays its own act).
//
// The shell stashed the `#turn-off=` fragment and woke this bee
// ('publish:turn-off'). It takes the stash once and acts only when this hive
// holds the key that signed the row — it asks for the key it HAS
// (knownPublicKeyHex) and never mints one for somebody else's link. It reads
// what the turn-off would write, asks with that exact result in front of the
// participant, signs on their click (setHiveDoors, in the publish lane), moves
// the branch's host marks with it — or the branch's next publish would open
// the domain again — and goes back to the front door it came from. A hand-off
// another tab passed on here (relayed) stays: this tab is the participant's
// hive, not a page to leave.

import { Drone, EffectBus, I18N_IOC_KEY, requestConfirm, type I18nProvider } from '@hypercomb/core'
import { PENDING_TURN_OFF_KEY, decodeTurnOff, serves, type TurnOffRequest } from './publish-turn-off.js'
import { setHiveDoors, type TurnOffResult } from './publish-branch.js'

const NOSTR_SIGNER_KEY = '@diamondcoreprocessor.com/NostrSigner'

interface SignerLike { knownPublicKeyHex?: () => Promise<string | null> }

const ioc = () => (window as { ioc?: { get?: <T>(k: string) => T | undefined } }).ioc

const fill = (text: string, params?: Record<string, string | number>): string =>
  text.replace(/\{(\w+)\}/g, (whole, name: string) => (params && name in params ? String(params[name]) : whole))

/** The catalog's words, else the English fallback (`t()` answers a missing
 *  key with the key itself). */
const tr = (key: string, fallback: string, params?: Record<string, string | number>): string => {
  const s = ioc()?.get?.<I18nProvider>(I18N_IOC_KEY)?.t(key, params)
  return s && s !== key ? s : fill(fallback, params)
}

const toast = (type: 'tip' | 'warning', message: string): void => { EffectBus.emit('toast:show', { type, message }) }

/** One sentence for a refusal, naming what the participant can do. */
const refusal = (request: TurnOffRequest, result: Extract<TurnOffResult, { ok: false }>): string => {
  const title = { title: request.title }
  switch (result.failure) {
    case 'not-yours':
    case 'no-signer':
      return tr('turn-off.not-yours', 'This hive does not hold the key that published "{title}" — open the hive that published it.', title)
    case 'moved':
      return tr('turn-off.moved', '"{title}" was published again after that page was read — open it again and choose once more.', title)
    case 'no-branch':
      return tr('turn-off.not-published', '"{title}" is no longer published — there is nothing to turn off.', title)
    case 'opens-everywhere':
      return tr('turn-off.opens-everywhere', '"{title}" opens on every domain — choose its domains in Publish, or turn it off everywhere.', title)
    case 'no-host':
      return tr('turn-off.no-host', 'This hive has no publishing host of its own to write through — set one in Publish first.')
    case 'index-unsafe':
      return tr('turn-off.index-unsafe', 'Your published index could not be read safely, so nothing was written. Try again in a moment.')
    default:
      return tr('turn-off.failed', 'The turn-off could not be written ({reason}). Nothing changed.', { reason: result.reason ?? result.failure })
  }
}

export class PublishTurnOffDrone extends Drone {
  /** THE EFFECT THAT WAKES THIS BEE: the shell's capture of a hand-off. The
   *  bus replays it to the bee when it loads (scripts/passive-queen.ts). */
  readonly wakesOn: readonly string[] = ['publish:turn-off']

  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'sharing'

  public override description =
    'Turns a publish off on one domain or on every domain when a front door hands the row here — only with this hive\'s own key, only on a click, and reversibly.'

  protected override listens: string[] = ['publish:turn-off']
  protected override emits: string[] = ['toast:show', 'confirm:request']

  #initialized = false
  #busy = false

  protected override sense = () => true
  protected override heartbeat = async (): Promise<void> => {
    if (this.#initialized) return
    this.#initialized = true
    this.onEffect('publish:turn-off', () => { void this.#take() })
  }

  /** Take the stash ONCE — a replayed effect finds it gone. */
  async #take(): Promise<void> {
    if (this.#busy) return
    let stash: { hash?: unknown; relayed?: unknown } | null = null
    try {
      const raw = sessionStorage.getItem(PENDING_TURN_OFF_KEY)
      if (!raw) return
      sessionStorage.removeItem(PENDING_TURN_OFF_KEY)
      stash = JSON.parse(raw) as { hash?: unknown; relayed?: unknown }
    } catch { return }
    const request = decodeTurnOff(stash?.hash)
    if (!request) {
      toast('warning', tr('turn-off.malformed', 'That turn-off link is not one this hive can read — nothing was changed.'))
      return
    }
    this.#busy = true
    try { await this.#run(request, stash?.relayed === true) } finally { this.#busy = false }
    // A second hand-off that landed while this one was asked waits in the stash.
    void this.#take()
  }

  async #run(handed: TurnOffRequest, relayed: boolean): Promise<void> {
    // The link's title is the sender's words; what gets written is the index
    // key. The question names the key, so a friendly title cannot pass for it.
    const title = handed.title === handed.lineage ? handed.lineage : `${handed.title} (${handed.lineage})`
    const request: TurnOffRequest = { ...handed, title }
    // A refusal stays here: the link names the way back, and a link anyone can
    // make must not send the hive on. Only a written turn-off goes back, and
    // only to a domain the verified index truly opened it on.
    let backTo = ''
    const back = (): void => { if (!relayed && backTo) window.setTimeout(() => location.replace(backTo), 1600) }
    // The key this hive HAS. An extension answers only when asked (and may
    // prompt), so with one the key is checked where the write asks for it.
    const held = (await ioc()?.get?.<SignerLike>(NOSTR_SIGNER_KEY)?.knownPublicKeyHex?.()) ?? null
    const extension = !!(window as { nostr?: { getPublicKey?: unknown } }).nostr?.getPublicKey
    if (!extension && held !== request.publisher) {
      toast('warning', refusal(request, { ok: false, failure: 'not-yours' }))
      return
    }
    const options = { pubkey: request.publisher, expectHead: request.head }
    const preview = await setHiveDoors(request.zone, request.lineage, request.scope, { ...options, dryRun: true })
    if (!preview.ok) { toast('warning', refusal(request, preview)); return }
    if (preview.unchanged) {
      toast('tip', tr('turn-off.already', '"{title}" is already off there — nothing to change.', { title: request.title }))
      return
    }

    const stays = preview.doors.join(', ')
    const yes = await requestConfirm({
      title: tr('turn-off.title', 'Turn off "{title}"?', { title: request.title }),
      message: request.scope === 'everywhere'
        ? tr('turn-off.message-everywhere', '"{title}" stops opening on every domain. It stays published: you can turn a domain back on from Publish without publishing again.', { title: request.title })
        : stays
          ? tr('turn-off.message-here', '"{title}" stops opening on {zone}. It stays published and keeps opening on {stays}.', { title: request.title, zone: request.zone, stays })
          : tr('turn-off.message-here-last', '"{title}" stops opening on {zone}, the last domain it opens on. It stays published: you can turn a domain back on from Publish.', { title: request.title, zone: request.zone }),
      confirmLabel: request.scope === 'everywhere'
        ? tr('turn-off.confirm-everywhere', 'Turn off everywhere')
        : tr('turn-off.confirm-here', 'Turn off on {zone}', { zone: request.zone }),
      cancelLabel: tr('turn-off.cancel', 'Keep it on'),
      // Reversible, so not drawn as a deletion.
      danger: false,
    })
    if (!yes) { toast('tip', tr('turn-off.kept', 'Nothing was changed.')); return }

    const done = await setHiveDoors(request.zone, request.lineage, request.scope, options)
    if (!done.ok) { toast('warning', refusal(request, done)); return }
    if (done.ok && done.was.some(entry => serves(entry, request.zone))) backTo = request.back
    toast('tip', request.scope === 'everywhere'
      ? tr('turn-off.done-everywhere', '"{title}" is off on every domain. It stays published.', { title: request.title })
      : tr('turn-off.done-here', '"{title}" is off on {zone}.', { title: request.title, zone: request.zone }))
    back()
  }
}

const _turnOff = new PublishTurnOffDrone()
window.ioc.register('@diamondcoreprocessor.com/PublishTurnOffDrone', _turnOff)
