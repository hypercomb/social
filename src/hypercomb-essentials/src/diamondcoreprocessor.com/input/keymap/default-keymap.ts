// diamondcoreprocessor.com/input/keymap/default-keymap.ts
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
      description: 'Cancel / dismiss',
      pierce: true,
    },
    {
      cmd: 'ui.shortcutSheet',
      sequence: [[{ key: '/' }]],
      description: 'Show keyboard shortcuts',
      category: 'Navigation',
    },
    {
      cmd: 'ui.commandPalette',
      sequence: [[{ key: 'k', primary: true }]],
      description: 'Open command palette',
      category: 'Navigation',
      pierce: true,
    },
    {
      cmd: 'render.togglePivot',
      sequence: [[{ key: '8', code: 'digit8', primary: true, shift: true }]],
      description: 'Toggle hex orientation',
      category: 'View',
      pierce: true,
    },
    {
      cmd: 'ui.searchBarToggle',
      sequence: [[{ key: 'space', ctrl: true }]],
      description: 'Toggle search bar focus',
      category: 'Navigation',
      pierce: true,
    },
    {
      cmd: 'mesh.togglePublic',
      sequence: [[{ key: 'p', primary: true, shift: true }]],
      description: 'Toggle public / private mode',
      category: 'Mesh',
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
      cmd: 'navigation.moveUp',
      sequence: [[{ key: 'arrowup' }]],
      description: 'Navigate up',
      category: 'Navigation',
    },
    {
      cmd: 'navigation.moveDown',
      sequence: [[{ key: 'arrowdown' }]],
      description: 'Navigate down',
      category: 'Navigation',
    },
    {
      cmd: 'navigation.moveLeft',
      sequence: [[{ key: 'arrowleft' }]],
      description: 'Navigate left',
      category: 'Navigation',
    },
    {
      cmd: 'navigation.moveRight',
      sequence: [[{ key: 'arrowright' }]],
      description: 'Navigate right',
      category: 'Navigation',
    },

    // Clipboard
    {
      cmd: 'clipboard.copy',
      sequence: [[{ key: 'c' }]],
      description: 'Copy selected tiles',
      category: 'Clipboard',
    },
    {
      cmd: 'clipboard.paste',
      sequence: [[{ key: 'enter' }]],
      description: 'Paste from clipboard',
      category: 'Clipboard',
    },
    {
      cmd: 'layout.cutCells',
      sequence: [[{ key: 'x' }]],
      description: 'Cut selected tiles',
      category: 'Clipboard',
    },
  ],
}
