// navigation/walk.queen.ts
//
// `walk` — the page you stand on walks itself (jwize, 2026-10-24: "an active
// tutorial for the follow session … then we just leave it on").
//
//   walk                walk this page and every page beneath it, a stop
//                       every 45 seconds, round and round
//   walk every <s>      the same, a stop every <s> seconds (10–600)
//   walk stop           stop walking; you stay where you are
//
// A stop is a page: the root, then each tile beneath it that holds tiles of
// its own, depth first in the order the tiles stand (walk.ts). After the last
// stop the walk starts again where it began, reading the route afresh, so a
// page added while it walks is visited next round.
//
// `play(stops, …)` is the same walk through stops someone else chose, ONCE:
// it answers true when the last stop is done, false when another walk or
// `walk stop` ended it first. `start tutorial` plays its explanation this way
// (questions/tutorial.drone.ts).
//
// The walk is only your own navigation. Whoever follows you (the follow
// button in the presence list, or a game's Join) is moved with you by the
// follow mechanism unchanged (sharing/follow.drone.ts) — so a hive left
// walking a branch is a tour anyone in the room can take. Nothing is written,
// and each step replaces the place in the browser's history rather than
// adding one, so a walk left on for hours leaves Back as it found it.

import { QueenBee, EffectBus, I18N_IOC_KEY, type I18nProvider, type MachineGrammar } from '@hypercomb/core'
import { readChildrenStrict, type PlacementHistory } from '../history/layer-placement.js'
import { parseWalk, walkRoute } from './walk.js'

const get = <T>(key: string): T | undefined =>
  (window as { ioc?: { get?: <V>(k: string) => V | undefined } }).ioc?.get?.<T>(key)

type NavigationShape = { replaceRaw?: (segments: readonly string[]) => void; goRaw?: (segments: readonly string[]) => void }
type LineageShape = { explorerSegments?: () => readonly string[]; domain?: unknown }

export class WalkQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  override genotype = 'navigation'
  readonly command = 'walk'
  override description = 'Walk this page and every page beneath it on its own, round and round — whoever follows you comes along'
  override descriptionKey = 'slash.walk'
  override options = ['every <seconds>', 'stop']
  override examples = [
    { input: '/walk', result: 'Walks this page and every page beneath it, a stop every 45 seconds' },
    { input: '/walk every 30', result: 'The same, a stop every 30 seconds' },
    { input: '/walk stop', result: 'Stops walking — you stay where you are' },
  ]
  override machine: MachineGrammar = {
    forms: '| every <seconds> | stop',
    example: 'walk',
    bare: true,
    // additive at the local scope, like `go`: it moves where you stand and
    // writes nothing.
    reach: 'additive',
    scope: 'local',
  }

  #timer: ReturnType<typeof setTimeout> | null = null
  /** Wakes a stop that is waiting, saying whether the walk goes on. */
  #wake: ((goOn: boolean) => void) | null = null
  /** Bumped by every start and stop, so a step left over from an earlier
   *  walk does nothing. */
  #run = 0
  #walking: { root: readonly string[]; seconds: number } | null = null

  /** Where the walk began and how long a stop lasts, or null when not walking. */
  walking(): { root: readonly string[]; seconds: number } | null { return this.#walking }

  /** Walk `stops` once, `seconds` a stop (`firstSeconds` the first). True when
   *  the last stop is done; false when another walk or `walk stop` ends it. */
  async play(stops: readonly (readonly string[])[], seconds: number, firstSeconds = seconds): Promise<boolean> {
    this.#stop()
    const run = this.#run
    this.#walking = { root: [...(stops[0] ?? [])], seconds }
    const done = await this.#round(run, stops, seconds * 1000, firstSeconds * 1000)
    if (done && run === this.#run) this.#walking = null
    return done
  }

  override slashComplete(args: string): readonly string[] {
    const typed = args.trim().toLowerCase()
    return ['every ', 'stop'].filter(o => o.startsWith(typed) && o.trim() !== typed)
  }

  protected async execute(args: string): Promise<void> {
    const word = parseWalk(args)
    if (word.verb === 'refuse') {
      this.#say(this.#t('walk.refused', 'walk takes `every <seconds>` or `stop`'), 'warning')
      return
    }
    if (word.verb === 'stop') {
      const was = this.#stop()
      this.#say(was
        ? this.#t('walk.stopped', 'the walk stopped — you stay here')
        : this.#t('walk.idle', 'you are not walking — `walk` starts one here'))
      return
    }
    const root = this.#segments()
    this.#stop()
    const run = this.#run
    let route = await this.#route(root)
    if (run !== this.#run) return
    this.#walking = { root, seconds: word.seconds }
    const page = root.length ? root.join(' / ') : this.#t('walk.home', 'home')
    this.#say(this.#t('walk.started', `walking ${page} — ${route.length} stops, one every ${word.seconds} s. \`walk stop\` ends it`,
      { page, stops: route.length, seconds: word.seconds }), 'success')
    const ms = word.seconds * 1000
    while (await this.#round(run, route, ms, ms)) {
      route = await this.#route(root)
      if (run !== this.#run) return
    }
  }

  /** One pass through `stops`; false as soon as the walk is ended. */
  async #round(run: number, stops: readonly (readonly string[])[], ms: number, firstMs: number): Promise<boolean> {
    for (let i = 0; i < stops.length; i++) {
      if (run !== this.#run) return false
      this.#goTo(stops[i])
      if (!(await this.#wait(run, i === 0 ? firstMs : ms))) return false
    }
    return run === this.#run
  }

  #goTo(stop: readonly string[]): void {
    const here = this.#segments()
    if (stop.length === here.length && stop.every((s, i) => s === here[i])) return
    const nav = get<NavigationShape>('@hypercomb.social/Navigation')
    if (nav?.replaceRaw) nav.replaceRaw(stop)
    else nav?.goRaw?.(stop)
  }

  #wait(run: number, ms: number): Promise<boolean> {
    return new Promise(resolve => {
      this.#wake = resolve
      this.#timer = setTimeout(() => {
        this.#timer = null
        this.#wake = null
        resolve(run === this.#run)
      }, ms)
    })
  }

  /** Ends the walk in hand; true when there was one. */
  #stop(): boolean {
    this.#run++
    if (this.#timer) { clearTimeout(this.#timer); this.#timer = null }
    const wake = this.#wake
    this.#wake = null
    wake?.(false)
    const was = !!this.#walking
    this.#walking = null
    return was
  }

  async #route(root: readonly string[]): Promise<string[][]> {
    const history = get<PlacementHistory>('@diamondcoreprocessor.com/HistoryService')
    const lineage = get<LineageShape>('@hypercomb.social/Lineage')
    if (!history || !lineage) return [[...root]]
    return walkRoute(async segments => {
      try { return await readChildrenStrict(history, lineage.domain, segments) } catch { return null }
    }, root)
  }

  #segments(): string[] {
    const lineage = get<LineageShape>('@hypercomb.social/Lineage')
    return (lineage?.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
  }

  #t(key: string, fallback: string, params?: Record<string, string | number>): string {
    const value = get<I18nProvider>(I18N_IOC_KEY)?.t?.(key, params)
    return value && value !== key ? value : fallback
  }

  #say(message: string, type = 'info'): void {
    EffectBus.emit('activity:log', { message, icon: '👣' })
    EffectBus.emit('toast:show', { type, message })
  }
}

const _walk = new WalkQueenBee()
window.ioc.register('@diamondcoreprocessor.com/WalkQueenBee', _walk)
