// diamondcoreprocessor.com/commands/action-card.drone.ts
//
// Feeds the ACTION study card on the help launcher page — the contact-card
// interaction, applied to behaviors. HOVERING a help tile emits
// `action:hover-show` with everything the shell card needs to explain the
// behavior; CLICKING the tile routes through HelpGroup's activate →
// `action:request-pin`, answered here with `action:hover-pin` — the card
// sticks like a pinned contact card; stick several and drag them apart to
// compare and study.
//
// FOUR kinds of help tile, resolved by the member key's shape:
//   gesture:<id>   — a mouse/trackpad basic (tutorial tier 0): gesture pills,
//                    description and detail curated HERE (no registry owns
//                    pointer gestures); `help:more` renders the same way
//   <keymap cmd>   — a keyboard action: shortcut steps, category, description
//   slash:<name>   — a typed /command: usage, parameter options (the curated
//                    "; a | b | c" tail of its description), aliases
//   cli:<name>     — a command-line input behavior: every operation with its
//                    trigger and a worked example (input → result)
//
// Every card may carry a DETAIL — the paragraph that explains what the
// behavior actually does beyond its one-line description. Details live in the
// i18n catalogs under `help.detail.<key>` (gestures inline their English
// fallback); a key with no detail simply renders none.
//
//   tile:hover (help tile)         → emit action:hover-show { …card data }
//   tile:hover (anything else)     → emit action:hover-hide
//   action:request-pin {cmd,label} → emit action:hover-pin  { …card data }
//
// Resolution is index-driven, never label-driven: the hovered cell's
// `launch:target` decoration carries the member's stable `key` —
// launchKeyForLabel gives it synchronously. Cells committed before the
// payload carried `key` fall back to the launcher registry (an IoC read of a
// shared service — sanctioned; only IMPORTS of shared are forbidden).
//
// Mirrors ContactDrone / FilesTeaserDrone: a Drone bridging a shell trigger to
// data + a pinnable shell component, all over EffectBus. No shared import.

import { Drone, EffectBus, formatChord, I18N_IOC_KEY, type I18nProvider, type KeyBinding } from '@hypercomb/core'
import { launchKeyForLabel } from './decoration-kind-index.js'
import type { SlashBehaviour } from './slash-behaviour.provider.js'

const ioc = <T,>(key: string): T | undefined =>
  (window as { ioc?: { get?: <U>(k: string) => U | undefined } }).ioc?.get?.<T>(key)

type LineageLike = { explorerSegments?: () => readonly string[] }
type KeyMapLike = { getEffective?: () => KeyBinding[] }
type LauncherLike = { get?: (id: string) => { members?: () => { key?: string; label?: string }[] } | undefined }
type SlashDroneLike = { entries?: () => SlashBehaviour[] }
type CliOpLike = { trigger?: string; description?: string; examples?: readonly { input?: string; key?: string; result?: string }[] }
type CliMetaLike = readonly { name: string; operations?: readonly CliOpLike[] }[]

/** One command-line operation as the card renders it. */
export interface ActionCardOp {
  trigger: string
  description: string
  example?: { input: string; result: string }
}

/** A card string resolved through i18n with an inline English fallback —
 *  the same duality as KeyBinding.description / .descriptionKey. */
type I18nText = { key: string; fallback: string }

/** The tutorial's mouse/trackpad basics. Pointer gestures have no registry,
 *  so the whole card is curated here: pills (rendered like key pills),
 *  the one-line description, and the behavior detail. Steps follow the
 *  keymap shape — one inner array per simultaneous combo. */
const GESTURE_CARDS: Record<string, { steps: I18nText[][]; description: I18nText; detail?: I18nText }> = {
  open: {
    steps: [[{ key: 'help.key.left-click', fallback: 'Left Click' }]],
    description: { key: 'help.gesture.open', fallback: 'Click a tile to go into it.' },
    detail: {
      key: 'help.gesture.open.detail',
      fallback: 'A tile opens into its own layer, which can hold more tiles of its own. Keep clicking to go deeper.',
    },
  },
  back: {
    steps: [[{ key: 'help.key.right-click', fallback: 'Right Click' }]],
    description: { key: 'help.gesture.back', fallback: 'Right-click to come back out one layer.' },
    detail: {
      key: 'help.gesture.back.detail',
      fallback: 'Works anywhere on the canvas. Shift+Click steps back too — handy on a trackpad.',
    },
  },
  zoom: {
    steps: [[{ key: 'help.key.scroll', fallback: 'Scroll' }]],
    description: { key: 'help.gesture.zoom', fallback: 'Scroll to zoom in and out.' },
    detail: {
      key: 'help.gesture.zoom.detail',
      fallback: 'Hold Ctrl while scrolling for finer steps. On a touch screen, pinch with two fingers.',
    },
  },
  pan: {
    steps: [[
      { key: 'help.key.space', fallback: 'Space' },
      { key: 'help.key.drag', fallback: 'Drag' },
    ]],
    description: { key: 'help.gesture.pan', fallback: 'Hold Space and move the mouse to drag the screen.' },
    detail: {
      key: 'help.gesture.pan.detail',
      fallback: 'On a touch screen, drag with one finger.',
    },
  },
  arrows: {
    steps: [[{ key: 'help.key.arrows', fallback: 'Arrow Keys' }]],
    description: { key: 'help.gesture.arrows', fallback: 'Step the selection from tile to tile.' },
    detail: {
      key: 'help.gesture.arrows.detail',
      fallback: 'Each press moves to the neighboring tile in that direction — a way to move around without the mouse.',
    },
  },
  select: {
    steps: [[
      { key: 'help.key.ctrl', fallback: 'Ctrl' },
      { key: 'help.key.click', fallback: 'Click' },
    ]],
    description: { key: 'help.gesture.select', fallback: 'Hold Ctrl and click tiles to select them.' },
    detail: {
      key: 'help.gesture.select.detail',
      fallback: 'Ctrl+Click adds or removes one tile; hold Ctrl and drag to paint over a whole area. Selected tiles are what Copy, Cut and Remove act on. On a Mac, use Cmd.',
    },
  },
  more: {
    steps: [],
    description: { key: 'help.gesture.more', fallback: 'Reveals the next part of the tutorial.' },
  },
}

/** What the shell card renders. `steps` = one entry per keymap sequence step,
 *  each a list of formatted key parts ("Ctrl", "Shift", "8") for pills. */
export interface ActionCardPayload {
  label: string
  cmd: string
  kind: 'key' | 'slash' | 'cli' | 'gesture'
  category: string
  description: string
  steps: string[][]
  /** The behavior's detail — what actually happens when you use it, beyond
   *  the one-line description. i18n `help.detail.<key>`; absent = no detail. */
  detail?: string
  /** slash: the typed form, e.g. "/screensaver". */
  usage?: string
  /** slash: parameter options — the author's structured `options` (QueenBee
   *  standard), or the legacy "; a | b | c" description tail as fallback. */
  params?: string[]
  /** slash: alternate typed forms, e.g. ["/saver"]. */
  aliases?: string[]
  /** slash: the author's worked examples (QueenBee standard). */
  examples?: { input: string; result: string }[]
  /** cli: every operation with trigger + worked example. */
  ops?: ActionCardOp[]
}

export class ActionCardDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'commands'

  public override description =
    'Feeds the action study card: hover a help tile for a peek of what the behavior does and how to use it; click the tile to pin the card and compare.'

  protected override listens = ['tile:hover', 'action:request-pin']
  protected override emits = ['action:hover-show', 'action:hover-hide', 'action:hover-pin']

  #wired = false
  /** label currently driving the card (avoid redundant re-emits). */
  #hoverLabel: string | null = null

  protected override heartbeat = async (): Promise<void> => {
    if (this.#wired) return
    this.#wired = true
    this.onEffect<{ label?: string }>('tile:hover', (p) => this.#onHover(p?.label ?? null))
    // A help-tile CLICK (HelpGroup.activate) asks for the pinned card — the
    // contact gesture: hover peeks, click sticks.
    this.onEffect<{ cmd?: string; label?: string }>('action:request-pin', (p) => {
      if (!p?.cmd || !p.label) return
      const payload = this.#fromKey(p.cmd, p.label)
      if (payload) EffectBus.emit('action:hover-pin', payload)
    })
  }

  #onHover(label: string | null): void {
    if (label === this.#hoverLabel) return
    this.#hoverLabel = label
    const payload = label ? this.#build(label) : null
    if (payload) EffectBus.emit('action:hover-show', payload)
    else EffectBus.emit('action:hover-hide', {})
  }

  /** Card data for a hovered help cell, or null when the hover is anything
   *  else (normal tile, other groups' launchers, off the launch page). */
  #build(label: string): ActionCardPayload | null {
    // The help page lives at its own root location, /help (group id = the
    // segment). Any launcher page counts — non-help tiles resolve no cmd and
    // fall through to hover-hide anyway.
    const segs = ioc<LineageLike>('@hypercomb.social/Lineage')?.explorerSegments?.() ?? []
    if (segs.length !== 1) return null
    const seg = String(segs[0])
    // openDirectly groups (the dashboard) have no page — treat like a normal location.
    const grp = ioc<{ get?: (id: string) => { openDirectly?: boolean } | undefined }>('@hypercomb.social/GroupLauncher')?.get?.(seg)
    if (!seg.startsWith('agg-') && (!grp || grp.openDirectly)) return null
    let key = launchKeyForLabel(label)
    if (!key) {
      // Cells committed before the decoration carried `key` have no indexed
      // member key — resolve from the live launcher registry by label.
      const help = ioc<LauncherLike>('@hypercomb.social/GroupLauncher')?.get?.('help')
      key = help?.members?.()?.find(m => m?.label === label)?.key ?? ''
    }
    if (!key) return null
    return this.#fromKey(key, label)
  }

  /** Dispatch on the member key's shape. */
  #fromKey(key: string, label: string): ActionCardPayload | null {
    if (key.startsWith('gesture:')) return this.#fromGesture(key.slice(8), key, label)
    if (key === 'help:more') return this.#fromGesture('more', key, label)
    if (key.startsWith('slash:')) return this.#fromSlash(key.slice(6), key, label)
    if (key.startsWith('cli:')) return this.#fromCli(key.slice(4), key, label)
    return this.#fromBinding(key, label)
  }

  /** i18n with the key-echo guard: t() returns the KEY itself when
   *  untranslated (the catalogs fall back to English internally, so this only
   *  fires when a key is missing everywhere). */
  #t(text: I18nText): string {
    const translated = ioc<I18nProvider>(I18N_IOC_KEY)?.t(text.key)
    return translated && translated !== text.key ? translated : text.fallback
  }

  /** The behavior's detail paragraph — catalog-only, `help.detail.<key>`.
   *  Missing key = no detail, never a raw key on the card. */
  #detail(key: string): string | undefined {
    const k = `help.detail.${key}`
    const translated = ioc<I18nProvider>(I18N_IOC_KEY)?.t(k)
    return translated && translated !== k ? translated : undefined
  }

  // ── mouse/trackpad gesture (tutorial basics) ─────────────────────────
  #fromGesture(id: string, key: string, label: string): ActionCardPayload | null {
    const spec = GESTURE_CARDS[id]
    if (!spec) return null
    return {
      label,
      cmd: key,
      kind: 'gesture',
      category: id === 'more' ? '' : 'Basics',
      description: this.#t(spec.description),
      steps: spec.steps.map(step => step.map(part => this.#t(part))),
      detail: spec.detail ? this.#t(spec.detail) : undefined,
    }
  }

  // ── keyboard action ──────────────────────────────────────────────────
  #fromBinding(cmd: string, label: string): ActionCardPayload | null {
    const binding = ioc<KeyMapLike>('@diamondcoreprocessor.com/KeyMapService')
      ?.getEffective?.()?.find(b => b.cmd === cmd)
    if (!binding) return null
    // i18n.t returns the KEY itself when untranslated — same guard as
    // SlashBehaviourDrone's #localize.
    let description = binding.description ?? ''
    if (binding.descriptionKey) {
      const translated = ioc<I18nProvider>(I18N_IOC_KEY)?.t(binding.descriptionKey)
      if (translated && translated !== binding.descriptionKey) description = translated
    }
    return {
      label,
      cmd,
      kind: 'key',
      category: binding.category ?? '',
      description,
      steps: (binding.sequence ?? []).map(ch => formatChord(ch)),
      detail: this.#detail(cmd),
    }
  }

  // ── slash behaviour ──────────────────────────────────────────────────
  // The STANDARD source is the author's structured fields (QueenBee.options /
  // .examples, riding through the auto-wrap). Legacy behaviours that still
  // embed a "what it does; option | option" tail in the description fall back
  // to parsing it — and the tail is ALWAYS stripped from the shown text, so a
  // migrated behaviour whose translation still carries one never shows it
  // twice. entries() already localizes.
  #fromSlash(name: string, key: string, label: string): ActionCardPayload | null {
    const entry = ioc<SlashDroneLike>('@diamondcoreprocessor.com/SlashBehaviourDrone')
      ?.entries?.()?.find(b => b.name === name)
    if (!entry) return null
    let description = entry.description ?? ''
    let tailParams: string[] = []
    const cut = description.lastIndexOf(';')
    if (cut > -1) {
      const tail = description.slice(cut + 1)
      if (tail.includes('|')) {
        tailParams = tail.split('|').map(s => s.trim()).filter(Boolean)
        description = description.slice(0, cut).trim()
      }
    }
    const options = Array.isArray(entry.options) && entry.options.length
      ? entry.options.map(String)
      : tailParams
    const examples = (entry.examples ?? [])
      .filter(e => e && typeof e.input === 'string' && typeof e.result === 'string')
      .map(e => ({ input: e.input, result: e.result }))
    return {
      label,
      cmd: key,
      kind: 'slash',
      category: 'Slash',
      description,
      steps: [],
      usage: `/${name}`,
      params: options,
      aliases: (entry.aliases ?? []).map(a => `/${a}`),
      examples: examples.length ? examples : undefined,
      detail: this.#detail(key),
    }
  }

  // ── command-line input behavior ──────────────────────────────────────
  #fromCli(name: string, key: string, label: string): ActionCardPayload | null {
    const meta = ioc<CliMetaLike>('@hypercomb.social/CommandLineBehaviors')?.find(b => b.name === name)
    if (!meta) return null
    const ops: ActionCardOp[] = (meta.operations ?? []).map(op => {
      const ex = op.examples?.[0]
      return {
        trigger: op.trigger ?? '',
        description: op.description ?? '',
        example: (ex && typeof ex.input === 'string' && typeof ex.result === 'string')
          ? { input: ex.input, result: ex.result }
          : undefined,
      }
    }).filter(o => o.description)
    if (ops.length === 0) return null
    return {
      label,
      cmd: key,
      kind: 'cli',
      category: 'Command Line',
      description: '',
      steps: [],
      ops,
      detail: this.#detail(key),
    }
  }
}

const _actionCard = new ActionCardDrone()
;(window as { ioc?: { register?: (k: string, v: unknown) => void } }).ioc?.register?.(
  '@diamondcoreprocessor.com/ActionCardDrone',
  _actionCard,
)
