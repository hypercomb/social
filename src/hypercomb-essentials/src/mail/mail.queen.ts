// mail/mail.queen.ts
//
// `mail` — OPEN THE MAIL WINDOW.
//
// The word opens the window and does nothing else. It reads nothing, sends
// nothing and takes no argument that names an address or a message: an act that
// speaks as the participant to someone else is a press on Send in a draft the
// participant can read, never a word typed at a prompt. (offers.queen.ts is the
// pattern.)
//
// ── NO ALIAS ────────────────────────────────────────────────────────────────
//
// Aliases are the participant's to give.

import { EffectBus, QueenBee } from '@hypercomb/core'
import { registerPublishedPool } from '../sharing/published-pools.js'

// THE WINDOW ARRIVES WITH ITS OPEN, not at boot (atomic-modules-plan.md, "adopt
// the proper load"). Its surface registers by TAG at boot — the shell's host
// makes it with createElement — and the element is defined from one cached
// import() when the window is first asked for. The words, the tag and the key
// are spelled here because importing even a const from the view would keep it
// on the boot path.
const MAIL_OPEN = 'mail:open'
const MAIL_SURFACE = 'hc-mail'
const MAIL_VIEW_KEY = '@diamondcoreprocessor.com/MailView'

let view: Promise<void> | null = null
const loadView = (): Promise<void> => view ??= import('./mail.view.js').then(({ MailElement }) => {
  if (!customElements.get(MAIL_SURFACE)) customElements.define(MAIL_SURFACE, MailElement)
}).catch(error => { view = null; throw error })

export class MailQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'mail'
  override description = 'Open your mail: read what arrived, see what you sent, and write'
  override examples = [
    { input: '/mail', result: 'Opens the mail window — nothing is sent until you press Send' },
  ]

  override slashComplete(_args: string): readonly string[] {
    return []
  }

  protected async execute(_args: string): Promise<void> {
    // THE STAMP FOLLOWS THE LOAD. The window takes an open request only while it
    // is fresh, so it is stamped once the view is here — a slow first load can
    // never outlive it.
    try { await loadView() } catch (error) {
      EffectBus.emit('activity:log', { message: `Could not load the mail window: ${error instanceof Error ? error.message : String(error)}` })
      return
    }
    EffectBus.emit(MAIL_OPEN, { at: Date.now() })
  }
}

// THE BEE WIRES (atomic-modules-plan.md): the view is a dependency; this bee adds
// its tag to the shell's surface registry — never a tag in either app.html.
window.ioc.whenReady('@hypercomb.social/ShellSurfaceRegistry', (registry: { add(s: unknown): void }) => {
  try {
    registry.add({ name: MAIL_SURFACE, owner: MAIL_VIEW_KEY, element: MAIL_SURFACE, order: 145 })
  } catch {
    // duplicate add (hot reload) — the mounted surface is already live
  }
})

// MAIL TEMPLATES A HOST OFFERS (documentation/mail-templates.md, "How a template
// travels"). The queen claims the pool, not a dependency: a claim makes every
// learned host answer for `sign('mail:template')` once a session, and that is
// this word's to ask. An offer is only HELD by the probe; a press in /offers
// is what calls `accept`, and only then is the template kept, BY ITS OWN BYTES
// (another spelling would be another signature). Without the verified bytes it
// is refused: `record` is JSON.parse's reading, which has already hidden a
// repeated key. The module that keeps it arrives with the press, so the boot
// path carries none of it.
const MAIL_TEMPLATE_POOL = 'mail:template'
registerPublishedPool({
  meaning: MAIL_TEMPLATE_POOL,
  accept: async (_record, _origin, verified) => {
    if (!verified) return null
    const { keepTemplate, templateStore } = await import('./template-pool.js')
    const kept = await keepTemplate(templateStore(), verified.bytes, verified.sig)
    if (!kept.ok) throw new Error(kept.reason)
    return kept.sig
  },
})

const _mail = new MailQueenBee()
;(window as unknown as { ioc?: { register?: (k: string, v: unknown) => void } })
  .ioc?.register?.('@diamondcoreprocessor.com/MailQueenBee', _mail)
