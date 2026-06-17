// diamondcoreprocessor.com/files/files.queen.ts
//
// /files — browse attached files across more than one tile. With tiles
// selected it shows the selection's files; otherwise (or with `/files
// all`) it shows every tile in view that has files. The viewer's top
// type-filter bar + per-row type icon make it a quick resource browser
// for code generation / project creation.
//
//   /files            — selected tiles' files, else all files in view
//   /files all        — all files in view (ignores selection)
//
// FileDropDrone does the aggregation + live refresh; this queen just
// resolves the scope and hands it off via `files:open-scope`.

import { QueenBee, EffectBus } from '@hypercomb/core'

const get = (key: string): any => (window as any).ioc?.get?.(key)

type SelectionLike = { selected: ReadonlySet<string> }

export class FilesQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'files'
  override readonly aliases = ['resources']
  override description = 'Browse files attached to the selected tiles, or every tile in view'
  override descriptionKey = 'slash.files'

  override slashComplete(args: string): readonly string[] {
    const q = args.toLowerCase().trim()
    return q ? ['all'].filter(o => o.startsWith(q)) : ['all']
  }

  protected async execute(args: string): Promise<void> {
    const token = args.trim().toLowerCase()
    const selection = get('@diamondcoreprocessor.com/SelectionService') as SelectionLike | undefined
    const selected = selection ? [...selection.selected] : []

    if (token !== 'all' && selected.length > 0) {
      EffectBus.emit('files:open-scope', {
        scope: 'selection',
        labels: selected,
        title: selected.length === 1 ? selected[0] : `${selected.length} selected`,
      })
      return
    }

    EffectBus.emit('files:open-scope', { scope: 'all' })
  }
}

const _files = new FilesQueenBee()
window.ioc.register('@diamondcoreprocessor.com/FilesQueenBee', _files)
