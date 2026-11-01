// comfy-desk/machine/machine.ts
//
// THE MACHINE AND ITS FOLDER. Whether ComfyUI answers and at what address, and
// its own directory, linked once. The two failures that matter (a missing CORS
// flag, an https page reaching plain http) are named, never "unreachable".
// Reading the folder copies nothing; a picture crosses only when it is kept.

import { make, setField, type CardHandle, type CardPart, type DeskState } from '../parts.js'

export const machinePart: CardPart = {
  value: (state, say) => state.payload.reachOk
    ? say('comfy.answering', 'answering')
    : state.payload.reachAsking ? say('comfy.asking', 'asking…') : say('comfy.not-answering', 'not answering'),
  alert: state => !state.payload.reachOk && !state.payload.reachAsking && !!state.payload.reachReason,
  create(context): CardHandle {
    const { say, intent } = context
    const el = make('div', 'te-dg-fld')

    const dot = make('span', 'cd-dot')
    dot.setAttribute('aria-hidden', 'true')
    const host = make('input', 'te-dg-input')
    host.type = 'text'
    host.spellcheck = false
    host.placeholder = '127.0.0.1:8188'
    host.setAttribute('aria-label', say('comfy.host', 'Host'))
    host.addEventListener('change', () => {
      const endpoint = host.value.trim()
      if (endpoint) intent('comfy:set-endpoint', { endpoint })
    })
    const find = make('button', 'te-dg-word', say('comfy.find', 'find'))
    find.type = 'button'
    find.addEventListener('click', () => intent('comfy:discover'))
    const row = make('div', 'te-dg-rowf')
    row.append(dot, host, find)
    const reason = make('p', 'te-dg-status')

    const folder = make('div', 'te-dg-fld')
    const folderState = make('span', 'te-dg-sub cd-folder')
    // Straight from the click: `showDirectoryPicker` is only allowed inside the
    // gesture, and the bus runs its handlers in the same task as the press.
    const link = make('button', 'te-dg-word')
    link.type = 'button'
    link.addEventListener('click', () => intent('comfy:link-folder'))
    const browse = make('button', 'te-dg-word')
    browse.type = 'button'
    let browsing = false
    browse.addEventListener('click', () => intent('comfy:browse', { open: !browsing }))
    const folderRow = make('div', 'te-dg-rowf')
    folderRow.append(folderState, make('span', 'te-dg-grow'), link, browse)
    folder.append(
      make('span', 'te-dg-sub', say('comfy.folder', 'ComfyUI folder')),
      folderRow,
      make('p', 'te-dg-sub cd-note', say('comfy.folder-note', 'Read where they lie — nothing is copied into your hive until you keep a picture.')),
    )

    el.append(row, reason, folder)
    return {
      el,
      paint(state: DeskState): void {
        const p = state.payload
        dot.toggleAttribute('data-on', p.reachOk)
        setField(host, p.endpoint)
        reason.textContent = p.reachAsking ? say('comfy.asking', 'asking…') : p.reachOk ? '' : p.reachReason
        reason.dataset['tone'] = p.reachAsking ? '' : 'warn'
        reason.hidden = !reason.textContent
        folder.hidden = !p.folderSupported
        browsing = p.browsing
        folderState.textContent = p.folderLinked
          ? (p.folderLabel || say('comfy.folder-linked', 'linked'))
          : say('comfy.folder-none', 'not linked')
        link.textContent = p.folderLinked ? say('comfy.folder-change', 'change') : say('comfy.folder-link', 'link')
        browse.hidden = !p.folderLinked
        browse.textContent = p.browsing ? say('comfy.folder-hide', 'hide') : say('comfy.folder-browse', 'browse')
      },
    }
  },
}
