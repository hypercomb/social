// hypercomb-shared/ui/text-scale/text-scale.component.ts
//
// TEXT SIZE, for a surface that is not a docked panel.
//
// Tool windows already carry this control: the gear in `hcDockedPanel` offers
// the TEXT_RANGE slider and lands the value on `--hc-panel-scale`, which every
// panel's SCSS sizes off. Two surfaces read for a living and never got it,
// because neither is a docked panel — the command line's completion list and
// the tile editor. This is that same setting, in the same vocabulary, on the
// same record, for surfaces with their own chrome.
//
// Deliberately NOT a second mechanism: the range, the storage key, and the
// CSS var all come from panel-groups.ts. A window id here is a window id
// there, so a surface listed in both places would agree with itself, and the
// app has ONE answer to "how big is the text".
//
// `auto` is not offered. For a docked panel Auto means "derive it from the
// window's width", which is a promise neither of these surfaces can keep — a
// dropdown is sized by its content and the editor is a fixed dialog. So 100% is
// the default here, and the slider is the whole control.
//
// The track is drawn here, not a native range input: the completion panel is
// driven from an input that must not blur, and a range input cannot be dragged
// once its mousedown is prevented.

import { Component, computed, input, output, signal } from '@angular/core'
import { TranslatePipe } from '../../core/i18n.pipe'
import { TEXT_RANGE, clampToRange, readTextScale, writeTextScale } from '../docked-panel/panel-groups'

/** What a surface renders at when the participant has never chosen. */
export const DEFAULT_SURFACE_SCALE = 1

/** One press of Ctrl +/-. */
const SURFACE_STEP = 0.05

const hundredths = (scale: number): number => Math.round(clampToRange(scale, TEXT_RANGE) * 100) / 100

/** The stored scale for `window`, held inside the range. A record written by a
 *  docked panel may say `auto`, which reads as the default: the two settings
 *  are the same setting. */
export const surfaceScale = (window: string): number => {
  const stored = readTextScale(window)
  return stored == null ? DEFAULT_SURFACE_SCALE : hundredths(stored)
}

/** Move the scale one step and persist it. Returns the new scale — the keyboard
 *  path (Ctrl +/-) for surfaces with no room for chrome. */
export const stepSurfaceScale = (window: string, direction: 1 | -1): number => {
  const next = hundredths(surfaceScale(window) + direction * SURFACE_STEP)
  writeTextScale(window, next)
  return next
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

  readonly range = TEXT_RANGE

  readonly #picked = signal<number | null>(null)

  /** Is the slider showing? Closed is a lone gear — the setting is reached,
   *  not permanently on display beside the thing it sizes. */
  readonly open = signal(false)

  toggle(): void { this.open.update(v => !v) }

  readonly scale = computed(() => this.#picked() ?? surfaceScale(this.window()))

  /** How far along the track the thumb stands, in percent. */
  readonly along = computed(() => ((this.scale() - TEXT_RANGE.min) / (TEXT_RANGE.max - TEXT_RANGE.min)) * 100)

  readonly percent = computed(() => Math.round(this.scale() * 100))

  pick(scale: number): void {
    const next = hundredths(scale)
    this.#picked.set(next)
    writeTextScale(this.window(), next)
    this.scaleChange.emit(next)
  }

  #dragging = false

  grab(event: PointerEvent): void {
    this.#dragging = true
    ;(event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId)
    this.drag(event)
  }

  drag(event: PointerEvent): void {
    if (!this.#dragging) return
    const box = (event.currentTarget as HTMLElement).getBoundingClientRect()
    const ratio = clampToRange((event.clientX - box.left) / (box.width || 1), { min: 0, max: 1 })
    this.pick(TEXT_RANGE.min + ratio * (TEXT_RANGE.max - TEXT_RANGE.min))
  }

  drop(): void { this.#dragging = false }

  nudge(event: KeyboardEvent): void {
    const by = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1
      : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 0
    if (!by) return
    event.preventDefault()
    event.stopPropagation()
    this.pick(this.scale() + by * TEXT_RANGE.step)
  }
}
