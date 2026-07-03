// diamondcoreprocessor.com/sequence/sequence.queen.ts
//
// /sequence [name] — open the drop-target sequence creator anchored at the
// current location.
//
// Syntax:
//   /sequence              — edit the `default` set
//   /sequence normal       — create / edit the set named "normal"
//   /sequence <any-name>   — create / edit any named set
//
// Autocomplete lists the sets already saved in the palette. On Done the
// editor saves the set AND binds it (cascading, position→leaf) to the branch
// `/sequence` was launched from, so new tiles created in that subtree land at
// the next free index in the sequence.

import { QueenBee } from '@hypercomb/core'

type LineageLike = { explorerSegments?: () => readonly string[] }
type EditorLike = { openEditor(name: string, segments: readonly string[]): Promise<void> }
type SequenceServiceLike = { list(): string[] }

export class SequenceQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'sequence'
  override readonly aliases = ['seq']
  override description = 'Create or apply a drop-target sequence for new tiles'
  override descriptionKey = 'slash.sequence'
  override options = ['<set name>']
  override examples = [
    { input: '/sequence', result: 'Opens the editor for the "default" set' },
    { input: '/sequence normal', result: 'Creates or edits the set named "normal"' },
  ]

  override slashComplete(args: string): readonly string[] {
    const svc = window.ioc.get<SequenceServiceLike>('@diamondcoreprocessor.com/SequenceService')
    const names = svc?.list() ?? []
    const q = args.toLowerCase().trim()
    return q ? names.filter(n => n.toLowerCase().startsWith(q)) : names
  }

  protected async execute(args: string): Promise<void> {
    const name = args.trim() || 'default'
    const lineage = window.ioc.get<LineageLike>('@hypercomb.social/Lineage')
    const segments = (lineage?.explorerSegments?.() ?? []).map(s => String(s ?? '').trim()).filter(Boolean)
    const editor = window.ioc.get<EditorLike>('@diamondcoreprocessor.com/SequenceEditorBee')
    if (!editor?.openEditor) {
      console.warn('[/sequence] editor unavailable')
      return
    }
    await editor.openEditor(name, segments)
  }
}

const _sequenceQueen = new SequenceQueenBee()
window.ioc.register('@diamondcoreprocessor.com/SequenceQueenBee', _sequenceQueen)
