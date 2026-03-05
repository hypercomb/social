// hypercomb-shared/ui/tile-editor/tile-editor.component.ts
// Generic property editor for seed state bags.

import { Component, computed, signal, type OnInit, type OnDestroy } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { fromRuntime } from '../../core/from-runtime'
import { isSignature } from '@hypercomb/essentials/diamondcoreprocessor.com/editor/tile-properties'

import type { TileEditorService } from
  '@hypercomb/essentials/diamondcoreprocessor.com/editor/tile-editor.service'

@Component({
  selector: 'hc-tile-editor',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './tile-editor.component.html',
  styleUrls: ['./tile-editor.component.scss']
})
export class TileEditorComponent implements OnInit, OnDestroy {

  private get editorService(): TileEditorService {
    return get('@diamondcoreprocessor.com/TileEditorService') as TileEditorService
  }

  private get editorDrone(): any {
    return get('@diamondcoreprocessor.com/TileEditorDrone')
  }

  private readonly mode$ = fromRuntime(
    get('@diamondcoreprocessor.com/TileEditorService') as EventTarget,
    () => this.editorService.mode
  )

  private readonly props$ = fromRuntime(
    get('@diamondcoreprocessor.com/TileEditorService') as EventTarget,
    () => this.editorService.properties
  )

  private readonly seed$ = fromRuntime(
    get('@diamondcoreprocessor.com/TileEditorService') as EventTarget,
    () => this.editorService.seed
  )

  public readonly open = computed(() => this.mode$() === 'editing')
  public readonly seed = computed(() => this.seed$())

  public readonly entries = computed(() => {
    const p = this.props$()
    return Object.entries(p)
  })

  // new property row
  public newKey = ''
  public newValue = ''

  readonly isSignature = isSignature

  readonly inputType = (value: unknown): string => {
    if (typeof value === 'boolean') return 'checkbox'
    if (typeof value === 'number') return 'number'
    return 'text'
  }

  readonly displayValue = (value: unknown): string => {
    if (typeof value === 'string') return value
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    return JSON.stringify(value)
  }

  readonly onPropertyChange = (key: string, raw: string, currentValue: unknown): void => {
    let value: unknown = raw
    if (typeof currentValue === 'number') value = Number(raw)
    else if (typeof currentValue === 'boolean') value = raw === 'true' || raw === 'on'
    this.editorService.updateProperty(key, value)
  }

  readonly onCheckboxChange = (key: string, checked: boolean): void => {
    this.editorService.updateProperty(key, checked)
  }

  readonly onRemoveProperty = (key: string): void => {
    this.editorService.removeProperty(key)
  }

  readonly onAddProperty = (): void => {
    const k = this.newKey.trim()
    if (!k) return

    let value: unknown = this.newValue
    if (this.newValue === 'true') value = true
    else if (this.newValue === 'false') value = false
    else if (this.newValue !== '' && !isNaN(Number(this.newValue))) value = Number(this.newValue)

    this.editorService.updateProperty(k, value)
    this.newKey = ''
    this.newValue = ''
  }

  readonly save = (): void => {
    this.editorDrone?.saveAndComplete?.()
  }

  readonly cancel = (): void => {
    this.editorDrone?.cancelEditing?.()
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (!this.open()) return
    if (e.key === 'Escape') {
      e.preventDefault()
      this.cancel()
    }
  }

  ngOnInit(): void {
    window.addEventListener('keydown', this.onKeyDown)
  }

  ngOnDestroy(): void {
    window.removeEventListener('keydown', this.onKeyDown)
  }
}
