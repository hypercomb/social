// diamondcoreprocessor.com/move/layer-transfer.service.ts
// Handles OPFS directory transfer between layers during drag-through.

export class LayerTransferService {

  /**
   * Transfer a cell directory from sourceDir into targetLayerDir.
   * Creates `targetLayerDir/{cellLabel}/` as a deep copy of `sourceDir/{cellLabel}/`,
   * then removes the original.
   */
  transfer = async (
    sourceDir: FileSystemDirectoryHandle,
    targetLayerDir: FileSystemDirectoryHandle,
    cellLabel: string,
  ): Promise<void> => {
    const srcCell = await sourceDir.getDirectoryHandle(cellLabel, { create: false })
    const destCell = await targetLayerDir.getDirectoryHandle(cellLabel, { create: true })

    await this.#copyRecursive(srcCell, destCell)
    await sourceDir.removeEntry(cellLabel, { recursive: true })
  }

  async #copyRecursive(
    src: FileSystemDirectoryHandle,
    dest: FileSystemDirectoryHandle,
  ): Promise<void> {
    for await (const [name, handle] of (src as any).entries()) {
      if (handle.kind === 'file') {
        const srcFile = handle as FileSystemFileHandle
        const file = await srcFile.getFile()
        const destFile = await dest.getFileHandle(name, { create: true })
        const writable = await destFile.createWritable()
        await writable.write(await file.arrayBuffer())
        await writable.close()
      } else {
        const srcSub = handle as FileSystemDirectoryHandle
        const destSub = await dest.getDirectoryHandle(name, { create: true })
        await this.#copyRecursive(srcSub, destSub)
      }
    }
  }
}

window.ioc.register(
  '@diamondcoreprocessor.com/LayerTransferService',
  new LayerTransferService(),
)
