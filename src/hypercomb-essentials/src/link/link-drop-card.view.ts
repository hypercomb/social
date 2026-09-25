// link/link-drop-card.view.ts
//
// The open-graph card a dropped link carries, shown for confirmation before
// anything is written. Framework-free custom DOM (same pattern as the YouTube
// metadata queue's overlay) so it belongs to the module, not the shell.
//
// A drop used to be invisible: the read happened, the write happened, and the
// participant had to go looking for evidence. Now the card is put in front of
// them — the picture, the title, the address, and where it is about to land —
// and nothing is written until they say so.

const STYLE_ID = 'hc-link-card-styles'
const OVERLAY_CLASS = 'hc-link-card'

export type LinkDropCard = {
  url: string
  title: string | null
  imageUrl: string | null
  /** `verify` only reports what was read and never gates the drop. */
  mode?: 'verify' | 'confirm'
  /** Where this drop is about to land. */
  destination:
    | { kind: 'create' }
    | { kind: 'tile'; label: string; priorLink?: string | null }
}

const ensureStyles = (): void => {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = `
.${OVERLAY_CLASS}{position:fixed;inset:0;z-index:2147482300;display:grid;place-items:center;padding:24px;background:rgba(5,9,13,.82);backdrop-filter:blur(14px);font-family:Inter,system-ui,sans-serif;color:#eaf5fb}
.${OVERLAY_CLASS}-panel{width:min(520px,100%);border:1px solid rgba(126,182,214,.4);background:#0d151bee;box-shadow:0 24px 80px #000b}
.${OVERLAY_CLASS} figure{margin:0;background:#081116}
.${OVERLAY_CLASS} figure img{display:block;width:100%;height:220px;object-fit:cover}
.${OVERLAY_CLASS} .none{display:grid;place-items:center;height:96px;color:#6d8896;font-size:12px;letter-spacing:.14em}
.${OVERLAY_CLASS} .body{padding:18px 20px 4px}
.${OVERLAY_CLASS} .eyebrow{display:block;color:#7eb6d6;font-size:10px;letter-spacing:.18em;margin-bottom:6px}
.${OVERLAY_CLASS} h1{margin:0;font:500 20px/1.25 Georgia,serif;overflow-wrap:anywhere}
.${OVERLAY_CLASS} h1.untitled{color:#8aa3b0;font-style:italic}
.${OVERLAY_CLASS} dl{margin:14px 0 0;display:grid;grid-template-columns:auto 1fr;gap:4px 12px;font-size:12px}
.${OVERLAY_CLASS} dt{color:#7d94a1;letter-spacing:.08em}
.${OVERLAY_CLASS} dd{margin:0;overflow-wrap:anywhere;color:#cfe4ef}
.${OVERLAY_CLASS} dd.replacing{color:#e6b96b}
.${OVERLAY_CLASS} footer{display:flex;justify-content:flex-end;gap:10px;padding:16px 20px 18px}
.${OVERLAY_CLASS} button{padding:9px 16px;border:1px solid #456878;background:#15252e;color:#d8eaf3;cursor:pointer;font-size:13px}
.${OVERLAY_CLASS} button.primary{background:#7eb6d6;color:#071017;border-color:#7eb6d6}
.${OVERLAY_CLASS} button:hover{border-color:#7eb6d6}
@media(max-width:620px){.${OVERLAY_CLASS}{padding:0}.${OVERLAY_CLASS}-panel{min-height:100vh;width:100%}}
`
  document.head.appendChild(style)
}

/**
 * Put the card in front of the participant. Resolves true to go ahead, false
 * to drop the whole gesture. Escape and the backdrop both cancel.
 */
export function confirmLinkDropCard(card: LinkDropCard): Promise<boolean> {
  ensureStyles()

  return new Promise<boolean>(resolve => {
    const overlay = document.createElement('div')
    overlay.className = OVERLAY_CLASS

    let settled = false
    const close = (answer: boolean): void => {
      if (settled) return
      settled = true
      document.removeEventListener('keydown', onKey, true)
      overlay.remove()
      resolve(answer)
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') { event.stopPropagation(); close(false) }
      if (event.key === 'Enter') { event.stopPropagation(); close(true) }
    }

    const panel = document.createElement('section')
    panel.className = `${OVERLAY_CLASS}-panel`

    const figure = document.createElement('figure')
    if (card.imageUrl) {
      const img = document.createElement('img')
      img.src = card.imageUrl
      img.alt = ''
      // A picture that fails to load must not leave a broken frame standing in
      // for "this is what you are getting".
      img.addEventListener('error', () => {
        figure.innerHTML = ''
        const none = document.createElement('div')
        none.className = 'none'
        none.textContent = 'NO PICTURE COULD BE READ'
        figure.appendChild(none)
      })
      figure.appendChild(img)
    } else {
      const none = document.createElement('div')
      none.className = 'none'
      none.textContent = 'NO PICTURE COULD BE READ'
      figure.appendChild(none)
    }

    const body = document.createElement('div')
    body.className = 'body'
    const eyebrow = document.createElement('span')
    eyebrow.className = 'eyebrow'
    eyebrow.textContent = card.mode === 'verify' ? 'OPEN GRAPH — READ FROM THE DROP' : 'OPEN GRAPH'
    const heading = document.createElement('h1')
    if (card.title) {
      heading.textContent = card.title
    } else {
      heading.className = 'untitled'
      heading.textContent = 'no title could be read'
    }

    const list = document.createElement('dl')
    const row = (term: string, value: string, cls?: string): void => {
      const dt = document.createElement('dt')
      dt.textContent = term
      const dd = document.createElement('dd')
      dd.textContent = value
      if (cls) dd.className = cls
      list.append(dt, dd)
    }
    row('LINK', card.url)
    if (card.destination.kind === 'create') {
      row('LANDS AS', 'a new tile, at the top')
    } else {
      row('LANDS ON', card.destination.label)
      if (card.destination.priorLink) row('REPLACES', card.destination.priorLink, 'replacing')
    }

    body.append(eyebrow, heading, list)

    const footer = document.createElement('footer')
    const accept = document.createElement('button')
    accept.type = 'button'
    accept.className = 'primary'
    accept.dataset['role'] = 'accept'
    if (card.mode === 'verify') {
      // Reporting, not asking: the drop is already on its way.
      accept.textContent = 'OK'
      accept.addEventListener('click', () => close(true))
      footer.append(accept)
    } else {
      const cancel = document.createElement('button')
      cancel.type = 'button'
      cancel.textContent = 'Cancel'
      cancel.addEventListener('click', () => close(false))
      accept.textContent = card.destination.kind === 'create'
        ? 'Create the tile'
        : card.destination.priorLink ? 'Replace the link' : 'Add the link'
      accept.addEventListener('click', () => close(true))
      footer.append(cancel, accept)
    }

    panel.append(figure, body, footer)
    overlay.appendChild(panel)
    overlay.addEventListener('click', (event) => { if (event.target === overlay) close(false) })

    document.body.appendChild(overlay)
    document.addEventListener('keydown', onKey, true)
    accept.focus()
  })
}

/** Storage key for the verification popup — a test aid, not part of the flow. */
export const LINK_CARD_VERIFY_KEY = 'hc:link-drop:verify-card'

/** Is the verification popup switched on? Defaults ON while we are proving the
 *  drop path end to end; `localStorage['hc:link-drop:verify-card'] = 'off'`
 *  silences it without a rebuild. */
export const linkCardVerifyEnabled = (): boolean => {
  try { return localStorage.getItem(LINK_CARD_VERIFY_KEY) !== 'off' } catch { return true }
}

/**
 * Show what the drop actually read — picture, title, address, destination —
 * without standing in the way of it. Fire and forget.
 */
export function verifyLinkDropCard(card: Omit<LinkDropCard, 'mode'>): void {
  if (!linkCardVerifyEnabled()) return
  void confirmLinkDropCard({ ...card, mode: 'verify' })
}
