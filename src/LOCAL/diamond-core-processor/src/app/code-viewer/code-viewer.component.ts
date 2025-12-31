// src/app/code-viewer/code-viewer.component.ts
import { CommonModule } from '@angular/common'
import { Component, computed, input, output, signal } from '@angular/core'

@Component({
  selector: 'hc-code-viewer',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './code-viewer.component.html',
  styleUrls: ['./code-viewer.component.scss']
})
export class CodeViewerComponent {

  public readonly code = input.required<string>()
  public readonly editable = input<boolean>(false)

  public readonly codeChange = output<string>()

  protected readonly copied = signal(false)
  protected readonly normalized = computed(() => (this.code() ?? '').replaceAll('\r\n', '\n'))

  protected onEdit = (value: string): void => {
    this.codeChange.emit(value)
  }

  protected copy = async (): Promise<void> => {
    const text = this.normalized()

    try {
      await navigator.clipboard.writeText(text)
      this.copied.set(true)
      window.setTimeout(() => this.copied.set(false), 900)
    } catch {
      const el = document.createElement('textarea')
      el.value = text
      el.setAttribute('readonly', 'true')
      el.style.position = 'fixed'
      el.style.left = '-9999px'
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)

      this.copied.set(true)
      window.setTimeout(() => this.copied.set(false), 900)
    }
  }
}
