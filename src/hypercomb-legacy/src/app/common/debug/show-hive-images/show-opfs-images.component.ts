import { Component, signal, effect, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { IHiveImage } from 'src/app/core/models/i-hive-image';
import { ShowOpfsImagesAction } from 'src/app/actions/images/show-opfs-images';
import { OpfsManager } from 'src/app/common/opfs/opfs-manager';
import { DebugService } from 'src/app/core/diagnostics/debug-service';
import { OpfsImageService } from 'src/app/hive/storage/opfs-image.service';

/**
 * ShowHiveImagesComponent
 * Calls ShowAllImagesAction to read images from hive-images OPFS
 * and displays thumbnails in a responsive grid.
 */
@Component({
  standalone: true,
  selector: 'app-show-opfs-images',
  templateUrl: './show-opfs-images.component.html',
  styleUrls: ['./show-opfs-images.component.scss'],
  imports: [CommonModule],
})
export class ShowOpfsImagesComponent {
  public URL = window.URL
  public readonly opfssvc = inject(OpfsImageService)
  // reactive state
  public readonly images = signal<IHiveImage[]>([]);
  public readonly loading = signal(false);
  public readonly message = signal('');

  private readonly action = new ShowOpfsImagesAction();
  private readonly opfs = new OpfsManager();
  private readonly debug = inject(DebugService);

  constructor() {
    // optional: log whenever images update
    effect(() => {
      const imgs = this.images();
      this.debug.log('import', '🖼️ Loaded images:', imgs.length);
    });
  }

  public async loadImages(): Promise<void> {
    // this.loading.set(true);
    // this.message.set('Loading images from hive-images ...');
    // try {
    //   const loaded: IHiveImage[] = [];
    //   const imagesDir = await this.opfs.getDir('hive-images', { create: true });
    //   const entries = await this.opfs.listEntries(imagesDir);

    //   for (const entry of entries) {
    //     if (entry.handle.kind !== 'file') continue;
    //     const file = await this.opfs.readFile(entry.handle as FileSystemFileHandle);
    //     const blob = new Blob([await file.arrayBuffer()], { type: file.type || 'image/png' });
    //     loaded.push({
    //       imageHash: entry.name,
    //       blob,
    //       x: 0,
    //       y: 0,
    //       scale: 1,
    //     });
    //   }

    //   this.images.set(loaded);
    //   this.message.set(`Loaded ${loaded.length} images.`);
    // } catch (err) {
    //   this.debug.log('import', 'Error loading images:', err);
    //   this.message.set('Error loading images.');
    // } finally {
    //   this.loading.set(false);
    // }
  }
}
