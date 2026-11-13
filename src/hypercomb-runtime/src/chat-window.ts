// hypercomb-runtime/src/chat-window.ts
//
// <hc-chat-window> — THE CHAT WINDOW, WITHOUT ANGULAR (jwize, 2026-11-12: "it
// is supposed to be identical to the desktop version", "port it to not be
// using angular the output should be exactly the same", "the user interface
// hasn't changed only the code running it").
//
// The same chat: its logic is the Angular component's class with only the
// Angular calls answered by lite-signals.ts (chat-window/ui/chat-window/
// chat-window.ts); its template is the Angular template, translated once into
// lite-template.ts calls in Angular's order (chat-window.template.ts); its
// styles are the Angular sheets, scoped exactly as Angular scoped them
// (chat-window.styles.ts); its docking is core's DockedPanel, as before
// (chat-window.dock.ts). Both shells mount this one element — the Angular
// shells through their surface barrels, the Angular-free page through its
// main.ts — so there is one chat everywhere.
//
// Host UI, so it lives in the runtime (the placement rule: a shell is deployed
// before the packages its participants hold).

import { registerShellSurface } from './shell-surface-registry'
import { createOwner, type Owner } from './lite-signals'
import { render, type View } from './lite-template'
import { ChatWindow } from './chat-window/ui/chat-window/chat-window'
import { chatWindowTemplate } from './chat-window/chat-window.template'
import { installChatWindowStyles } from './chat-window/chat-window.styles'

export const CHAT_WINDOW_TAG = 'hc-chat-window'
/** The scope Angular's Emulated encapsulation used, fixed: the sheets and the template agree on it. */
export const CHAT_WINDOW_SCOPE = 'hc-chat'

const ElementBase: typeof HTMLElement = typeof HTMLElement === 'undefined'
  ? (class {} as unknown as typeof HTMLElement)
  : HTMLElement

export class ChatWindowElement extends ElementBase {
  #owner: Owner | null = null
  #view: View | null = null
  #chat: ChatWindow | null = null

  /** The chat's logic, for code that reached the Angular component instance. */
  get chat(): ChatWindow | null { return this.#chat }

  connectedCallback(): void {
    if (this.#owner) return            // moved, not new: the shell re-inserts surfaces to keep their order
    installChatWindowStyles(this.ownerDocument)
    const owner = this.#owner = createOwner()
    // Field initializers create effects: they belong to this window's owner (its DestroyRef).
    const chat = this.#chat = owner.run(() => new ChatWindow())
    this.#view = render(this, chatWindowTemplate(chat), { scope: CHAT_WINDOW_SCOPE, owner })
  }

  disconnectedCallback(): void {
    // A move fires disconnect then connect in the same task: only a removal that
    // is still a removal a microtask later destroys the window.
    queueMicrotask(() => {
      if (this.isConnected || !this.#owner) return
      try { this.#chat?.ngOnDestroy() } catch (error) { console.error(error) }
      this.#owner.dispose()
      this.#owner = null
      this.#view = null
      this.#chat = null
    })
  }
}

if (typeof customElements !== 'undefined' && !customElements.get(CHAT_WINDOW_TAG)) {
  customElements.define(CHAT_WINDOW_TAG, ChatWindowElement)
}

// Registry-fed shell surface — the same name and order the Angular component
// had, so the workbench, the tutorials and the shell styles find it as before.
registerShellSurface({
  name: CHAT_WINDOW_TAG,
  owner: '@hypercomb.runtime/ChatWindowElement',
  element: CHAT_WINDOW_TAG,
  order: 113,
  // The host's own, like the consent dialog: mounted with no package at all,
  // so it never counts as one (a cold host keeps its install console).
  host: true,
})
