// notes/swarm-notes.drone.ts
//
// The bee that puts notes in the swarm: it holds the SwarmNotes service
// (swarm-notes.service.ts — a dependency, which exports and never registers)
// and registers it, so the notes desk can read everyone's notes on a tile and
// take them. Registration is the bee's act.

import { Drone } from '@hypercomb/core'
import { SwarmNotes, SWARM_NOTES_KEY } from './swarm-notes.service.js'

export class SwarmNotesDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override description = 'Notes in the swarm — everyone\'s notes on a shared tile in the one notes tree, coloured by who brought them, take to collect'

  protected override listens = ['swarm:peers-changed', 'swarm:roster-changed', 'notes:changed']
  protected override emits = ['tile:public-changed', 'command:create-cells']

  readonly service = new SwarmNotes()
}

const _swarmNotes = new SwarmNotesDrone()
window.ioc.register('@diamondcoreprocessor.com/SwarmNotesDrone', _swarmNotes)
window.ioc.register(SWARM_NOTES_KEY, _swarmNotes.service)
