// keyboard-desk/behaviours/behaviours.ts
//
// TRAIT `behaviours` — everything a chord can run, gathered live: the keymap's
// commands, every word the language can say, and the lineups already on a key,
// so a behaviour a module adds is here with no table to keep. A command's group
// is its keymap category, and a lineup's is the one it was saved under; a word's
// group is the language.

import { lineupOf, wordCmd, wordOf, type Behaviour, type BehaviourSources, type BehavioursPart, type Say } from '../parts.js'

export const WORDS_GROUP = 'Words'
const OTHER_GROUP = 'Other'

/** Escape is the way out of everything, this desk included. */
const LOCKED = new Set(['global.escape'])

/** `navigation.moveUp` reads `move up`. */
export const nameOfCmd = (cmd: string): string => {
  const tail = cmd.slice(cmd.lastIndexOf('.') + 1)
  return tail.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase()
}

/** `mesh.togglePublic` reads `mesh toggle public`. */
const fullNameOfCmd = (cmd: string): string => cmd.split('.').map(nameOfCmd).join(' ')

export const listBehaviours = (sources: BehaviourSources, say: Say): readonly Behaviour[] => {
  const out = new Map<string, Behaviour>()
  for (const binding of sources.bindings) {
    const word = wordOf(binding.cmd)
    const description = binding.description ?? ''
    if (!word && !description) continue
    out.set(binding.cmd, {
      id: binding.cmd,
      name: word ?? (lineupOf(binding.cmd) ? description : nameOfCmd(binding.cmd)),
      description: binding.descriptionKey ? say(binding.descriptionKey, description) : description,
      group: word ? WORDS_GROUP : (binding.category ?? OTHER_GROUP),
      locked: LOCKED.has(binding.cmd),
    })
  }
  for (const entry of sources.words) {
    const id = wordCmd(entry.name)
    if (entry.hidden || out.has(id)) continue
    out.set(id, { id, name: entry.name, description: entry.description, group: WORDS_GROUP, locked: false })
  }
  // Two commands can end in the same word: `clipboard.toggle`, `mesh.toggle`.
  const named = new Map<string, number>()
  for (const { name } of out.values()) named.set(name, (named.get(name) ?? 0) + 1)
  const told = [...out.values()].map(item => (named.get(item.name) ?? 0) > 1 && !wordOf(item.id) && !lineupOf(item.id)
    ? { ...item, name: fullNameOfCmd(item.id) }
    : item)

  const inGroup = (group: string): number => (group === WORDS_GROUP ? 1 : 0)
  return told.sort((a, b) =>
    inGroup(a.group) - inGroup(b.group) || a.group.localeCompare(b.group) || a.name.localeCompare(b.name))
}

export const behavioursPart: BehavioursPart = { list: listBehaviours }
