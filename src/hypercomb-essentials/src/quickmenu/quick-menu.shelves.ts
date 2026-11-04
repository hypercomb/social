// quickmenu/quick-menu.shelves.ts
//
// THE CONTEXT DATA RING — the shelf's kept groups as a flower. The centre keeps
// what the shelf holds as a new group (so a group starts as you collect); each
// other direction brings one kept group back, newest first. The groups are the
// context groups of assistant/context-groups.ts, so the ring has no store of its
// own and cannot drift from the shelf's.

import type { ContextGroup } from '../assistant/context-groups.js'
import { QUICK_MENU_RING, type QuickMenuDefinition, type QuickMenuSlot } from './quick-menu.types.js'

export const SHELVES_MENU = 'root:shelves'

export function shelvesMenu(name: string, groups: readonly ContextGroup[]): QuickMenuDefinition | undefined {
  if (name !== SHELVES_MENU) return undefined
  const kept = groups.slice(0, QUICK_MENU_RING.length).map((group, at): QuickMenuSlot => ({
    direction: QUICK_MENU_RING[at],
    label: group.label,
    icon: 'bookmark',
    action: { kind: 'effect', effect: 'shelf:recall', payload: { id: group.id } },
  }))
  const keep: QuickMenuSlot = { direction: 'centre', label: 'keep', labelKey: 'quickmenu.keep', icon: 'save', action: { kind: 'effect', effect: 'shelf:save', payload: {} } }
  return { name, title: 'Shelves', titleKey: 'quickmenu.shelves', contexts: [], slots: [keep, ...kept] }
}
