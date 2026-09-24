// sharing/adopt-branch-picker.ts
//
// THE QUESTION THE BRANCH DOOR ASKS, OWNED BY THE MODULE THAT ASKS IT.
//
// This began as two fields on core's `ConfirmRequest` and a list rendered by
// the shell's Angular confirm dialog. That worked, and it was wrong: a new
// core export makes every package that uses it require a newer SHELL, and the
// admission gate says so in as many words — "needs a newer shell — its core
// does not export requestChoice" (runtime/core-surface.ts). A picture, a
// swarm fix and a branch door replicate to any participant in minutes; a
// question that needs a shell deploy does not. So the question lives here, in
// framework-free DOM, and rides the same signed package as the door itself.
//
// It is deliberately small: a heading, a line, the participants as WORDS with
// the chosen one wearing the ink, an optional warning, and two words to end
// on. No bordered button rows, no icons, no second way to do anything.
// Escape and the backdrop mean the same as Cancel, because a question you
// cannot walk away from is a trap.

export type BranchOffer = {
  /** Stable identity — the publisher's pubkey. */
  id: string
  /** What this participant is called here. */
  label: string
  /** The size of THEIR branch, already worded. */
  detail?: string
}

export type BranchQuestion = {
  title: string
  message: string
  warning?: string
  /** Fewer than two and no list is drawn — the question is a plain yes/no. */
  offers?: readonly BranchOffer[]
  /** Which offer starts selected. Defaults to the first. */
  chosen?: string
  confirmLabel: string
  cancelLabel: string
  /** Paint the agreeing word as a warning rather than an ordinary act. */
  danger?: boolean
}

const STYLE_ID = 'hc-branch-picker-style'
// Above the canvas and the panels, beside the shell's own dialogs.
const CSS = `
.hc-bp-back{position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,.45);
  display:flex;align-items:center;justify-content:center;padding:1rem;}
.hc-bp{max-width:30rem;width:100%;max-height:80vh;overflow:auto;border-radius:4px;
  background:rgb(var(--hc-panel-pane,20,22,26));border:1px solid var(--hc-window-line,rgba(255,255,255,.12));
  box-shadow:0 12px 40px rgba(0,0,0,.5);font-family:var(--hc-sans,system-ui,sans-serif);}
.hc-bp-h{margin:0;padding:.7rem 1rem .4rem;font-size:.85rem;font-weight:600;
  color:var(--hc-window-ink-loud,#f2f4f7);}
.hc-bp-b{padding:0 1rem .5rem;}
.hc-bp-m{margin:0;font-size:.78rem;line-height:1.5;color:var(--hc-window-ink-quiet,#aab3bf);}
.hc-bp-w{margin:.55rem 0 0;padding:.4rem .6rem;border-radius:4px;font-size:.72rem;line-height:1.4;
  color:var(--hc-status-alert,#e8a33d);
  background:color-mix(in srgb,var(--hc-status-alert,#e8a33d) 8%,transparent);
  border:1px solid color-mix(in srgb,var(--hc-status-alert,#e8a33d) 15%,transparent);}
.hc-bp-l{list-style:none;margin:.6rem 0 0;padding:0;display:flex;flex-direction:column;gap:.1rem;}
.hc-bp-o{display:flex;align-items:baseline;gap:.5rem;width:100%;background:none;border:none;
  border-radius:3px;padding:.32rem .45rem;cursor:pointer;text-align:left;font:inherit;font-size:.76rem;
  color:var(--hc-window-ink-quiet,#aab3bf);transition:color 150ms ease,background 150ms ease;}
.hc-bp-o:hover{color:var(--hc-window-ink-loud,#f2f4f7);background:var(--hc-window-tint,rgba(255,255,255,.05));}
.hc-bp-o[aria-pressed="true"]{color:var(--hc-window-ink-loud,#f2f4f7);
  background:var(--hc-window-tint-strong,rgba(255,255,255,.1));}
.hc-bp-o[aria-pressed="true"] .hc-bp-n::before{content:'';display:inline-block;width:.45em;height:.45em;
  margin-right:.45em;border-radius:50%;background:currentColor;vertical-align:middle;}
.hc-bp-d{margin-left:auto;font-size:.7rem;color:var(--hc-window-ink-quiet,#aab3bf);white-space:nowrap;}
.hc-bp-a{display:flex;justify-content:flex-end;gap:.75rem;padding:.55rem 1rem .8rem;
  border-top:1px solid var(--hc-window-line,rgba(255,255,255,.12));}
.hc-bp-x{background:none;border:none;cursor:pointer;font-family:var(--hc-mono,ui-monospace,monospace);
  font-size:.68rem;font-weight:600;letter-spacing:.08em;text-transform:uppercase;padding:.35rem .2rem;
  color:var(--hc-window-ink-quiet,#aab3bf);transition:color 150ms ease;}
.hc-bp-x:hover{color:var(--hc-window-ink-loud,#f2f4f7);}
.hc-bp-x.go{color:var(--hc-window-ink-loud,#f2f4f7);}
.hc-bp-x.danger{color:var(--hc-status-alert,#e8a33d);}
`

const ensureStyle = (): void => {
  if (document.getElementById(STYLE_ID)) return
  const el = document.createElement('style')
  el.id = STYLE_ID
  el.textContent = CSS
  document.head.appendChild(el)
}

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K, cls?: string, text?: string,
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  // textContent throughout: a participant's chosen name is THEIR text, and it
  // is never parsed as markup here.
  if (text !== undefined) node.textContent = text
  return node
}

/**
 * Ask, and learn which. Resolves `{ confirmed, choice }` — `choice` is the
 * offer standing when the participant agreed, absent on cancel and when
 * fewer than two offers were given.
 *
 * One at a time: a second call while a question is open answers it as a
 * cancel first, so two presses can never stack two overlays.
 */
let open: (() => void) | null = null

export const askWhichBranch = (
  q: BranchQuestion,
): Promise<{ confirmed: boolean; choice?: string }> => {
  open?.()
  ensureStyle()

  const offers = (q.offers?.length ?? 0) > 1 ? q.offers! : []
  let chosen = q.chosen ?? offers[0]?.id

  const back = el('div', 'hc-bp-back')
  const panel = el('div', 'hc-bp')
  panel.setAttribute('role', 'alertdialog')
  panel.setAttribute('aria-label', q.title)
  panel.append(el('h3', 'hc-bp-h', q.title))

  const body = el('div', 'hc-bp-b')
  body.append(el('p', 'hc-bp-m', q.message))

  if (offers.length) {
    const list = el('ul', 'hc-bp-l')
    for (const offer of offers) {
      const row = el('li')
      const button = el('button', 'hc-bp-o')
      button.type = 'button'
      button.setAttribute('aria-pressed', String(offer.id === chosen))
      button.append(el('span', 'hc-bp-n', offer.label))
      if (offer.detail) button.append(el('span', 'hc-bp-d', offer.detail))
      button.addEventListener('click', () => {
        chosen = offer.id
        for (const other of list.querySelectorAll<HTMLButtonElement>('.hc-bp-o')) {
          other.setAttribute('aria-pressed', String(other === button))
        }
      })
      row.append(button)
      list.append(row)
    }
    body.append(list)
  }

  if (q.warning) body.append(el('p', 'hc-bp-w', q.warning))
  panel.append(body)

  const actions = el('div', 'hc-bp-a')
  const cancel = el('button', 'hc-bp-x', q.cancelLabel)
  cancel.type = 'button'
  const go = el('button', `hc-bp-x go${q.danger ? ' danger' : ''}`, q.confirmLabel)
  go.type = 'button'
  actions.append(cancel, go)
  panel.append(actions)
  back.append(panel)

  return new Promise(resolve => {
    let settled = false
    const done = (confirmed: boolean): void => {
      if (settled) return
      settled = true
      open = null
      document.removeEventListener('keydown', onKey, true)
      back.remove()
      resolve({ confirmed, choice: confirmed && offers.length ? chosen : undefined })
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      // The hive's own escape cascade must not also act on this press.
      e.stopPropagation()
      e.preventDefault()
      done(false)
    }
    open = () => done(false)

    cancel.addEventListener('click', () => done(false))
    go.addEventListener('click', () => done(true))
    back.addEventListener('click', e => { if (e.target === back) done(false) })
    document.addEventListener('keydown', onKey, true)

    document.body.appendChild(back)
    go.focus()
  })
}
