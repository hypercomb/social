// diamond-core-processor/src/app/code-viewer/code-viewer.component.ts

import { Component, computed, effect, ElementRef, input, signal, viewChild } from '@angular/core'
import { DcpTranslatePipe } from '../core/dcp-translate.pipe'
import hljs from 'highlight.js/lib/core'
import javascript from 'highlight.js/lib/languages/javascript'
import typescript from 'highlight.js/lib/languages/typescript'

hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('typescript', typescript)

@Component({
  selector: 'hc-code-viewer',
  standalone: true,
  imports: [DcpTranslatePipe],
  templateUrl: './code-viewer.component.html',
  styleUrls: ['./code-viewer.component.scss']
})
export class CodeViewerComponent {

  public readonly code = input.required<string>()

  protected readonly copied = signal(false)
  protected readonly fullscreen = signal(false)
  protected readonly normalized = computed(() => (this.code() ?? '').replaceAll('\r\n', '\n'))

  readonly codeEl = viewChild<ElementRef<HTMLElement>>('codeRef')

  constructor() {
    effect(() => {
      const text = this.normalized()
      const el = this.codeEl()?.nativeElement
      if (!el || !text) return
      el.textContent = text
      hljs.highlightElement(el)
    })
  }

  protected toggleFullscreen = (): void => {
    this.fullscreen.update(v => !v)
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
