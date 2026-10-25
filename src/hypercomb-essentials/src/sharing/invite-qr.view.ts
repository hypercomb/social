// sharing/invite-qr.view.ts
//
// THE INVITE, AS A CODE TO POINT A PHONE AT (jwize 2026-10-25: "a link or QR from the desktop that adds the
// phone's own key"). `keys allow` shows it in a small window beside the link it copied: the phone's camera
// reads it, opens the link, and the phone asks once before adding its key. The code is the link and nothing
// more — the invite works once and ends when its ten minutes do, and so does this window.

import { qrSvg } from './qr-code.js'

const STYLE_ID = 'hc-invite-qr-styles'

let open: HTMLElement | null = null
let timer: ReturnType<typeof setTimeout> | undefined

export function closeInviteQr(): void {
  if (timer) clearTimeout(timer)
  timer = undefined
  open?.remove()
  open = null
}

/** Show `link` as a code until `until` (unix seconds), or until it is closed. False when it cannot be drawn. */
export function showInviteQr(link: string, until: number, title = 'Point the phone at this'): boolean {
  const svg = qrSvg(link, 'Invite to add a device')
  if (!svg || typeof document === 'undefined') return false
  closeInviteQr()
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style')
    style.id = STYLE_ID
    style.textContent = `
.hc-invite-qr{position:fixed;z-index:100001;right:1rem;bottom:1rem;width:min(17rem,calc(100vw - 2rem));padding:1rem;display:grid;gap:.6rem;
  justify-items:center;color:#eef4fa;background:rgba(7,10,15,.98);border:1px solid rgba(126,182,214,.38);border-radius:var(--hc-radius-floating,4px);
  box-shadow:0 1.5rem 5rem rgba(0,0,0,.55);font-family:var(--hc-sans,system-ui,sans-serif);font-size:.85rem}
.hc-invite-qr svg{width:100%;height:auto;border-radius:2px}
.hc-invite-qr button{justify-self:end;min-height:2rem;padding:.25rem .7rem;border-radius:var(--hc-radius-control,2px);border:1px solid rgba(255,255,255,.16);
  background:rgba(255,255,255,.05);color:inherit;cursor:pointer}
.hc-invite-qr small{color:#9babb6;text-align:center}`
    document.head.appendChild(style)
  }
  const box = document.createElement('div')
  box.className = 'hc-invite-qr'
  box.setAttribute('role', 'dialog')
  box.setAttribute('aria-label', title)
  const heading = document.createElement('strong')
  heading.textContent = title
  const art = document.createElement('div')
  art.style.width = '100%'
  art.innerHTML = svg
  const note = document.createElement('small')
  note.textContent = 'Works once, for ten minutes. The phone asks before it adds its key.'
  const close = document.createElement('button')
  close.type = 'button'
  close.textContent = 'Close'
  close.addEventListener('click', closeInviteQr)
  box.append(heading, art, note, close)
  document.body.appendChild(box)
  open = box
  const ms = Math.max(1_000, until * 1000 - Date.now())
  timer = setTimeout(closeInviteQr, ms)
  return true
}
