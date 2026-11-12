// assistant/chat-surface.ts
//
// THE CHAT'S OWN SURFACE, by name (jwize, 2026-11-11: "the chat needs to phase
// out angular so it can be compatible with the minimal debugger build"). The
// chat window has been an Angular component in the shell; a page with no
// Angular cannot mount it. `hc-chat` is the chat as a framework-free element
// (chat.view.ts), contributed by the chat's own bee.
//
// While the Angular window is still registered on a page, it is the chat
// there and this one stays out of its way: one `chat:open`, one window.

export const CHAT_SURFACE = 'hc-chat'
export const CHAT_VIEW_OWNER = '@diamondcoreprocessor.com/ChatView'

/** The Angular window's surface name (the shell registers it). */
export const ANGULAR_CHAT_SURFACE = 'hc-chat-window'

type RegistryLike = { all?: () => readonly { name?: string }[] }

/** True where the Angular chat window is registered — that page already has
 *  a chat, and it answers every door. Asked at the moment of opening, never
 *  at boot: registration order is not something to race. */
export function angularChatPresent(): boolean {
  const registry = (window as { ioc?: { get?: (key: string) => unknown } }).ioc
    ?.get?.('@hypercomb.social/ShellSurfaceRegistry') as RegistryLike | undefined
  return !!registry?.all?.().some(surface => surface?.name === ANGULAR_CHAT_SURFACE)
}
