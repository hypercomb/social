// diamond-core-processor/src/app/code-editor/code-editor.component.ts

import {
  Component, ElementRef, effect, input, OnDestroy, output, signal, viewChild
} from '@angular/core'
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import { javascript } from '@codemirror/lang-javascript'
import { oneDark } from '@codemirror/theme-one-dark'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching } from '@codemirror/language'

@Component({
  selector: 'dcp-code-editor',
  standalone: true,
  template: `<div #editorHost class="editor-host"></div>`,
  styles: [`
    :host { display: block; }
    .editor-host {
      width: 100%;
      min-height: 200px;
      border: 1px solid #ddd;
      border-radius: 4px;
      overflow: hidden;
    }
    .editor-host .cm-editor { height: 100%; }
    .editor-host .cm-scroller { overflow: auto; max-height: 70vh; }
  `]
})
export class CodeEditorComponent implements OnDestroy {

  code = input.required<string>()
  codeChange = output<string>()

  protected readonly editorHost = viewChild.required<ElementRef<HTMLElement>>('editorHost')
  #view: EditorView | null = null
  #currentCode = signal('')

  constructor() {
    effect(() => {
      const host = this.editorHost()?.nativeElement
      const code = this.code()
      if (!host) return

      if (this.#view) {
        // update content if code input changed externally
        const current = this.#view.state.doc.toString()
        if (current !== code) {
          this.#view.dispatch({
            changes: { from: 0, to: current.length, insert: code }
          })
        }
        return
      }

      this.#view = new EditorView({
        parent: host,
        state: EditorState.create({
          doc: code,
          extensions: [
            lineNumbers(),
            highlightActiveLine(),
            highlightActiveLineGutter(),
            history(),
            bracketMatching(),
            javascript({ typescript: true }),
            syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
            oneDark,
            keymap.of([...defaultKeymap, ...historyKeymap]),
            EditorView.updateListener.of(update => {
              if (update.docChanged) {
                const text = update.state.doc.toString()
                this.#currentCode.set(text)
                this.codeChange.emit(text)
              }
            })
          ]
        })
      })

      this.#currentCode.set(code)
    })
  }

  ngOnDestroy(): void {
    this.#view?.destroy()
    this.#view = null
  }

  getValue(): string {
    return this.#view?.state.doc.toString() ?? this.#currentCode()
  }
}
