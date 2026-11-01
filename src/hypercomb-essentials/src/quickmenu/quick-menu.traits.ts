// quickmenu/quick-menu.traits.ts
//
// Every option in the flower is a trait of the tile it was raised over
// (documentation/traits.md). What the registry ships is the option's OWN
// version, so a tile with nothing of its own gets the ordinary flower and
// nothing is stored for it.
//
//   trait copy              extrudes a child named copy, the tile's automaton for that seat
//   a child with children   that seat opens a flower of them, each one a word to run
//   fill copy /tools/clone  swaps the automaton: the seat runs the word `clone`
//   menu trigger copy hold  how this tile's copy seat fires
//
// A seat only ever runs a word, and a word exists only once its bee has been
// admitted, so somebody else's automaton held in the brood cannot fire from here.
//
// The trigger is a mark on the tile that holds the seat, never on the automaton,
// so a swapped-in automaton cannot give itself rollover. An ordinary child is
// just a tile: it takes a seat only when this tile has the trait by its name.

import { sameTraitWord } from '@hypercomb/core'
import { listDecorations } from '../commands/decoration-manifest.js'
import { childNamesAt, resolveTraitsAt } from '../commands/trait-read.js'
import {
  QUICK_MENU_RING,
  type QuickMenuDefinition,
  type QuickMenuDirection,
  type QuickMenuSlot,
} from './quick-menu.types.js'

/** How one seat on a tile fires. Payload `{ word, trigger }`, one record per word. */
export const MENU_TRIGGER_KIND = 'quick-menu:trigger'

/** Release, the flower's default, is the absence of a mark. */
export const MENU_TRIGGERS = ['rollover', 'hold', 'click'] as const
export type MenuTrigger = (typeof MENU_TRIGGERS)[number]
export type MenuTriggerRecord = { readonly word: string; readonly trigger: MenuTrigger }

/** What fills one seat: the word it runs, and its children when it has any. */
export type SeatFill = { readonly word: string; readonly runs: string; readonly children: readonly string[] }

export type TileSeats = { readonly fills: readonly SeatFill[]; readonly triggers: readonly MenuTriggerRecord[] }

export const NO_SEATS: TileSeats = { fills: [], triggers: [] }

const SEAT_MENU = 'tile-seat:'

const ACTIVATION: Readonly<Record<MenuTrigger, NonNullable<QuickMenuSlot['activation']>>> = {
  rollover: 'arrive',
  hold: 'hold',
  click: 'click',
}

const isTrigger = (value: unknown): value is MenuTrigger =>
  MENU_TRIGGERS.includes(value as MenuTrigger)

/** This tile's version of a menu: its automatons in their seats, its triggers on them. */
export function applyTileSeats(definition: QuickMenuDefinition, seats: TileSeats): QuickMenuDefinition {
  if (seats.fills.length === 0 && seats.triggers.length === 0) return definition
  return { ...definition, slots: definition.slots.map(slot => applyToSlot(slot, seats)) }
}

function applyToSlot(slot: QuickMenuSlot, seats: TileSeats): QuickMenuSlot {
  const fill = seats.fills.find(f => sameTraitWord(f.word, slot.label))
  const trigger = seats.triggers.find(t => sameTraitWord(t.word, slot.label))?.trigger
  if (fill?.children.length) return { ...slot, action: { kind: 'menu', menu: SEAT_MENU + fill.word } }
  const swapped = fill && !sameTraitWord(fill.runs, slot.label)
  const action: QuickMenuSlot['action'] = swapped ? { kind: 'command', command: fill.runs } : slot.action
  // A pathway always opens on arrival: its job is to move the flower.
  if (action.kind === 'menu' || !trigger) return { ...slot, action }
  return { ...slot, action, activation: ACTIVATION[trigger] }
}

/** The flower a seat's own children make. `back` keeps its cell, so the children
 *  take the rest of the ring in order; a tile with more than fit shows the first. */
export function seatMenu(name: string, seats: TileSeats, back: QuickMenuDirection): QuickMenuDefinition | undefined {
  if (!name.startsWith(SEAT_MENU)) return undefined
  const word = name.slice(SEAT_MENU.length)
  const fill = seats.fills.find(f => sameTraitWord(f.word, word))
  if (!fill) return undefined
  const cells = QUICK_MENU_RING.filter(direction => direction !== back)
  const slots = fill.children.slice(0, cells.length).map((child, at): QuickMenuSlot => ({
    direction: cells[at],
    label: child,
    action: { kind: 'command', command: child },
  }))
  return { name, title: word, contexts: [], slots }
}

/** `menu trigger` · `menu trigger <word> <rollover|hold|click|release>`. */
export function parseTriggerArgs(raw: string):
  | { readonly verb: 'list' }
  | { readonly verb: 'set'; readonly word: string; readonly trigger: MenuTrigger | 'release' }
  | { readonly error: 'unknown' } {
  const words = raw.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return { verb: 'list' }
  if (words.length !== 2) return { error: 'unknown' }
  const trigger = words[1].toLowerCase()
  if (trigger !== 'release' && !isTrigger(trigger)) return { error: 'unknown' }
  return { verb: 'set', word: words[0], trigger }
}

type HistoryLike = { getLayerBySig?: (sig: string) => Promise<{ name?: string } | null> }

/** What the tile at `segments` has made of its seats. Read off the gesture path,
 *  and a read that fails leaves the ordinary flower. */
export async function readTileSeats(segments: readonly string[]): Promise<TileSeats> {
  try {
    const [resolved, marks] = await Promise.all([
      resolveTraitsAt(segments),
      listDecorations<MenuTriggerRecord>({ kind: MENU_TRIGGER_KIND, segments }),
    ])
    const fills: SeatFill[] = []
    for (const r of resolved) {
      if (r.rung === 'child') {
        fills.push({ word: r.word, runs: r.word, children: await childNamesAt(r.route) })
      } else if (r.rung === 'fill') {
        const history = window.ioc.get<HistoryLike>('@diamondcoreprocessor.com/HistoryService')
        const runs = String((await history?.getLayerBySig?.(r.sig))?.name ?? '').trim()
        if (runs) fills.push({ word: r.word, runs, children: [] })
      }
    }
    const triggers = marks.map(mark => mark.record.payload).filter(p => isTrigger(p?.trigger) && !!p?.word)
    return { fills, triggers }
  } catch {
    return NO_SEATS
  }
}
