import { HypercombMode } from "src/app/core/models/enumerations"
import { IShortcut } from "../shortcut-model"

export const defaultShortcuts = [
  {
    cmd: 'debug.mouselocked',
    description: 'Toggle mouse lock check (debug only)',
    category: 'warning',
    risk: 'warning',
    riskNote: 'Use only if instructed by support',
    keys: [[{ key: 'd' }]]
  },
  {
    cmd: 'layout.centerTile',
    description: 'Center on given tile or first tile',
    category: 'Navigation',
    keys: [[{ key: 'h' }]]
  },
  {
    cmd: 'navigation.toggleFullscreen',
    description: 'Toggle fullscreen mode',
    category: 'Navigation',
    keys: [[{ key: 'f' }]]
  },
  {
    cmd: 'navigation.toggleFocus',
    description: 'Toggle focus mode',
    category: 'Navigation',
    keys: [[{ key: 'v' }]],
    payload: { mode: HypercombMode.Focused }
  },
  {
    cmd: 'layout.editTile',
    description: 'Start editing the active tile',
    category: 'Navigation',
    keys: [[{ key: 'tab' }]],
    payload: { mode: HypercombMode.EditMode }
  },

  {
    cmd: 'tile.branch',
    description: 'Convert active tile to branch tile',
    category: 'Tile',
    keys: [[{ key: 'b' }]]
  },
  {
    cmd: 'tile.toggleLock',
    description: 'Toggle lock on active tile',
    category: 'Tile',
    keys: [[{ key: 'l' }]]
  },
  {
    cmd: 'tile.colorPicker',
    description: 'Open color picker for active tile',
    category: 'Tile',
    keys: [[{ key: 'p' }]]
  },

  {
    cmd: 'clipboard.copy',
    description: 'Copy active tile to clipboard',
    category: 'Clipboard',
    keys: [[{ key: 'c' }]]
  },
  {
    cmd: 'clipboard.paste',
    description: 'Paste tile(s) from clipboard',
    category: 'Clipboard',
    keys: [[{ key: 'enter' }]]
  },

  {
    cmd: 'advanced.aiImage',
    description: 'Generate AI image for active tile',
    category: 'Advanced',
    keys: [[{ key: 'i', primary: true }]]
  },
  {
    cmd: 'advanced.selectionMode',
    description: 'Hold to enable selection mode',
    category: 'Advanced',
    keys: [[{ key: 'control' }]]
  },
  {
    cmd: 'tile.delete',
    description: 'Delete selected tile(s)',
    category: 'Destructive',
    risk: 'danger',
    riskNote: 'This will permanently delete the selected tile(s)',
    keys: [[{ key: 'delete' }]]
  },
  {
    cmd: 'layout.cutCells',
    description: 'Toggle cut mode for selected tile(s)',
    category: 'Destructive',
    risk: 'warning',
    riskNote: 'Removes tile(s) from current position',
    keys: [[{ key: 'x' }]],
  },
  {
    cmd: 'layout.toggleMoveMode',
    description: 'Toggle move tiles mode',
    category: 'Destructive',
    risk: 'warning',
    riskNote: 'Be careful when moving tiles as relationships might be affected',
    keys: [[{ key: 'r' }]],
    payload: { mode: HypercombMode.Move }
  },
  {
    cmd: 'layout.toggleEditMode',
    description: 'Toggle edit mode for active tile',
    category: 'Destructive',
    risk: 'warning',
    riskNote: 'Be careful when editing tiles as changes are immediate',
    keys: [[{ key: 'e' }]],
    payload: { mode: HypercombMode.EditMode }
  },

  {
    cmd: 'mode.change',
    description: 'Switch to focus mode (primary+F)',
    category: 'Navigation',
    keys: [[{ key: 'f', primary: true }]],
    payload: { mode: HypercombMode.Focused }
  },
  {
    cmd: 'db.export',
    description: 'Export database',
    category: 'Non-Destructive',
    risk: 'warning',
    riskNote: 'Ensure you have a proper backup before exporting',
    keys: [[{ key: 'x', primary: true, shift: true, alt: true }]]
  },
  {
    cmd: 'db.import',
    description: 'Import database',
    category: 'Destructive',
    risk: 'danger',
    riskNote: 'This will overwrite existing data. Make sure you have a backup',
    keys: [[{ key: 'i', primary: true, shift: true, alt: true }]]
  },
  {
    cmd: 'db.clean',
    description: 'Clean entire database (debug only)',
    category: 'Destructive',
    risk: 'danger',
    riskNote: 'This will permanently delete all local data. Use only if instructed by support',
    keys: [[{ key: 'f1', primary: true, shift: true, alt: true }]]
  },
  {
    cmd: 'layout.new-tile',
    description: 'Create a new tile',
    category: 'Layout',
    risk: 'none',
    riskNote: 'This will not affect existing data',
    keys: [[{ key: 'n' }]]
  },

  {
    cmd: 'storage.explore',
    description: 'Explore storage in OPFS',
    category: 'Navigation',
    keys: [[{ key: 'f2', primary: true, shift: true }]]
  }
] as const satisfies readonly IShortcut[]


