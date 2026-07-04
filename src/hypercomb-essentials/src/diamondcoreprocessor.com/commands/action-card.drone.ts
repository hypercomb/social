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
// THREE kinds of help tile, resolved by the member key's shape:
//   <keymap cmd>   — a keyboard action: shortcut steps, category, description
//   slash:<name>   — a typed /command: usage, parameter options (the curated
//                    "; a | b | c" tail of its description), aliases
//   cli:<name>     — a command-line input behavior: every operation with its
//                    trigger and a worked example (input → result)
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

/** What the shell card renders. `steps` = one entry per keymap sequence step,
 *  each a list of formatted key parts ("Ctrl", "Shift", "8") for pills. */
export interface ActionCardPayload {
  label: string
  cmd: string
  kind: 'key' | 'slash' | 'cli'
  category: string
  description: string
  steps: string[][]
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
    if (!seg.startsWith('agg-') && !ioc<{ get?: (id: string) => unknown }>('@hypercomb.social/GroupLauncher')?.get?.(seg)) return null
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
    if (key.startsWith('slash:')) return this.#fromSlash(key.slice(6), key, label)
    if (key.startsWith('cli:')) return this.#fromCli(key.slice(4), key, label)
    return this.#fromBinding(key, label)
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
    }
  }
}

const _actionCard = new ActionCardDrone()
;(window as { ioc?: { register?: (k: string, v: unknown) => void } }).ioc?.register?.(
  '@diamondcoreprocessor.com/ActionCardDrone',
  _actionCard,
)
