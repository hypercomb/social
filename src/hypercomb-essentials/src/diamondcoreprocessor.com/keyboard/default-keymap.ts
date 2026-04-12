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
      descriptionKey: 'keymap.escape',
      pierce: true,
    },
    {
      cmd: 'ui.shortcutSheet',
      sequence: [[{ key: '/' }]],
      description: 'Show keyboard shortcuts',
      descriptionKey: 'keymap.shortcuts',
      category: 'Navigation',
    },
    {
      cmd: 'ui.commandPalette',
      sequence: [[{ key: 'k', primary: true }]],
      description: 'Open command palette',
      descriptionKey: 'keymap.palette',
      category: 'Navigation',
      pierce: true,
    },
    {
      cmd: 'render.togglePivot',
      sequence: [[{ key: '8', code: 'digit8', primary: true, shift: true }]],
      description: 'Toggle hex orientation',
      descriptionKey: 'keymap.pivot',
      category: 'View',
      pierce: true,
    },
    {
      cmd: 'ui.commandLineToggle',
      sequence: [[{ key: 'space', ctrl: true }]],
      description: 'Toggle command line focus',
      descriptionKey: 'keymap.command-line-toggle',
      category: 'Navigation',
      pierce: true,
    },
    {
      cmd: 'mesh.togglePublic',
      sequence: [[{ key: 'p', primary: true, shift: true }]],
      description: 'Toggle public / private mode',
      descriptionKey: 'keymap.mesh-toggle',
      category: 'Mesh',
      pierce: true,
    },
    {
      cmd: 'render.toggleBees',
      sequence: [[{ key: 'b', ctrl: true, shift: true }]],
      description: 'Toggle bee avatars',
      descriptionKey: 'keymap.bees',
      category: 'View',
      pierce: true,
    },
    {
      cmd: 'navigation.fitToScreen',
      sequence: [[{ key: '0', primary: true }]],
      description: 'Fit content to screen',
      descriptionKey: 'keymap.fit',
      category: 'Navigation',
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
      descriptionKey: 'keymap.up',
      category: 'Navigation',
    },
    {
      cmd: 'navigation.moveDown',
      sequence: [[{ key: 'arrowdown' }]],
      description: 'Navigate down',
      descriptionKey: 'keymap.down',
      category: 'Navigation',
    },
    {
      cmd: 'navigation.moveLeft',
      sequence: [[{ key: 'arrowleft' }]],
      description: 'Navigate left',
      descriptionKey: 'keymap.left',
      category: 'Navigation',
    },
    {
      cmd: 'navigation.moveRight',
      sequence: [[{ key: 'arrowright' }]],
      description: 'Navigate right',
      descriptionKey: 'keymap.right',
      category: 'Navigation',
    },

    // Clipboard
    {
      cmd: 'clipboard.copy',
      sequence: [[{ key: 'c' }]],
      description: 'Copy selected tiles',
      descriptionKey: 'keymap.copy',
      category: 'Clipboard',
    },
    {
      cmd: 'clipboard.paste',
      sequence: [[{ key: 'enter' }]],
      description: 'Paste from clipboard',
      descriptionKey: 'keymap.paste',
      category: 'Clipboard',
    },
    {
      cmd: 'layout.cutCells',
      sequence: [[{ key: 'x' }]],
      description: 'Cut selected tiles',
      descriptionKey: 'keymap.cut',
      category: 'Clipboard',
    },

    // Selection
    {
      cmd: 'selection.toggleLeader',
      sequence: [[{ key: 'space', ctrl: false }]],
      description: 'Toggle leader tile in selection',
      descriptionKey: 'keymap.toggleLeader',
      category: 'Selection',
    },

    // Remove
    {
      cmd: 'selection.remove',
      sequence: [[{ key: 'delete' }], [{ key: 'backspace' }]],
      description: 'Remove selected tiles',
      descriptionKey: 'keymap.remove',
      category: 'Editing',
    },
  ],
}
