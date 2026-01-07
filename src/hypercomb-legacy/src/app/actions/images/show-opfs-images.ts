import { inject } from '@angular/core';
import { ImageDatabase } from 'src/app/database/images/image-database';
import { IHiveImage } from 'src/app/core/models/i-hive-image';
import { ActionBase } from '../action.base';
import { DebugService } from 'src/app/core/diagnostics/debug-service';

/**
 * ShowAllImagesAction
 * Opens the hive-images OPFS directory and lists all stored images.
 * This runs asynchronously and logs / returns the full list for UI use.
 */
export class ShowOpfsImagesAction extends ActionBase {
  public override id = 'show-all-images';
  private readonly imageDb = inject(ImageDatabase);
  private readonly debug = inject(DebugService);

  public override run = async (): Promise<void> => {
    this.debug.log('import', '🐝 running ShowAllImagesAction');

    // 1. access OPFS hive-images directory
    const root = await navigator.storage.getDirectory();
    const hiveImagesDir = await root.getDirectoryHandle('hive-images', { create: true });

    const images: IHiveImage[] = [];

    // 2. enumerate and read all entries
    for await (const [name, handle] of hiveImagesDir.entries()) {
      if (handle.kind !== 'file') continue;
      const fileHandle = handle as FileSystemFileHandle;
      const file = await fileHandle.getFile();

      const blob = new Blob([await file.arrayBuffer()], { type: file.type || 'image/png' });
      const record: IHiveImage = {
        blob,
        x: 0,
        y: 0,
        scale: 1,
      };

      images.push(record);
    }

    // 3. optionally log or display them
    this.debug.log('import', `📦 Loaded ${images.length} images from hive-images`);
    for (const img of images) this.debug.log('import', '🖼️', img);


  };
}
