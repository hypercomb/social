// /behavior — bind a behaviour to the tile it belongs to.
//
// Most behaviours are hive-wide: a gallery is a gallery anywhere. Some are
// not. The post-it that IS the /revolucion/meetup page has exactly one
// meaning in the whole hive, and offering it on every other tile is noise —
// the Beehaviors panel lists a behaviour that can never belong there, and the
// one tile it DOES belong to says nothing about that.
//
// Binding fixes both ends at once. `/behavior bind postit meetup` takes the
// tile's name, resolves it to that tile's LOCATION SIGNATURE (HistoryService.
// sign — `sha256(lineageKey(segments))`), and records the pair. From then on:
//
//   • at that signature (and its subtree) the behaviour is awake, and its
//     panel row is marked as BELONGING to that tile;
//   • everywhere else it is dormant — withdrawn from the Apply picker, and
//     its applied rows filtered out, by the one dormancy answer every
//     activation surface already asks (isBehaviorDormant).
//
// The signature is a LOCATION sig, never a content sig. A content sig changes
// the first time the page is edited, which would break the binding on the
// author's next keystroke; a location sig holds for as long as the tile is
// called what it is called — exactly the lifetime "belongs to that tile"
// means. Binding is participant-local, like every other lens in
// behavior-enablement.ts, and reversible: `/behavior free <behaviour>`.

import { QueenBee, EffectBus } from '@hypercomb/core'
import type { VisualBeeRegistry, VisualBeeDescriptor } from './visual-bee-registry.js'
import {
  bindBehaviorTo,
  unbindBehavior,
  bindingsFor,
  behaviorPath,
} from '../sharing/behavior-enablement.js'

type LineageShape = { explorerSegments?: () => readonly string[] }
type HistoryShape = { sign(lineage: { explorerSegments?: () => readonly string[] }): Promise<string> }

const get = <T,>(key: string): T | undefined =>
  (window as { ioc?: { get?: (k: string) => T } }).ioc?.get?.(key)

const REGISTRY_KEY = '@diamondcoreprocessor.com/VisualBeeRegistry'
const LINEAGE_KEY = '@hypercomb.social/Lineage'
const HISTORY_KEY = '@diamondcoreprocessor.com/HistoryService'

export class BehaviorQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'behavior'
  override description = 'Bind a behaviour to the tile it belongs to — it shows there and nowhere else'
  override descriptionKey = 'slash.behavior'
  override options = ['bind <behaviour> [tile]', 'free <behaviour>', 'where <behaviour>']
  override examples = [
    { input: '/behavior bind postit meetup', result: 'The post-it belongs to the meetup tile — it stops being offered anywhere else' },
    { input: '/behavior bind postit', result: 'Binds it to the tile you are standing on' },
    { input: '/behavior where postit', result: 'Names the tile it belongs to, and its signature' },
    { input: '/behavior free postit', result: 'Gives it back to the whole hive' },
  ]

  protected async execute(args: string): Promise<void> {
    const parts = args.trim().split(/\s+/).filter(Boolean)
    const verb = (parts.shift() ?? '').toLowerCase()
    const behaviourArg = parts.shift() ?? ''
    const tileArg = parts.join(' ').trim()

    if (!verb || !behaviourArg) {
      this.#say('Name a behaviour: /behavior bind <behaviour> [tile]', 'help')
      return
    }

    const kind = this.#resolveKind(behaviourArg)
    if (!kind) {
      this.#say(`No behaviour called "${behaviourArg}"`, 'help')
      return
    }

    if (verb === 'free' || verb === 'unbind' || verb === 'release') {
      this.#say(unbindBehavior(kind)
        ? `"${behaviourArg}" belongs to the whole hive again`
        : `"${behaviourArg}" was not bound to anything`, 'link_off')
      return
    }

    if (verb === 'where' || verb === 'bound') {
      const bindings = bindingsFor(kind)
      this.#say(bindings.length
        ? `"${behaviourArg}" belongs to ${bindings.map(b => b.name || b.path).join(', ')}`
        : `"${behaviourArg}" belongs everywhere — it is not bound`, 'my_location')
      return
    }

    if (verb !== 'bind' && verb !== 'to' && verb !== 'belongs') {
      this.#say('Say bind, free, or where', 'help')
      return
    }

    // The tile: a name on the layer you are standing on, an absolute path
    // when it starts with `/`, or the tile you are standing on when omitted.
    const here = [...(get<LineageShape>(LINEAGE_KEY)?.explorerSegments?.() ?? [])]
      .map(s => String(s ?? '').trim()).filter(Boolean)
    const segments = !tileArg
      ? here
      : tileArg.startsWith('/')
        ? tileArg.split('/').map(s => s.trim()).filter(Boolean)
        : [...here, tileArg]

    if (segments.length === 0) {
      this.#say('The hive root is not a tile — stand on one, or name one', 'help')
      return
    }

    // The signature IS the binding. Resolved through the same signer every
    // other site that names this bag uses, so the author's "the meetup tile"
    // and the runtime's "am I here" are one value, not two agreeing strings.
    const history = get<HistoryShape>(HISTORY_KEY)
    if (!history?.sign) {
      this.#say('History is not ready yet — try again in a moment', 'help')
      return
    }
    const sig = await history.sign({ explorerSegments: () => segments })

    bindBehaviorTo(kind, {
      sig,
      path: behaviorPath(segments),
      name: segments[segments.length - 1],
    })
    this.#say(
      `"${behaviourArg}" now belongs to ${segments[segments.length - 1]} — ${sig.slice(0, 8)}`,
      'link',
    )
  }

  /** A behaviour by any name the author would reasonably type: its view, its
   *  decoration kind, or its slash command with or without the slash. */
  #resolveKind(arg: string): string | undefined {
    const needle = arg.trim().toLowerCase().replace(/^\//, '')
    if (!needle) return undefined
    const bees: readonly VisualBeeDescriptor[] = get<VisualBeeRegistry>(REGISTRY_KEY)?.all?.() ?? []
    const hit = bees.find(b =>
      b.view?.toLowerCase() === needle
      || b.decorationKind?.toLowerCase() === needle
      || (b.slashCommand ?? '').toLowerCase().replace(/^\//, '') === needle)
    if (hit?.decorationKind) return hit.decorationKind
    // A kind nobody here declares is still bindable — a community behaviour
    // is named by its kind, and an author must be able to scope it before
    // its module arrives.
    return needle.includes(':') ? arg.trim() : undefined
  }

  #say(message: string, icon: string): void {
    EffectBus.emit('activity:log', { message, icon })
  }
}

const _behavior = new BehaviorQueenBee()
window.ioc.register('@diamondcoreprocessor.com/BehaviorQueenBee', _behavior)
