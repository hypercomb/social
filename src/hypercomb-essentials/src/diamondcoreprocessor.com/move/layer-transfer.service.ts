// diamondcoreprocessor.com/move/layer-transfer.service.ts
//
// Under the layer-primitive doctrine cells live in layer.children (a sig
// array) and not as named OPFS folders. The legacy implementation here
// copied a cell's OPFS folder + all its descendants from one layer's
// directory into another, then removed the original. That parallel-store
// write is retired: a "layer transfer" is now a children-slot edit on
// both source and destination layers (remove sig from source.children,
// add sig to destination.children), driven through `LayerCommitter`.
//
// PENDING re-wire: the existing call site
// (drag-through onto a different layer) needs to be rerouted to the
// committer with the source cell's layer sig. Until then this service
// is a no-op so the drag completes without folder mints.

export class LayerTransferService {

  /**
   * Stub — see header. Returns immediately so the drag pipeline doesn't
   * stall, but performs no filesystem writes. The caller's downstream
   * layer-commit step (children slot of source + destination) is the
   * authoritative state change.
   */
  transfer = async (
    _sourceDir: FileSystemDirectoryHandle,
    _targetLayerDir: FileSystemDirectoryHandle,
    _cellLabel: string,
  ): Promise<void> => {
    /* no-op pending children-slot transfer */
  }
}

window.ioc.register(
  '@diamondcoreprocessor.com/LayerTransferService',
  new LayerTransferService(),
)
