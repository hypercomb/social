// questions/tutorial.drone.ts
//
// `start tutorial` — the explanation plays itself, then the room plays
// (jwize, 2026-10-24: "start q and a and then the member can join and then we
// all go together … we need the full explanation auto play and then continue
// from the completion, playing").
//
// Said where nobody leads one, it LEADS: a Hypercomb Q and A begins where you
// stand (questions.service.ts `startGame`, so the room joins with the door's
// Join — the follow the game already has), the explanation is laid out on a
// `tutorial` tile here (only what is missing; a tile already there is kept),
// and the walk plays it once, page by page (navigation/walk.queen.ts `play`),
// the first page longer so the room can tap Join. When the last page is done
// you are walked back and into this page's questions — and everyone who
// follows you comes along: the game is on.
//
// Said where someone else leads, it JOINS: you follow them, so their
// tutorial carries you. `walk stop` ends the explanation early and opens
// nothing.
//
// What it says is data (tutorial.ts). Registration is the bee's act.

import { Drone, EffectBus, I18N_IOC_KEY, hypercomb, type I18nProvider } from '@hypercomb/core'
import { readChildrenStrict, type PlacementHistory } from '../history/layer-placement.js'
import { QUESTIONS_KEY } from './questions.js'
import type { Questions, StartOutcome } from './questions.service.js'
import { TUTORIAL_FIRST_SECONDS, TUTORIAL_HIVE, TUTORIAL_NAME, TUTORIAL_SECONDS, tutorialStops, tutorialTiles } from './tutorial.js'

const get = <T>(key: string): T | undefined =>
  (window as { ioc?: { get?: <V>(k: string) => V | undefined } }).ioc?.get?.<T>(key)

type StartShape = {
  register(name: string, start: () => Promise<StartOutcome>, say?: (outcome: StartOutcome, game: string) => string): void
}
type WalkShape = { play(stops: readonly (readonly string[])[], seconds: number, firstSeconds?: number): Promise<boolean> }
type DecorationShape = { setTitle?: (segments: readonly string[], text: string, locale: string) => Promise<string> }
type LineageShape = { explorerSegments?: () => readonly string[]; domain?: unknown }
type NavigationShape = { replaceRaw?: (segments: readonly string[]) => void }
type CommitterShape = { settled?: () => Promise<void> }

export class TutorialDrone extends Drone {
  readonly namespace = 'diamondcoreprocessor.com'
  override description = 'start tutorial — leads a Hypercomb Q and A where you stand, plays the explanation once with everyone who joined, then walks the room into the questions'

  protected override emits = ['cell:added', 'activity:log', 'toast:show']

  /** How long a page lasts, and the first page (the room taps Join). */
  seconds = TUTORIAL_SECONDS
  firstSeconds = TUTORIAL_FIRST_SECONDS
  /** True while the explanation plays from this hive. */
  playing = false

  constructor() {
    super()
    window.ioc.whenReady<StartShape>('@diamondcoreprocessor.com/StartQueenBee', (start) => {
      start.register(TUTORIAL_NAME, () => this.start(), (result, game) => {
        const host = get<Questions>(QUESTIONS_KEY)?.door().hostLabel ?? ''
        const params = { game, where: result.where || '/', host, seconds: this.seconds }
        return result.outcome === 'joined'
          ? this.#t('questions.tutorial.joined', `you joined the tutorial — you follow ${host}, and the explanation carries you`, params)
          : this.#t('questions.tutorial.started', `the tutorial started at /${params.where} — the room taps Join to come along; the explanation plays itself, a page every ${this.seconds} s, then the questions open`, params)
      })
    })
  }

  /** Lead the tutorial here, or join the one someone else leads. */
  async start(): Promise<StartOutcome> {
    const questions = get<Questions>(QUESTIONS_KEY)
    if (!questions) return { outcome: 'resumed', where: this.#segments().join('/') }
    const result = await questions.startGame(TUTORIAL_HIVE)
    if (result.outcome === 'joined') return result
    const at = result.where ? result.where.split('/').filter(Boolean) : []
    await this.#layOut(at)
    void this.#play(at)
    return result
  }

  /** Make every tile of the explanation that is not there yet, page by page,
   *  and give each its title. */
  async #layOut(at: readonly string[]): Promise<void> {
    const tiles = tutorialTiles(at)
    const pages = new Map<string, { page: string[]; names: string[] }>()
    for (const t of tiles) {
      const key = t.page.join('/')
      if (!pages.has(key)) pages.set(key, { page: t.page, names: [] })
      pages.get(key)!.names.push(t.name)
    }
    for (const { page, names } of pages.values()) {
      const held = new Set((await this.#children(page)) ?? [])
      const missing = names.filter(n => !held.has(n))
      if (!missing.length) continue
      for (const cell of missing) EffectBus.emit('cell:added', { cell, segments: [...page] })
      await new hypercomb().act()
      await this.#settled()
    }
    const decorations = get<DecorationShape>('@diamondcoreprocessor.com/DecorationService')
    for (const t of tiles) {
      try { await decorations?.setTitle?.([...t.page, t.name], t.title, 'en') } catch { /* untitled: draws its name */ }
    }
    await this.#settled()
  }

  async #play(at: readonly string[]): Promise<void> {
    const walk = get<WalkShape>('@diamondcoreprocessor.com/WalkQueenBee')
    if (!walk) return
    this.playing = true
    try {
      const done = await walk.play(tutorialStops(at), this.seconds, this.firstSeconds)
      if (!done) return
      get<NavigationShape>('@hypercomb.social/Navigation')?.replaceRaw?.(at)
      for (let i = 0; i < 30 && this.#segments().join('/') !== at.join('/'); i++) await new Promise(r => setTimeout(r, 100))
      await get<Questions>(QUESTIONS_KEY)?.openQuestions()
      this.#say(this.#t('questions.tutorial.done', 'the tutorial is done — everyone is in the questions: ask, answer, take the answers you like; `tally` scores them'))
    } finally {
      this.playing = false
    }
  }

  async #children(segments: readonly string[]): Promise<string[] | null> {
    const history = get<PlacementHistory>('@diamondcoreprocessor.com/HistoryService')
    const lineage = get<LineageShape>('@hypercomb.social/Lineage')
    if (!history || !lineage) return null
    try { return (await readChildrenStrict(history, lineage.domain, segments))?.map(r => r.name) ?? null } catch { return null }
  }

  async #settled(): Promise<void> {
    try { await get<CommitterShape>('@diamondcoreprocessor.com/LayerCommitter')?.settled?.() } catch { /* unacknowledged: proceed */ }
  }

  #segments(): string[] {
    const lineage = get<LineageShape>('@hypercomb.social/Lineage')
    return (lineage?.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
  }

  #t(key: string, fallback: string, params?: Record<string, string | number>): string {
    const value = get<I18nProvider>(I18N_IOC_KEY)?.t?.(key, params)
    return value && value !== key ? value : fallback
  }

  #say(message: string): void {
    EffectBus.emit('activity:log', { message, icon: '✦' })
    EffectBus.emit('toast:show', { type: 'success', message })
  }
}

const _tutorial = new TutorialDrone()
window.ioc.register('@diamondcoreprocessor.com/TutorialDrone', _tutorial)
