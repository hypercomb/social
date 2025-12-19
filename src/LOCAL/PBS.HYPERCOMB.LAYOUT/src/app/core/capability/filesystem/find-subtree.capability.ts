import { Injectable } from '@angular/core'
import { Intent } from '../../intent/intent.model'
import { CapabilityDoc } from '../capability-doc.model'
import { Capability } from '../capability.interface'


@Injectable({ providedIn: 'root' })
export class FindSubtreeCapability implements Capability {
  public readonly capabilityId = 'filesystem.find.subtree'

  public supports(intentId: string): boolean {
    return intentId === 'find.subtree'
  }

  public describe(): CapabilityDoc {
    return {
      name: 'Find Subtree',
      description: 'Discovers folder and file hierarchy and emits DNA nodes',
      intentIds: ['find.subtree'],
      inputs: [],
      outputs: ['DnaNode[]'],
      sideEffects: 'read-only'
    }
  }

  public async execute(_: Intent): Promise<void> {
    const root = await (window as any).showDirectoryPicker()

    const walk = async (
      dir: FileSystemDirectoryHandle,
      parent: string | null,
      path: string
    ) => {
      for await (const [name, handle] of dir.entries()) {
        const seed = crypto.randomUUID()
        const fullPath = path ? `${path}/${name}` : name

        console.log({
          seed,
          parent,
          kind: handle.kind,
          name,
          path: fullPath
        })

        if (handle.kind === 'directory') {
          await walk(handle as FileSystemDirectoryHandle, seed, fullPath)
        }
      }
    }

    const rootSeed = crypto.randomUUID()

    console.log({
      seed: rootSeed,
      parent: null,
      kind: 'folder',
      name: 'root',
      path: ''
    })

    await walk(root, rootSeed, '')
  }
}
