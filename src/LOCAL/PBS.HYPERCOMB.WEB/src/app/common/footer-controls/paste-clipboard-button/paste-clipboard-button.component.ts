import { Component, HostListener, inject } from '@angular/core'
import { SelectionService } from 'src/app/cells/selection/selection-service'
import { ClipboardService } from 'src/app/clipboard/clipboard-service'
import { Hypercomb } from 'src/app/core/mixins/abstraction/hypercomb.base'
import { CLIPBOARD_STATE } from 'src/app/shared/tokens/i-hypercomb.token'

@Component({
  standalone: true,
  selector: '[app-paste-clipboard-button]',
  templateUrl: './paste-clipboard-button.component.html',
  styleUrls: ['./paste-clipboard-button.component.scss']
})
export class PasteClipboardButtonComponent extends Hypercomb {
  private readonly selections = inject(SelectionService)

  public get count(): number { return this.cbs.activeItems.length }
  public get selected(): number | null { return this.selections.items.length ?? 0 }

  private readonly clipboardService = inject(ClipboardService)
  public readonly cbs = inject(CLIPBOARD_STATE)

  @HostListener('document:keydown.enter', ['$event'])
  handleEnterKey = async (event: KeyboardEvent) => {
    event.preventDefault() // Prevent default Enter behavior if necessary
    await this.paste()
  }

  public paste = async () => {
    // await this.clipboardService.paste()
  }

}


