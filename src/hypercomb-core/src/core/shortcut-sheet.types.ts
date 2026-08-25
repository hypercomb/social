// core/shortcut-sheet.types.ts — the /help reference sheet's data contract.
//
// The ShortcutSheetDrone (essentials) owns the data; the shell chrome
// renders it. The SHAPE they agree on is a contract between a module and
// the shell, and contracts live in core — shared must never import from a
// module, even `import type` (the compile-time arrow is the drift the
// dependency doctrine forbids). The drone re-exports these for its own
// call sites.

import type { KeyBinding } from '../keymap.js'

export interface ShortcutGroup {
  category: string
  bindings: KeyBinding[]
}

export interface SlashCommandEntry {
  name: string
  aliases: readonly string[]
  description: string
}

export interface CommandLineOperationEntry {
  behavior: string
  trigger: string
  description: string
  example?: { input: string; result: string }
}

export interface ShortcutSheetState {
  open: boolean
  slashCommands: SlashCommandEntry[]
  commandLineOps: CommandLineOperationEntry[]
  shortcutGroups: ShortcutGroup[]
}
