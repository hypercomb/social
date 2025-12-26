import { hypercomb } from '@hypercomb/core';
// src/app/core/synchronizer.ts

import { Injectable, OnDestroy } from '@angular/core'


@Injectable()
export class synchronizer extends hypercomb implements OnDestroy {

  private readonly onSynchronize = (): void => {
    const lineage = window.location.pathname.split('/').filter(Boolean)
    this.ensureDirectories(lineage).catch(console.error)
  }

  constructor() {
    super()
    window.addEventListener('synchronize', this.onSynchronize)
  }

  private readonly ensureDirectories = async (
    lineage: readonly string[]
  ): Promise<void> => {
    if (!lineage.length) return

    let dir = await navigator.storage.getDirectory()

    // ensure directories exactly as encountered
    for (const seg of lineage) {
      dir = await dir.getDirectoryHandle(seg, { create: true })
    }
  }

  public  ngOnDestroy(): void {
    window.removeEventListener('synchronize', this.onSynchronize)
  }
}
