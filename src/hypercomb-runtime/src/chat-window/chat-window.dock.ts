// hypercomb-runtime/src/chat-window/chat-window.dock.ts
//
// What `hcDockedPanel` did for the chat window, without Angular. The directive
// (hypercomb-shared/ui/docked-panel/hc-docked-panel.directive.ts) was an
// adapter over core's DockedPanel: build it with the options on init, dispose
// it on destroy. The template mounts this on the window's <aside> once that
// element is in the document (lite-template `mount`), and the returned
// function disposes the panel when the aside is removed — the same lifetime.

import { attachDockedPanel, type DockedPanelOptions } from '@hypercomb/core'

export function dock(node: Element, options: DockedPanelOptions): () => void {
  const panel = attachDockedPanel(node as HTMLElement, options)
  return () => panel.dispose()
}
