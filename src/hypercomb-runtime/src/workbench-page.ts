// hypercomb-runtime/src/workbench-page.ts
//
// THE WORKBENCH MARK. A try- door is the focused room: the chat, and the
// package that door already serves. The root domain stays the visitor portal
// and is never marked here.

import { isSandboxLabel } from '@hypercomb/core'

export const WORKBENCH_MODE = 'workbench'

/** The chat is the workbench surface. The command line is a mode inside it. */
export const WORKBENCH_SURFACE = 'hc-chat-window'

export const isWorkbenchMode = (mode: string | null | undefined): boolean =>
  String(mode ?? '') === WORKBENCH_MODE

/** A surface stays on a workbench page only when it is the chat. */
export const workbenchKeeps = (name: string, workbench: boolean): boolean =>
  !workbench || name === WORKBENCH_SURFACE

/**
 * Mark a sandbox door's shell as the workbench. A page that already names a
 * mode, and any host that is not a try- door, keep the HTML they had.
 */
export const markWorkbenchPage = (page: string, hostname: string): string => {
  const host = String(hostname ?? '').trim().toLowerCase().replace(/:\d{1,5}$/, '')
  const label = host.split('.')[0] ?? ''
  if (!isSandboxLabel(label)) return page
  const html = String(page ?? '')
  if (/data-hypercomb-mode\s*=/i.test(html)) return html
  if (!/<html\b/i.test(html)) return html
  return html.replace(/<html\b/i, `<html data-hypercomb-mode="${WORKBENCH_MODE}"`)
}
