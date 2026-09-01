// hypercomb-shared/ui/text-scale/text-scale.component.ts
//
// TEXT SIZE, for a surface that is not a docked panel.
//
// Tool windows already carry this control: the gear in `hcDockedPanel` offers
// the TEXT_SIZES ladder and lands the pick on `--hc-panel-scale`, which every
// panel's SCSS sizes off. Two surfaces read for a living and never got it,
// because neither is a docked panel — the command line's completion list and
// the tile editor. This is that same setting, in the same vocabulary, on the
// same record, for surfaces with their own chrome.
//
// Deliberately NOT a second mechanism: the ladder, the storage key, and the
// CSS var all come from panel-groups.ts. A window id here is a window id
// there, so a surface listed in both places would agree with itself, and the
// app has ONE answer to "how big is the text".
//
// `auto` is not offered. For a docked panel Auto means "derive it from the
// window's width", which is a promise neither of these surfaces can keep — a
// dropdown is sized by its content and the editor is a fixed dialog. A ladder
// entry that does nothing is worse than an absent one, so the choice here is
// the four real sizes and `normal` is the default.

import { Component, computed, input, output, signal } from '@angular/core'
import { TranslatePipe } from '../../core/i18n.pipe'
import { TEXT_SIZES, readTextScale, writeTextScale } from '../docked-panel/panel-groups'

/** The ladder minus `auto` — see the header note. */
export const SURFACE_TEXT_SIZES = TEXT_SIZES.filter(s => s.scale !== null) as
  readonly { key: string; label: string; scale: number }[]

/** What a surface renders at when the participant has never chosen. */
export const DEFAULT_SURFACE_SCALE = 1

/** The stored scale for `window`, clamped onto the offered ladder. A record
 *  written by a docked panel (which may hold `auto`, or a scale this ladder
 *  does not list) resolves to the nearest offered step rather than to
 *  nothing — the two settings are the same setting. */
export const surfaceScale = (window: string): number => {
  const stored = readTextScale(window)
  if (stored == null) return DEFAULT_SURFACE_SCALE
  let best = SURFACE_TEXT_SIZES[0]
  for (const size of SURFACE_TEXT_SIZES) {
    if (Math.abs(size.scale - stored) < Math.abs(best.scale - stored)) best = size
  }
  return best.scale
}

/** Move `scale` one step along the ladder and persist it. Returns the new
 *  scale — the keyboard path (Ctrl +/-) for surfaces with no room for chrome. */
export const stepSurfaceScale = (window: string, direction: 1 | -1): number => {
  const current = surfaceScale(window)
  const at = SURFACE_TEXT_SIZES.findIndex(s => s.scale === current)
  const next = SURFACE_TEXT_SIZES[
    Math.max(0, Math.min(SURFACE_TEXT_SIZES.length - 1, (at < 0 ? 1 : at) + direction))
  ]
  writeTextScale(window, next.scale)
  return next.scale
}

@Component({
  selector: 'hc-text-size',
  standalone: true,
  imports: [TranslatePipe],
  templateUrl: './text-scale.component.html',
  styleUrls: ['./text-scale.component.scss'],
})
export class TextScaleComponent {

  /** The record this control reads and writes — the same window id a docked
   *  panel would use, so the two never mint separate settings for one surface. */
  readonly window = input.required<string>()

  /** The chosen scale, emitted on every pick AND once on adoption, so the host
   *  can set `--hc-panel-scale` without reading storage itself. */
  readonly scaleChange = output<number>()

  readonly sizes = SURFACE_TEXT_SIZES

  readonly #picked = signal<number | null>(null)

  /** Is the ladder showing? Closed is a lone gear — the setting is reached,
   *  not permanently on display beside the thing it sizes. */
  readonly open = signal(false)

  toggle(): void { this.open.update(v => !v) }

  readonly scale = computed(() => this.#picked() ?? surfaceScale(this.window()))

  pick(scale: number): void {
    this.#picked.set(scale)
    writeTextScale(this.window(), scale)
    this.scaleChange.emit(scale)
  }
}
