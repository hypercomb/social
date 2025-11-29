import { ChangeDetectionStrategy, Component, EventEmitter, inject, Input, Output, signal, effect } from '@angular/core'
import { IDexieHive } from 'src/app/hive/hive-models'
import { HiveService } from 'src/app/hive/storage/hive-service'
import { BlobService } from 'src/app/hive/rendering/blob-service'
import { OpfsHiveService } from 'src/app/hive/storage/opfs-hive-service'
import { OpfsImageService } from 'src/app/hive/storage/opfs-image.service'

@Component({
  standalone: true,
  selector: '[app-carousel-item]',
  templateUrl: './carousel-item.component.html',
  styleUrls: ['./carousel-item.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CarouselItemComponent {

  private readonly hives = inject(HiveService)
  private readonly images = inject(OpfsImageService)

  @Input() hive!: IDexieHive
  @Output('change-hive') changeHive = new EventEmitter<string>()

  public imageUrl = signal<string | null>(null)
  public backgroundColor = '#242a30'

  constructor() {
    effect(() => {
      if (this.hive?.name) {
        this.loadPreview(this.hive.name)
      }
    })
  }

  // ───────────────────────────────────────────────────────────
  // load preview image from OPFS (small image)
  // ───────────────────────────────────────────────────────────
  private loadPreview = async (hiveName: string) => {
    try {
      const hash = this.hive.imageHash
      this.backgroundColor = this.hive.background ?? '#242a30'

      if (!hash || typeof hash !== 'string') {
        throw new Error('no imageHash in hive metadata')
      }

      const blob = await this.images.loadSmall(hash)
      if (!blob) throw new Error('small image not found')

      const url = URL.createObjectURL(blob)
      this.imageUrl.set(url)

    } catch (err) {
      console.warn(`carousel preview unavailable for ${hiveName}`, err)
      const fallback = URL.createObjectURL(BlobService.defaultBlob)
      this.imageUrl.set(fallback)
    }
  }


  public ngOnChanges() {
    if (this.hive) {
      this.loadPreview(this.hive.name)
    }
  }

  public ngOnDestroy() {
    const url = this.imageUrl()
    if (url) URL.revokeObjectURL(url)
  }

  public change = (hive: string) => {
    this.changeHive.next(hive)
    this.hives.setActive(hive)
  }
}
