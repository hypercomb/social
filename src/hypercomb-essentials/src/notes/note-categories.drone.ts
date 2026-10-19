// notes/note-categories.drone.ts
//
// The bee that gives a tile's notes a category tree: it holds the
// NoteCategories service (note-categories.service.ts — a dependency, which
// exports and never registers) and registers it, so the notes desk can show
// the tree, file notes by hand, ask the participant's AI for categories and
// Jev to sort. Registration is the bee's act.

import { Drone } from '@hypercomb/core'
import { NoteCategories, NOTE_CATEGORIES_KEY } from './note-categories.service.js'

export class NoteCategoriesDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override description = 'Categories for a tile\'s notes — a tree beside the notes, named by your AI or by hand, sorted by Jev'

  protected override emits = ['notes:changed']

  readonly service = new NoteCategories()
}

const _noteCategories = new NoteCategoriesDrone()
window.ioc.register('@diamondcoreprocessor.com/NoteCategoriesDrone', _noteCategories)
window.ioc.register(NOTE_CATEGORIES_KEY, _noteCategories.service)
