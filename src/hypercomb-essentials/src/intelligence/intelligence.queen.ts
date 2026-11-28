// `/intelligence` — the prompt that asks Windows for a folder.
//
// Bare, or `start`, opens the directory picker when no folder is set, and
// only checks the grant after that. `reset` is the press that asks again
// once the grant has lapsed. The picker has to begin from this keypress.

import { EffectBus, QueenBee } from '@hypercomb/core'
import { folderMessage, intelligenceFolder } from './intelligence-folder.js'
import type { LayoutDirectory } from './intelligence-layout.js'

const FOLDER_SYNC_KEY = '@diamondcoreprocessor.com/FolderSyncService'

type GrantedWriter = {
  writeGrantedFile(dir: FileSystemDirectoryHandle, name: string, text: string): Promise<void>
}

const folder = intelligenceFolder({
  write: async (dir: LayoutDirectory, name: string, text: string) => {
    const service = window.ioc.get(FOLDER_SYNC_KEY) as GrantedWriter | undefined
    if (!service?.writeGrantedFile) throw new Error('The folder writer is not ready.')
    await service.writeGrantedFile(dir as FileSystemDirectoryHandle, name, text)
  },
})

export class IntelligenceQueenBee extends QueenBee {
  readonly namespace = 'diamondcoreprocessor.com'
  readonly command = 'intelligence'
  override readonly description = 'Ask Windows for a folder, keep intelligence groups there, and start'
  override readonly descriptionKey = 'slash.intelligence'
  override readonly options = ['start', 'reset']
  override readonly examples = [
    { input: '/intelligence', result: 'Asks Windows for a folder and starts the intelligence root there' },
    { input: '/intelligence reset', result: 'Asks again when the folder grant has lapsed' },
  ]

  protected async execute(raw: string): Promise<void> {
    const word = raw.trim().toLowerCase()
    if (word !== '' && word !== 'start' && word !== 'reset') {
      this.#say('info', 'Type intelligence, or intelligence reset.')
      return
    }
    try {
      const outcome = word === 'reset' ? await folder.reset() : await folder.start()
      this.#say(outcome.kind === 'started' ? 'success' : 'warning', folderMessage(outcome))
    } catch (error) {
      this.#say('warning', error instanceof Error ? error.message : 'Intelligence could not write the folder.')
    }
  }

  #say(type: string, message: string): void {
    EffectBus.emit('toast:show', { type, title: 'Intelligence', message })
    EffectBus.emit('activity:log', { message })
  }
}

const ioc = (globalThis as { ioc?: { register?: (key: string, value: unknown) => void } }).ioc
ioc?.register?.('@diamondcoreprocessor.com/IntelligenceQueenBee', new IntelligenceQueenBee())
