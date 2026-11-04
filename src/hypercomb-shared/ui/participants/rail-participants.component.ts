// hypercomb-shared/ui/participants/rail-participants.component.ts
//
// WHO IS IN THE SWARM, in the header's icon tray: one initials badge per
// member — you first — to the right of the standing indicator pills (key,
// move …), with a hairline to their right. jwize, 2026-11-04: the badges
// look as they always did (the round presence badge), inside the tray, and
// nothing swarm-related sits across the top of the hexagons. A badge says
// who is here; a click opens the left participants sidebar, which is where
// whose-tiles-you-see is chosen. Mounted by command-shell inside
// `.indicators`; renders nothing outside a swarm.

import { Component } from '@angular/core'
import { EffectBus } from '@hypercomb/core'
import { TranslatePipe } from '../../core/i18n.pipe'
import { inSwarm, participants } from './participants-roster'

@Component({
  selector: 'hc-rail-participants',
  standalone: true,
  imports: [TranslatePipe],
  template: `
    @if (inSwarm()) {
      <div class="badges" role="group" [attr.aria-label]="'participants.title' | t">
        @for (p of participants(); track p.key) {
          <button
            class="badge"
            type="button"
            [class.self]="p.where === 'self'"
            [class.selected]="p.selected"
            [class.elsewhere]="p.where === 'elsewhere'"
            [class.away]="p.where === 'away'"
            (mousedown)="$event.preventDefault(); open()"
            [attr.aria-label]="p.label || ('participants.unnamed' | t)"
            [title]="p.label || ('participants.unnamed' | t)"
          >{{ p.initials }}</button>
        }
      </div>
      <span class="divider" aria-hidden="true"></span>
    }
  `,
  styles: [`
    :host { display: contents; }
    .badges {
      display: flex;
      align-items: center;
      gap: var(--hc-rail-gap, 0.3rem);
      flex-shrink: 0;
    }
    /* The presence badge, as it was on the old strip: one ink for everyone
       (the theme's primary, pulled toward the pane's ink for contrast), on
       the letters, not the chip, so the tray stays cold. */
    .badge {
      --presence-readable: color-mix(in srgb, var(--md-primary) 70%, rgb(var(--hc-panel-ink)));
      --presence-ink: color-mix(in srgb, var(--presence-readable), rgb(var(--hc-panel-ink)) var(--hc-deepen));
      appearance: none;
      flex: 0 0 auto;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: var(--hc-rail-btn, 1.6rem);
      height: var(--hc-rail-btn, 1.6rem);
      padding: 0;
      background: rgba(var(--hc-panel-pane), 0.94);
      border: 1px solid var(--hc-window-line-firm);
      border-radius: 50%;
      font-family: var(--hc-font);
      font-weight: 700;
      font-size: 0.62rem;
      letter-spacing: 0.03em;
      line-height: 1;
      cursor: pointer;
      color: var(--presence-ink);
      text-shadow:
        0 0 6px color-mix(in srgb, var(--presence-ink) 70%, transparent),
        0 0 2px color-mix(in srgb, var(--presence-ink) 85%, transparent);
      transition: transform 140ms ease, border-color 140ms ease;
      user-select: none;
    }
    .badge:hover { transform: translateY(-1px); }
    /* Your own badge wears a faint ring. */
    .badge.self {
      border-color: var(--presence-ink);
      box-shadow: 0 0 0 1px var(--hc-window-tint) inset;
    }
    /* In the tile filter: lit. */
    .badge.selected {
      border-color: var(--presence-ink);
      box-shadow: 0 0 0 2px color-mix(in srgb, var(--presence-ink) 55%, transparent);
    }
    .badge.elsewhere { opacity: 0.6; }
    .badge.away { opacity: 0.4; border-style: dotted; }
    /* The hairline, as the rail draws it between its groups. */
    .divider {
      width: 1px;
      height: 1.15em;
      margin: 0 calc(var(--hc-rail-gap, 0.3rem) * 0.5);
      border-radius: 1px;
      background: rgba(var(--glow-color-rgb), 0.35);
      flex-shrink: 0;
    }
  `],
})
export class RailParticipantsComponent {
  readonly inSwarm = inSwarm
  readonly participants = participants

  open(): void {
    EffectBus.emit('participants:sidebar', { toggle: true })
  }
}
