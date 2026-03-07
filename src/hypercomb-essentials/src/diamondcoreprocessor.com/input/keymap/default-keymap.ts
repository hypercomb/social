// default-keymap.ts — baseline shortcut layers
//
// globalKeyMap:  priority 0  — always present, pierce-capable bindings
// defaultKeyMap: priority 10 — standard context shortcuts

import type { KeyMapLayer } from '@hypercomb/core'

// -------------------------------------------------
// global layer (priority 0)
// -------------------------------------------------

export const globalKeyMap: KeyMapLayer = {
  id: 'global',
  priority: 0,
  bindings: [
    {
      cmd: 'global.escape',
      sequence: [[{ key: 'escape' }]],
      description: 'Escape / cancel (contextual)',
      pierce: true,
    },
    {
      cmd: 'global.signout',
      sequence: [[{ key: '.' }]],
      description: 'Sign out',
    },
    {
      cmd: 'global.publish',
      sequence: [[{ key: ':', primary: true, shift: true, alt: true }]],
      description: 'Publish changes',
      category: 'Destructive',
      risk: 'warning',
    },
    {
      cmd: 'toggle.chat-window',
      sequence: [[{ key: '[', ctrl: true }]],
      description: 'Open AI Chat Window',
      category: 'AI',
      pierce: true,
    },
  ],
}

// -------------------------------------------------
// default layer (priority 10)
// -------------------------------------------------

export const defaultKeyMap: KeyMapLayer = {
  id: 'default',
  priority: 10,
  bindings: [
    // Navigation
    {
      cmd: 'layout.centerTile',
      sequence: [[{ key: 'h' }]],
      description: 'Center on active tile',
      category: 'Navigation',
    },
    {
      cmd: 'navigation.toggleFullscreen',
      sequence: [[{ key: 'f' }]],
      description: 'Toggle fullscreen mode',
      category: 'Navigation',
    },
    {
      cmd: 'navigation.toggleFocus',
      sequence: [[{ key: 'v' }]],
      description: 'Toggle focus mode',
      category: 'Navigation',
    },
    {
      cmd: 'layout.editTile',
      sequence: [[{ key: 'tab' }]],
      description: 'Start editing the active tile',
      category: 'Navigation',
    },

    // Tile
    {
      cmd: 'tile.branch',
      sequence: [[{ key: 'b' }]],
      description: 'Convert active tile to branch tile',
      category: 'Tile',
    },
    {
      cmd: 'tile.toggleLock',
      sequence: [[{ key: 'l' }]],
      description: 'Toggle lock on active tile',
      category: 'Tile',
    },
    {
      cmd: 'tile.colorPicker',
      sequence: [[{ key: 'p' }]],
      description: 'Open color picker for active tile',
      category: 'Tile',
    },

    // Layout
    {
      cmd: 'layout.new-tile',
      sequence: [[{ key: 'n' }]],
      description: 'Create a new tile',
      category: 'Layout',
    },

    // Clipboard
    {
      cmd: 'clipboard.copy',
      sequence: [[{ key: 'c' }]],
      description: 'Copy active tile to clipboard',
      category: 'Clipboard',
    },
    {
      cmd: 'clipboard.paste',
      sequence: [[{ key: 'enter' }]],
      description: 'Paste tile(s) from clipboard',
      category: 'Clipboard',
    },

    // Destructive
    {
      cmd: 'tile.delete',
      sequence: [[{ key: 'delete' }]],
      description: 'Delete selected tile(s)',
      category: 'Destructive',
      risk: 'danger',
    },
    {
      cmd: 'layout.cutCells',
      sequence: [[{ key: 'x' }]],
      description: 'Toggle cut mode for selected tile(s)',
      category: 'Destructive',
      risk: 'warning',
    },
    {
      cmd: 'layout.toggleMoveMode',
      sequence: [[{ key: 'r' }]],
      description: 'Toggle move tiles mode',
      category: 'Destructive',
      risk: 'warning',
    },
    {
      cmd: 'layout.toggleEditMode',
      sequence: [[{ key: 'e' }]],
      description: 'Toggle edit mode',
      category: 'Destructive',
      risk: 'warning',
    },

    // Advanced
    {
      cmd: 'advanced.aiImage',
      sequence: [[{ key: 'i', primary: true }]],
      description: 'Generate AI image for active tile',
      category: 'Advanced',
    },

    // Database
    {
      cmd: 'db.export',
      sequence: [[{ key: 'x', primary: true, shift: true, alt: true }]],
      description: 'Export database',
      category: 'Utility',
      risk: 'warning',
    },
    {
      cmd: 'db.import',
      sequence: [[{ key: 'i', primary: true, shift: true, alt: true }]],
      description: 'Import database',
      category: 'Destructive',
      risk: 'danger',
    },
    {
      cmd: 'db.clean',
      sequence: [[{ key: 'f1', primary: true, shift: true, alt: true }]],
      description: 'Clean entire database (debug only)',
      category: 'Destructive',
      risk: 'danger',
    },
    {
      cmd: 'storage.explore',
      sequence: [[{ key: 'f2', primary: true, shift: true }]],
      description: 'Explore storage in OPFS',
      category: 'Navigation',
    },
  ],
}
