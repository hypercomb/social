// hypercomb-shared/ui/participants/rail-participants.component.ts
//
// The header rail's participant group: while this tab is in a swarm, one
// more hairline divider and one initials badge per member — you first — in
// the same box and gap as every other rail icon (feedback_header_icon_rail).
// It says WHO is in the room and nothing else; a click opens the left
// sidebar, which is where whose-tiles-you-see is chosen. Mounted inside
// command-shell's `.shell-actions`, left of the standing tools group.

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
      <span class="rail-divider" aria-hidden="true"></span>
      <div class="action-group participants" role="group" [attr.aria-label]="'participants.title' | t">
        @for (p of participants(); track p.key) {
          <button
            class="rail-btn participant"
            type="button"
            [class.self]="p.where === 'self'"
            [class.on]="p.selected"
            [class.elsewhere]="p.where === 'elsewhere'"
            [class.away]="p.where === 'away'"
            (mousedown)="$event.preventDefault(); open()"
            [attr.aria-label]="p.label || ('participants.unnamed' | t)"
            [title]="p.label || ('participants.unnamed' | t)"
          >{{ p.initials }}</button>
        }
      </div>
    }
  `,
  styles: [`
    :host { display: contents; }
    .participant {
      font: 600 0.62em/1 var(--hc-mono, system-ui);
      letter-spacing: 0.02em;
      border: 1px solid rgba(var(--glow-color-rgb), 0.35);
    }
    .participant.self { border-style: dashed; }
    .participant.elsewhere { opacity: 0.6; }
    .participant.away { opacity: 0.35; border-style: dotted; }
  `],
})
export class RailParticipantsComponent {
  readonly inSwarm = inSwarm
  readonly participants = participants

  open(): void {
    EffectBus.emit('participants:sidebar', { toggle: true })
  }
}
