// diamondcoreprocessor.com/commands/tutor.queen.ts
//
// `/tutor` — the study-games view behaviour, the tutor analogue of
// `/website`. Turn the hive into a deck of study games. The render surface
// is a SINGLE GLOBAL flag (ViewModeService): `/tutor on` switches to study
// view wherever the current cell has a deck, `/tutor off` returns to
// hexagons, bare `/tutor` toggles. `/tutor here` is different: it drops a
// build-intent marker (`visual:tutor:pending`) on the current cell for the
// next generation pass to turn into a deck — it never flips the surface.
//
// Syntax:
//   /tutor                      — toggle hexagons ↔ study view (global)
//   /tutor on | study | view    — switch to study view
//   /tutor off | hex | hexagons — switch to hexagons view
//   /tutor here | mark          — flag THIS cell for the next deck-gen pass
//                                 (re-run to unflag)
//   /tutor build | upgrade      — request a deck-generation pass (emits
//                                 tutor:build; run the tutor-build skill /
//                                 _tutor-deck.cjs to produce decks)
//   /tutor list                 — the gen queue: cells flagged with /tutor here
//
// The deck itself lives in the cell's `tutor` slot (see tutor-slot.ts); a
// `visual:tutor:deck` decoration mirrors it so the ViewBee toggle appears.

import { QueenBee, EffectBus } from '@hypercomb/core'
import type { VisualBeeRegistry } from '../commands/visual-bee-registry.js'
import { writeDecoration, listDecorations, removeDecoration } from '../commands/decoration-manifest.js'
// Anchor the tutor slot registration against tree-shaking (also imported by
// the render drone; registration is idempotent).
import './tutor-slot.js'

/** Build-intent marker — `/tutor here` drops this; the gen pass replaces it with a deck. */
export const TUTOR_PENDING_KIND = 'visual:tutor:pending'

const get = <T,>(key: string): T | undefined => (window as { ioc?: { get?: (k: string) => T } }).ioc?.get?.(key)

const STUDY_KEYWORDS = new Set(['on', 'study', 'view', 'open', 'go'])
const HEX_KEYWORDS = new Set(['off', 'hex', 'hexagons', 'hexagon', 'close'])

type ViewModeShape = { mode: string; setMode(next: string): void }
type LineageShape = { explorerSegments?: () => readonly string[] }

export class TutorQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'tutor'
  override readonly aliases = ['study']
  override description = 'Study games — turn this hive into spaced-repetition games'
  override descriptionKey = 'slash.tutor'
  override options = ['on', 'off', 'here', 'build', 'list']
  override examples = [{ input: '/tutor here', result: 'Opens study games for the current cell' }]

  override slashComplete(args: string): readonly string[] {
    const q = args.trim().toLowerCase()
    return ['on', 'off', 'here', 'build', 'list'].filter(o => o.startsWith(q))
  }

  protected async execute(args: string): Promise<void> {
    const a = args.trim().toLowerCase()

    if (a === 'here' || a === 'mark') { await this.#markHere(); return }
    if (a === 'list') { await this.#list(); return }
    if (a === 'build' || a === 'upgrade' || a === 'new') {
      const segments = this.#segments()
      EffectBus.emit('tutor:build', { segments })
      this.#log('Tutor — run the tutor-build skill (or scripts/bridge/_tutor-deck.cjs) to generate decks', '🎓')
      return
    }

    const vm = get<ViewModeShape>('@hypercomb.social/ViewMode')
    if (!vm) { this.#log('Tutor view unavailable'); return }

    if (STUDY_KEYWORDS.has(a)) { vm.setMode('tutor'); this.#log('Study view — on', '🎓'); return }
    if (HEX_KEYWORDS.has(a)) { vm.setMode('hexagons'); this.#log('Study view — off', '○'); return }

    // Bare /tutor (or 'toggle') — flip.
    const next = vm.mode === 'tutor' ? 'hexagons' : 'tutor'
    vm.setMode(next)
    this.#log(next === 'tutor' ? 'Study view — on' : 'Study view — off', next === 'tutor' ? '🎓' : '○')
  }

  #segments(): string[] {
    const lineage = get<LineageShape>('@hypercomb.social/Lineage')
    return (lineage?.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
  }

  /** Flag the current cell for the next deck-gen pass; re-run clears it. */
  async #markHere(): Promise<void> {
    const segments = this.#segments()
    const where = segments.length ? `/${segments.join('/')}` : '/'
    try {
      const existing = await listDecorations({ kind: TUTOR_PENDING_KIND, segments })
      if (existing.length) {
        for (const e of existing) removeDecoration({ sig: e.sig, segments })
        this.#log(`Tutor — ${where} removed from the next gen pass`, '○')
        return
      }
      await writeDecoration({
        kind: TUTOR_PENDING_KIND,
        appliesTo: segments,
        segments,
        payload: { requestedAt: Date.now() },
        mark: 'persistent',
      })
      this.#log(`Tutor — ${where} flagged; run /tutor build to generate its deck`, '🎓')
    } catch (err) {
      console.warn('[/tutor here] failed', err)
      this.#log('Tutor — could not flag this cell (see console)')
    }
  }

  /** Report whether the current cell is flagged with `/tutor here`. A
   *  hive-wide queue scan is the generation enumerator's job (the
   *  tutor-build skill walks the whole tree); this checks the cell in view. */
  async #list(): Promise<void> {
    const segments = this.#segments()
    const where = segments.length ? `/${segments.join('/')}` : '/'
    try {
      const pending = await listDecorations({ kind: TUTOR_PENDING_KIND, segments })
      const deck = await listDecorations({ kind: 'visual:tutor:deck', segments })
      if (deck.length) { this.#log(`Tutor — ${where} has a study deck; toggle /tutor to play`, '🎓'); return }
      if (pending.length) { this.#log(`Tutor — ${where} is flagged; run /tutor build to generate its deck`, '🎓'); return }
      this.#log(`Tutor — ${where} has no deck. /tutor here to flag it, then /tutor build`, '🎓')
    } catch (err) {
      console.warn('[/tutor list] failed', err)
    }
  }

  #log(message: string, icon = '🎓'): void {
    EffectBus.emit('activity:log', { message, icon })
  }
}

const _tutor = new TutorQueenBee()
window.ioc.register('@diamondcoreprocessor.com/TutorQueenBee', _tutor)

// Visual-bee registration — declares the view identity so the renderer +
// ViewBee toggle + adoption UI can discover the tutor behaviour. The toggle
// surfaces on any cell carrying a `visual:tutor:deck` decoration; clicking
// it flips ViewMode (hexagons ⇄ tutor). Decoration writes are handled by the
// generation pass via the bridge.
;(window as { ioc?: { whenReady?: <T>(k: string, cb: (v: T) => void) => void } }).ioc?.whenReady?.<VisualBeeRegistry>(
  '@diamondcoreprocessor.com/VisualBeeRegistry',
  (registry) => {
    registry.register({
      view: 'tutor',
      slashCommand: '/tutor',
      iconName: 'tutor',
      toggleIcon: 'school',
      behavior: 'render',
      // First-class home: the toggle surfaces from a non-empty `tutor` slot
      // (an array of study-item signatures). `decorationKind` is kept for the
      // registry contract / future adoption, but no decoration is written —
      // ViewBee reads the slot directly.
      slot: 'tutor',
      decorationKind: 'visual:tutor:deck',
      labelKey: 'view.tutor',
      descriptionKey: 'view.tutor.description',
      queenKey: '@diamondcoreprocessor.com/TutorQueenBee',
      adoptable: true,
    })
  },
)
