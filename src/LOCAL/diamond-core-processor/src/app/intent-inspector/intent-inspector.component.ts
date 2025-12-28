// src/app/intent-inspector/intent-inspector.component.ts
import { Component, computed, input, signal } from '@angular/core'
import { MatTabsModule } from '@angular/material/tabs'
import { Intent } from '@hypercomb/core'
import { IntentConfirmComponent } from './tabs/intent-confirm.component'
import { IntentContentComponent } from './tabs/intent-content.component'
import { IntentCodeComponent } from './tabs/intent-code.component'

@Component({
  selector: 'app-intent-inspector',
  standalone: true,
  imports: [MatTabsModule, IntentContentComponent, IntentCodeComponent, IntentConfirmComponent],
  templateUrl: './intent-inspector.component.html',
  styleUrls: ['./intent-inspector.component.scss']
})
export class IntentInspectorComponent {

  public readonly intent = input.required<Intent>()
  public readonly code = input.required<string>()

  protected readonly activeTab = signal(0)

  // verify gate stages live on the bottom primary button (not inside the verify content)
  // 0 -> "YEAH I UNDERSTAND"
  // 1 -> "DO YOU STILL WANT TO DO IT"
  // 2 -> "CONFIRM" (executes confirm())
  protected readonly understandStage = signal<0 | 1 | 2>(0)

  protected readonly primaryLabel = computed(() => {
    if (this.activeTab() !== 2) return 'CONTINUE'
    const s = this.understandStage()
    if (s === 0) return 'YEAH I UNDERSTAND'
    if (s === 1) return 'DO YOU STILL WANT TO DO IT'
    return 'CONFIRM'
  })

  protected get selectedIndex(): number {
    return this.activeTab()
  }

  protected set selectedIndex(value: number) {
    this.activeTab.set(value)

    // if they leave verify, reset the staged confirm
    if (value !== 2) this.understandStage.set(0)
  }

  protected next = (): void => {
    if (this.activeTab() < 2) {
      this.activeTab.set(this.activeTab() + 1)
      return
    }

    // verify tab: staged confirm happens here
    const s = this.understandStage()

    if (s === 0) {
      this.understandStage.set(1)
      return
    }

    if (s === 1) {
      this.understandStage.set(2)
      return
    }

    this.confirm()
  }

  protected confirm = (): void => {
    // handled by hypercomb host
  }

  protected cancel = (): void => {
    // handled by hypercomb host
  }
}
