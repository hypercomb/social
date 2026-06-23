// hypercomb-shared/ui/apply-update-prompt/apply-update-prompt.component.ts
//
// In-place "Apply update" prompt for hypercomb.io. Opens when the participant
// clicks the header "New features" indicator. Instead of jumping to the DCP
// installer iframe (which only adopts CONTENT branches — it has no surface for
// the shell's code package, so a feature/code update showed "nothing" there),
// it presents the deployed update RIGHT HERE: a honeycomb cluster sized to the
// number of new features, the version/date parsed from the deploy label, and a
// one-line summary — so the participant SEES what's arriving before applying.
//
// [Apply update] fires the existing `hypercomb:apply-update` window event that
// the web shell already binds to upgradeFromBundled() + reload (the origin
// fetches its own bundled /content/ bytes — the mesh is only the messenger; no
// new install pathway is introduced here). [Not now] dismisses; the indicator
// stays visible so the participant can return. We're in alpha and the eggs
// (negative-cache + render guards) protect the canvas, so Apply installs
// straight away — there is no per-feature opt-in gate.
//
// Mirrors confirm-dialog.component.ts: standalone, signal-driven, EffectBus
// open + keymap:invoke escape, a #processedIds replay guard, and NO InputGate
// lock (a transient prompt that leads to reload, not a durable panel). Mounted
// in BOTH the web and dev shells for parity; on dev there is no bundled
// /content/ to diff, so `update:available` never fires and this never opens.

import { Component, computed, ElementRef, inject, signal, type OnDestroy, type OnInit } from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'

/** Payload of `update:apply-prompt:open`, emitted by the upgrade indicator from
 *  the `update:available` data it already holds. */
interface ApplyPromptPayload {
  newCount?: number
  newBees?: string[]
  packageSig?: string
  previous?: string | null
  label?: string
}

// A tidy hexagonal cluster — rows 3-4-5-4-3 = 19 cells, a complete hexagon a
// typical multi-feature deploy fills. The comb is drawn exactly as big as the
// update (truncated to the new-feature count) and caps at one cluster; the
// count line always carries the TRUE number, so a larger update stays accurate
// in text while the visual stays calm (no faux progress scaffold).
const ROWS = [3, 4, 5, 4, 3] as const
const CAP = ROWS.reduce((sum, n) => sum + n, 0)   // 19
const HEX_BOX = 22    // bounding box of one hex, in viewBox units
const ROW_STEP = 17   // vertical nesting step (< HEX_BOX so rows interlock)

interface HexCell { readonly i: number; readonly points: string }

/** Flat-top hexagon polygon points for a HEX_BOX cell at (x, y) — the project's
 *  shape-hexagon proportions (25 / 75 / 100 / 50). */
function hexPoints(x: number, y: number): string {
  const b = HEX_BOX, h = HEX_BOX / 2
  return `${x + b * 0.25},${y} ${x + b * 0.75},${y} ${x + b},${y + h} `
       + `${x + b * 0.75},${y + b} ${x + b * 0.25},${y + b} ${x},${y + h}`
}

/** Lay out `filled` hexes as a centered honeycomb cluster. Centering each row
 *  to the widest row produces the classic half-hex interlock for free. */
function layoutComb(filled: number): { cells: HexCell[]; viewBox: string } {
  const rowCounts: number[] = []
  let remaining = filled
  for (const w of ROWS) {
    if (remaining <= 0) break
    rowCounts.push(Math.min(w, remaining))
    remaining -= rowCounts[rowCounts.length - 1]
  }
  const maxW = rowCounts.length ? Math.max(...rowCounts) : 1
  const cells: HexCell[] = []
  let i = 0
  rowCounts.forEach((c, r) => {
    const xOffset = (maxW - c) * HEX_BOX / 2   // centre row → natural interlock
    const y = r * ROW_STEP
    for (let col = 0; col < c; col++) {
      cells.push({ i: i++, points: hexPoints(xOffset + col * HEX_BOX, y) })
    }
  })
  const width = maxW * HEX_BOX
  const height = (Math.max(1, rowCounts.length) - 1) * ROW_STEP + HEX_BOX
  return { cells, viewBox: `-1 -1 ${width + 2} ${height + 2}` }
}

@Component({
  selector: 'hc-apply-update-prompt',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './apply-update-prompt.component.html',
  styleUrls: ['./apply-update-prompt.component.scss'],
})
export class ApplyUpdatePromptComponent implements OnInit, OnDestroy {

  readonly open = signal(false)
  readonly count = signal(0)
  readonly #label = signal('')

  #packageSig = ''
  // Packages already applied this session — guards EffectBus last-value replay
  // from re-opening the prompt after the participant committed (confirm-dialog
  // pattern). Only confirm() adds here; a dismiss must leave it re-openable.
  readonly #processedIds = new Set<string>()

  #unsubOpen: (() => void) | null = null
  #unsubEscape: (() => void) | null = null

  // Host element — used to focus the primary action after the panel renders.
  // (A `viewChild` query can't be used: Angular forbids signal queries on the
  // project's mandated `#private` fields, so we query the host DOM instead.)
  readonly #host = inject(ElementRef) as ElementRef<HTMLElement>

  // Honeycomb sized to the update, capped at one full cluster.
  readonly #comb = computed(() => layoutComb(Math.min(this.count(), CAP)))
  readonly hexCells = computed(() => this.#comb().cells)
  readonly combViewBox = computed(() => this.#comb().viewBox)

  // Version + date parsed from the deploy label ("main-updated-<ISO>-updated-…").
  readonly #base = computed(() => {
    const label = this.#label()
    return label ? (label.split('-updated-')[0] || '') : ''
  })
  readonly #date = computed(() => {
    const parts = this.#label().split('-updated-')
    if (parts.length < 2) return ''
    const d = new Date(parts[parts.length - 1])
    if (isNaN(d.getTime())) return ''
    // Format in the app's chosen locale (not the browser's) so the date reads
    // consistently with the rest of the prompt. Resolved at open via window.ioc
    // — shared must never import from modules. Recomputes on open (#label changes).
    const i18n = (window as { ioc?: { get?: (k: string) => unknown } }).ioc?.get?.('@hypercomb.social/I18n') as { locale?: string } | undefined
    try { return d.toLocaleDateString(i18n?.locale ?? undefined, { year: 'numeric', month: 'short', day: 'numeric' }) }
    catch { return parts[parts.length - 1].slice(0, 10) }
  })
  /** Faint "<branch> · <date>" line. Branch is a proper noun and the date is
   *  locale-formatted, so this is data (no i18n key needed). */
  readonly versionLine = computed(() => {
    const base = this.#base(), date = this.#date()
    if (base && date) return `${base} · ${date}`
    return base || date || ''
  })

  ngOnInit(): void {
    this.#unsubOpen = EffectBus.on<ApplyPromptPayload>('update:apply-prompt:open', (p) => {
      const sig = String(p?.packageSig ?? '')
      // Already applied this package (replay after confirm) — stay closed.
      if (sig && this.#processedIds.has(sig)) return
      this.#packageSig = sig
      this.count.set(p?.newCount ?? 0)
      this.#label.set(p?.label ?? '')
      this.open.set(true)
      // Focus the primary action once the @if-driven panel renders, so Enter
      // applies and Shift+Tab reaches "Not now". Deferred a macrotask so the
      // DOM exists after the signal-driven change detection flushes.
      setTimeout(() => {
        if (this.open()) this.#host.nativeElement.querySelector<HTMLButtonElement>('.au-btn.apply')?.focus()
      }, 0)
    })
    this.#unsubEscape = EffectBus.on<{ cmd: string }>('keymap:invoke', (p) => {
      if (p?.cmd === 'global.escape' && this.open()) this.dismiss()
    })
  }

  ngOnDestroy(): void {
    this.#unsubOpen?.()
    this.#unsubEscape?.()
  }

  /** Apply — fire the existing window event the web shell binds to
   *  upgradeFromBundled() + reload, and mark the package processed so a
   *  last-value replay can't re-open the prompt. The shell guards re-entry,
   *  so a double-click cannot double-install. */
  readonly confirm = (): void => {
    if (this.#packageSig) this.#processedIds.add(this.#packageSig)
    window.dispatchEvent(new CustomEvent('hypercomb:apply-update'))
    this.open.set(false)
  }

  /** Dismiss — close and clear, but do NOT mark processed: clicking the
   *  indicator again must be able to re-open this prompt. */
  readonly dismiss = (): void => {
    this.open.set(false)
    this.count.set(0)
    this.#label.set('')
  }
}
