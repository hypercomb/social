// hypercomb-shim/src/bootstrap/managed-key.ts
//
// THE MANAGED PAGE'S OWN KEY (jwize 2026-11-13: the page publishes "with ITS
// OWN listed key via the existing key-list invite"). A managed site door
// (manage-record.ts) publishes for its site's publisher only once this browser
// holds a key the publisher's list names (managed-publish.ts). Until then the
// page says how, once, small, in a corner — the card fills the screen and this
// stays out of its way:
//
//   - no key on the list here: the one line the owner runs on their hive,
//     `keys allow <this site>`, copied with one press, and that the link it
//     gives is opened here;
//   - the link opened (an invite held, device-invite.ts): the same Allow the
//     front door shows — this browser makes its own key, the invite's
//     throwaway key adds it to the list, and the anchor is bound here. No
//     secret moves; `keys off` on the hive takes this browser off again;
//   - on the list: nothing at all.
//
// Framework-free: it runs before any bee. The host card it sits beside speaks
// English (host-panel.ts), and so does this.

import { allowInvite, captureDeviceInvite, dropInvite, heldInvite, readKeyChain } from './device-invite'
import { readDeviceBinding, type DeviceBinding } from './device-binding'
import { deviceSigner, type DeviceSigner } from './device-key'
import { copyText, offerCopy } from './copy-text'
import type { ManageRecord } from './manage-record'
import type { InviteParts } from '@hypercomb/core'

export type ManagedKeyState =
  /** This browser's key is on the publisher's list: the page can publish. */
  | { readonly state: 'listed' }
  /** The page was opened with an invite: Allow spends it. */
  | { readonly state: 'invited'; readonly invite: InviteParts }
  /** No key of this browser's on the publisher's list. */
  | { readonly state: 'unlisted' }
  /** Nothing to say: no publisher, or no host could be asked. */
  | { readonly state: 'quiet' }

export type ManagedKeyDeps = {
  readonly signer?: () => DeviceSigner | null
  readonly binding?: () => Promise<DeviceBinding | null>
  readonly invite?: () => InviteParts | null
  readonly siteDoor?: () => string
}

/** Is this browser's key on the publisher's list? Read where the page writes, where it reads, and where
 *  the binding found it: any one naming the key is enough, since a publish carries the list to the
 *  write host first (device-owner.ts carryChain). Null when not one host could be asked. */
const listed = async (record: ManageRecord, publisher: string, siteDoor: string, deps: ManagedKeyDeps): Promise<boolean | null> => {
  const signer = (deps.signer ?? (() => deviceSigner(false)))()
  if (!signer) return false
  const binding = await (deps.binding ?? readDeviceBinding)().catch(() => null)
  if (binding?.anchor !== publisher) return false
  const hosts = [...new Set([record.writes, siteDoor, ...binding.sources].filter((host): host is string => !!host))]
  let answered = false
  for (const host of hosts) {
    const chain = await readKeyChain(host, publisher)
    if (chain === null) continue
    answered = true
    if (chain !== 'none' && chain.keys.includes(signer.pubkey)) return true
  }
  return answered ? false : null
}

/** Where this page stands with the publisher's key list. The invite card is drawn only while this
 *  browser is not on the list; once it is, nothing is drawn. */
export const managedKeyState = async (record: ManageRecord, deps: ManagedKeyDeps = {}): Promise<ManagedKeyState> => {
  const publisher = record.publisher
  if (!publisher) return { state: 'quiet' }
  const siteDoor = (deps.siteDoor ?? (() => location.host.toLowerCase()))()
  const on = await listed(record, publisher, siteDoor, deps)
  if (on) return { state: 'listed' }
  const invite = (deps.invite ?? heldInvite)()
  // Only an invite to THIS site's publisher's list is offered: a link from
  // anywhere else (another key's invite) would bind this page to a stranger.
  if (invite && String((invite as { anchor?: unknown }).anchor ?? '').toLowerCase() === publisher.toLowerCase()) return { state: 'invited', invite }
  // Not one host could be asked: say nothing rather than send the owner to do what may be done already.
  return on === null ? { state: 'quiet' } : { state: 'unlisted' }
}

const TAG = 'hc-managed-key'
let closed = false

const STYLE = `
:host { all: initial }
.key {
  box-sizing: border-box; position: fixed; left: 1rem; bottom: 1rem; z-index: 2147483101;
  max-width: min(24rem, calc(100vw - 2rem)); padding: .7rem .85rem; border: 1px solid #3a3f47; border-radius: 6px;
  background: rgba(16, 19, 24, .94); color: #e8e8ea; font: 13px/1.45 system-ui, sans-serif; box-shadow: 0 6px 24px rgba(0, 0, 0, .35);
}
.key p { margin: 0; }
.key p + p { margin-top: .35rem; }
.key code { padding: .05rem .3rem; border-radius: 3px; background: #0b0d10; color: #f3d9b1; font: 12px/1.4 ui-monospace, monospace; user-select: all; }
.key .row { display: flex; gap: .4rem; margin-top: .55rem; }
.key button { padding: .25rem .75rem; border-radius: 999px; border: 1px solid #3a3f47; background: #1a1e24; color: #e8e8ea; font: inherit; cursor: pointer; }
.key button.primary { border-color: transparent; background: #c8975a; color: #14110c; font-weight: 600; }
.key button:disabled { opacity: .55; cursor: default; }
.key .close { position: absolute; top: .2rem; right: .3rem; padding: 0 .35rem; border: 0; background: transparent; color: #8b9098; font-size: 1rem; }
.key .note { color: #b9bcc2; }
.key .note:empty { display: none; }
`

/** The corner card, for one state. Null when there is nothing to say. */
export const managedKeyCard = (
  state: ManagedKeyState,
  siteDoor: string,
  done: () => void,
  copyWith: (text: string) => Promise<boolean> = copyText,
): HTMLElement | null => {
  if (state.state === 'listed' || state.state === 'quiet') return null
  const card = document.createElement('section')
  card.className = 'key'
  card.setAttribute('role', 'region')
  card.setAttribute('aria-label', 'This browser\'s key')
  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'close'
  close.setAttribute('aria-label', 'Close')
  close.textContent = '×'
  const note = document.createElement('p')
  note.className = 'note'
  note.setAttribute('role', 'status')
  if (state.state === 'unlisted') {
    close.addEventListener('click', done)
    const words = document.createElement('p')
    words.textContent = 'To publish from this page, give this browser its own key. On your hive, run '
    const command = document.createElement('code')
    command.textContent = `keys allow ${siteDoor}`
    words.append(command, document.createTextNode(', then open the link it gives you here.'))
    // ONE PRESS COPIES THE LINE (jwize 2026-11-14). The hive that makes the
    // link lives at another address, so this page cannot ask it; what it can
    // do is put the line on the clipboard, ready to paste on the hive.
    const row = document.createElement('div')
    row.className = 'row'
    const copy = document.createElement('button')
    copy.type = 'button'
    copy.className = 'primary'
    offerCopy(copy, command.textContent ?? '', { idle: 'Copy the line', done: 'Copied' }, copied => {
      note.textContent = copied
        ? 'Copied. Paste it on your hive\'s command line. The hive copies the link it makes: open that here.'
        : 'This browser would not copy it. Select the line above instead.'
    }, copyWith)
    row.append(copy)
    card.append(close, words, row, note)
    return card
  }
  const invite = state.invite
  close.addEventListener('click', () => { dropInvite(); done() })
  const words = document.createElement('p')
  words.textContent = `This browser is invited to publish for ${invite.anchor.slice(0, 8)}… on ${invite.host}. `
    + 'Allow makes a key for this browser and adds it to that list. The key never leaves this browser.'
  const row = document.createElement('div')
  row.className = 'row'
  const allow = document.createElement('button')
  allow.type = 'button'
  allow.className = 'primary'
  allow.textContent = 'Allow'
  const later = document.createElement('button')
  later.type = 'button'
  later.textContent = 'Not now'
  later.addEventListener('click', () => { dropInvite(); done() })
  allow.addEventListener('click', () => {
    allow.disabled = true
    later.disabled = true
    note.textContent = 'Adding this browser to the list…'
    void allowInvite(invite, siteDoor).then(result => {
      if (!result.ok) { note.textContent = result.reason; allow.disabled = false; later.disabled = false; return }
      note.textContent = 'This browser publishes for you now.'
      row.remove()
      window.dispatchEvent(new CustomEvent('hypercomb:managed-key', { detail: { state: 'listed', anchor: result.anchor } }))
      setTimeout(done, 2500)
    })
  })
  row.append(allow, later)
  card.append(close, words, row, note)
  return card
}

class ManagedKeyElement extends HTMLElement {
  readonly #root = this.attachShadow({ mode: 'open' })
  show(card: HTMLElement): void {
    const style = document.createElement('style')
    style.textContent = STYLE
    this.#root.replaceChildren(style, card)
  }
}

/** Put the corner card up on a managed page when this browser's key is not on the list yet. Its own
 *  element on the page, not the host card's: that one goes when the package's surfaces take over. */
export const showManagedKey = async (record: ManageRecord, deps: ManagedKeyDeps = {}): Promise<void> => {
  // An invite in the address is held (and taken out of it) before anything is asked.
  try { captureDeviceInvite(location, history) } catch { /* nothing held */ }
  if (closed || document.querySelector(TAG)) return
  const state = await managedKeyState(record, deps)
  const siteDoor = (deps.siteDoor ?? (() => location.host.toLowerCase()))()
  if (!customElements.get(TAG)) customElements.define(TAG, ManagedKeyElement)
  if (closed || document.querySelector(TAG)) return
  const element = document.createElement(TAG) as ManagedKeyElement
  // Closed (or done) is closed for this page: a redraw of the host card does not bring it back.
  const card = managedKeyCard(state, siteDoor, () => { closed = true; element.remove() })
  if (!card) return
  element.show(card)
  document.body.append(element)
}
