// assistant/chat-code.ts
//
// THE CHAT'S OTHER VIEW: THE CODE OF WHAT IT IS ABOUT.
//
// jwize, 2026-11-16: "the code should be in the main pane as a different view
// to the chat, so a different view of the chat's target." The chat window
// (the shell's, hypercomb-runtime) lends its main pane: it keeps an element
// `.chat-code-host` beside the conversation and says `chat:code` when the
// participant switches the pane to code or back, naming the tile the
// conversation in hand is about. This draws the inspect view there
// (inspect-window.view.ts): the tile's inner tiles, files and resources, the
// code that runs it, and the platform beneath.
//
// The shell may not import this package, so the contract is the effect's
// name, its payload and the host's class, not a type. Found by class, as the
// providers console finds its own host.

import { managedSiteSegments } from '../sharing/managed-record.js'
import type { InspectWindowView } from './inspect-window.view.js'

export const CHAT_CODE_EFFECT = 'chat:code'
export const CHAT_CODE_HOST = '.chat-code-host'

export type ChatCodeAsk = { readonly open?: boolean; readonly segments?: readonly string[] }

const clean = (segments: readonly unknown[] | null | undefined): string[] =>
  (segments ?? []).map(segment => String(segment ?? '').trim()).filter(Boolean)

/** The tile the code view opens on: the one the conversation is about; for a
 *  conversation about no tile, the site this page manages, else the page the
 *  participant stands on (the root when that is nowhere). */
export const chatCodeTarget = (
  asked: readonly string[] | null | undefined,
  site: readonly string[] | null | undefined,
  here: readonly string[] | null | undefined,
): string[] => {
  const about = clean(asked)
  if (about.length) return about
  const managed = clean(site)
  return managed.length ? managed : clean(here)
}

let turn = 0

/** Show the code view in the chat's lent pane, or hand the pane back. */
export const showChatCode = async (ask: ChatCodeAsk | null | undefined): Promise<void> => {
  const mine = ++turn
  let view: InspectWindowView
  try { view = (await import('./inspect-window.view.js')).inspectWindow() } catch { return }
  // A later switch answered while the view was loading: that one decides.
  if (mine !== turn) return
  const host = document.querySelector<HTMLElement>(CHAT_CODE_HOST)
  if (!ask?.open || !host) { view.unmount(); return }
  const lineage = (window as unknown as { ioc?: { get?: (key: string) => unknown } }).ioc
    ?.get?.('@hypercomb.social/Lineage') as { explorerSegments?: () => readonly string[] } | undefined
  let here: readonly string[] = []
  try { here = lineage?.explorerSegments?.() ?? [] } catch { here = [] }
  view.mount(host, { kind: 'tile', segments: chatCodeTarget(ask.segments, managedSiteSegments(), here) })
}
