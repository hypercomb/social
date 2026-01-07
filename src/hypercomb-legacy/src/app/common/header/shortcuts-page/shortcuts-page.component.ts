import { Component, HostListener, inject } from '@angular/core'
import { HypercombMode } from 'src/app/core/models/enumerations'
import { Hypercomb } from 'src/app/core/mixins/abstraction/hypercomb.base'
import { IShortcut } from 'src/app/shortcuts/shortcut-model'
import { ShortcutService } from 'src/app/shortcuts/shortcut-service'
import { Events } from 'src/app/helper/events/events'


@Component({
  standalone: true,
  selector: '[app-shortcuts-page]',
  templateUrl: './shortcuts-page.component.html',
  styleUrls: ['./shortcuts-page.component.scss']
})
export class ShortcutsPageComponent extends Hypercomb {
  private readonly shortcuts = inject(ShortcutService)

  public navigationShortcuts: IShortcut[]
  public tileShortcuts: IShortcut[]
  public clipboardShortcuts: IShortcut[]
  public advancedShortcuts: IShortcut[]
  public destructiveShortcuts: IShortcut[]

  constructor() {
    super()

    // pull from merged effective shortcuts
    const all = this.shortcuts.effectiveShortcuts()

    this.navigationShortcuts = all.filter(s => s.category === 'Navigation')
    this.tileShortcuts = all.filter(s => s.category === 'Tile')
    this.clipboardShortcuts = all.filter(s => s.category === 'Clipboard')
    this.advancedShortcuts = all.filter(s => s.category === 'Advanced')
    this.destructiveShortcuts = all.filter(s => s.category === 'Destructive')
  }

  formatKeys(shortcut: IShortcut): string {
    return shortcut.keys
      .map(step => step.map(k => this.formatKey(k)).join('+'))
      .join(', ')
  }

  private formatKey(k: any): string {
    let mods: string[] = []
    if (k.primary) mods.push('Ctrl/Cmd')
    if (k.shift) mods.push('Shift')
    if (k.alt) mods.push('Alt')
    return [...mods, k.key.toUpperCase()].join('+')
  }

  @HostListener(Events.EscapeCancel)
  close() {
    this.state.clearToolMode()
  }

  goToHelp() {
    this.state.toggleToolMode(HypercombMode.ViewHelp)
  }
}


