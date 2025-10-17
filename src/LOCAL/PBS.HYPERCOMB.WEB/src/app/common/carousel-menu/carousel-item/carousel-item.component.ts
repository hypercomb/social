import { ChangeDetectionStrategy, Component, EventEmitter, inject, Input, Output, signal, effect } from '@angular/core'
import { IDexieHive } from 'src/app/hive/hive-models'
import { HiveService } from 'src/app/hive/storage/hive-service'
import { BlobService } from 'src/app/hive/rendering/blob-service'
import { SETTINGS_SVC } from 'src/app/shared/tokens/i-hypercomb.token'
import { OpfsManager } from "src/app/common/opfs/opfs-manager"

@Component({
  standalone: true,
  selector: '[app-carousel-item]',
  templateUrl: './carousel-item.component.html',
  styleUrls: ['./carousel-item.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CarouselItemComponent  {

  private readonly hives = inject(HiveService)
  private readonly settingsService = inject(SETTINGS_SVC)
  public backgroundColor: string = '#242a30'
  @Input() hive!: IDexieHive
  @Output('change-hive') changeHive: EventEmitter<string> = new EventEmitter<string>()

  // reactive image URL signal (auto updates when loaded)
  public imageUrl = signal<string | null>(null)
  private readonly opfs = new OpfsManager();

  constructor() {
    // reactively reload image when hive changes
    effect(() => {
      if (this.hive?.name) {
        this.loadFromDisk(this.hive.name)
      }
    })
  }

  // ───────────────────────────────────────────────────────────
  // loads image from OPFS flat directory (/hive-images/{hiveName}.webp)
  // ───────────────────────────────────────────────────────────
  private loadFromDisk = async (hiveName: string): Promise<void> => {

    const metadata = (await this.settingsService.getOpfsMetadata())!

    try {

      const item = metadata?.hives.find(h => h.name === hiveName)
      this.backgroundColor = item?.background || '#242a30'
      const imagesDir = await this.opfs.getDir('hive-images');
      const fileHandle = await this.opfs.getFile(imagesDir, `${hiveName}.webp`);
      const file = await this.opfs.readFile(fileHandle);
      const url = URL.createObjectURL(file);
      this.imageUrl.set(url)
    } catch (err) {
      console.warn(`no OPFS image found for hive: ${hiveName}`, err)
     
      const url = URL.createObjectURL(BlobService.defaultBlob)
      this.imageUrl.set(url)
    }
  }

  // ──────────────────────────────────────────────────────────c─
  // lifecycle
  // ───────────────────────────────────────────────────────────
  public ngOnChanges(): void {
    if (this.hive) {
      this.loadFromDisk(this.hive.name)
    }
  }

  public ngOnDestroy(): void {
    const url = this.imageUrl()
    if (url) URL.revokeObjectURL(url)
  }

  // ───────────────────────────────────────────────────────────
  // emits hive selection
  // ───────────────────────────────────────────────────────────
  public change = (hive: string): void => {
    this.changeHive.next(hive)
    this.hives.setActive(hive)
  }
}
