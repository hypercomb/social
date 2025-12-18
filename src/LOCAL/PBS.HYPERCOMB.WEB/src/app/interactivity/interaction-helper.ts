// src/app/interactivity/interaction-helpers.ts

import { InteractionState } from './interaction.state'

export const inEditor = (s: InteractionState): boolean =>
  s.appMode.kind === 'editor'

export const inWorld = (s: InteractionState): boolean =>
  s.appMode.kind === 'world'

export const inViewer = (s: InteractionState): boolean =>
  s.appMode.kind === 'viewer'

export const typing = (s: InteractionState): boolean =>
  s.keyboardFocus.kind === 'text'

export const allowShortcuts = (s: InteractionState): boolean =>
  s.keyboardFocus.kind === 'shortcuts'

export const allowSelection = (s: InteractionState): boolean =>
  s.selection.active

export const allowWorldInput = (s: InteractionState): boolean =>
  inWorld(s) && !typing(s)

export const allowEditorInput = (s: InteractionState): boolean =>
  inEditor(s) && !typing(s)

export const allowPointerInput = (s: InteractionState): boolean =>
  !typing(s)
