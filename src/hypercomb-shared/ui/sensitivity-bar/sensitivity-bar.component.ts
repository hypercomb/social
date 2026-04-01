// hypercomb-shared/ui/sensitivity-bar/sensitivity-bar.component.ts
//
// Minimal vertical bar at left screen edge showing current touch sensitivity.
// Appears during two-finger sensitivity swipe, fades 1s after gesture ends.

import { Component, signal, type OnInit, type OnDestroy } from '@angular/core'
import { EffectBus } from '@hypercomb/core'

@Component({
  selector: 'hc-sensitivity-bar',
  standalone: true,
  template: `
    @if (visible()) {
      <div class="sensitivity-bar" [class.locked]="locked()" [class.fading]="fading()">
        <div class="track">
          <div class="fill" [style.height.%]="fillPercent()"></div>
        </div>
        @if (locked()) {
          <div class="lock-icon">L</div>
        }
      </div>
    }
  `,
  styles: [`
    :host {
      position: fixed;
      left: 8px;
      top: 50%;
      transform: translateY(-50%);
      z-index: 9999;
      pointer-events: none;
    }

    .sensitivity-bar {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      opacity: 0.8;
      transition: opacity 300ms ease;
    }

    .sensitivity-bar.fading {
      opacity: 0;
      transition: opacity 1000ms ease;
    }

    .track {
      width: 4px;
      height: 120px;
      background: rgba(255, 255, 255, 0.15);
      border-radius: 2px;
      position: relative;
      overflow: hidden;
    }

    .fill {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      background: rgba(77, 166, 255, 0.7);
      border-radius: 2px;
      transition: height 50ms ease;
    }

    .lock-icon {
      font-size: 10px;
      color: rgba(255, 166, 77, 0.8);
      font-family: var(--hc-mono);
      font-weight: bold;
    }

    .locked .fill {
      background: rgba(255, 166, 77, 0.7);
    }
  `],
})
export class SensitivityBarComponent implements OnInit, OnDestroy {
  readonly visible = signal(false)
  readonly locked = signal(false)
  readonly fading = signal(false)
  readonly fillPercent = signal(50)

  #unsub: (() => void) | null = null
  #fadeTimer: ReturnType<typeof setTimeout> | null = null
  #hideTimer: ReturnType<typeof setTimeout> | null = null

  ngOnInit(): void {
    this.#unsub = EffectBus.on<{ value: number; locked: boolean; visible: boolean }>(
      'touch:sensitivity-bar',
      ({ value, locked, visible: show }) => {
        this.locked.set(locked)

        // map 0.25..4.0 (log scale) to 0..100%
        // ln(0.25)/ln(4) = -1, ln(4)/ln(4) = 1 → range [-1, 1] → [0, 100]
        const logNorm = Math.log(value) / Math.log(4) // -1 to 1
        const pct = Math.max(0, Math.min(100, (logNorm + 1) * 50))
        this.fillPercent.set(pct)

        if (show) {
          this.#clearTimers()
          this.visible.set(true)
          this.fading.set(false)
        } else {
          // start fade-out
          this.fading.set(true)
          this.#hideTimer = setTimeout(() => {
            this.visible.set(false)
            this.fading.set(false)
          }, 1000)
        }
      },
    )
  }

  ngOnDestroy(): void {
    this.#unsub?.()
    this.#clearTimers()
  }

  #clearTimers(): void {
    if (this.#fadeTimer) { clearTimeout(this.#fadeTimer); this.#fadeTimer = null }
    if (this.#hideTimer) { clearTimeout(this.#hideTimer); this.#hideTimer = null }
  }
}
