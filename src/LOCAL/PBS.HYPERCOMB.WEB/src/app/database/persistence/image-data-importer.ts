import { Injectable, inject } from "@angular/core"
import { NotificationService } from "src/app/helper/utility/notification-service"
import { DataUtilityService } from "../data-utility-services"
import { ImageDatabase } from "../images/image-database"
import { NamingService } from "../utility/naming-service"

@Injectable({ providedIn: 'root' })
export class ImageDataImporter {
    // use inject() instead of constructor injection
    private readonly dataUtilityService = inject(DataUtilityService)
    private readonly imageDatabase = inject(ImageDatabase)
    private readonly namingService = inject(NamingService)
    private readonly notifications = inject(NotificationService)

    /**
     * import large image data records into the image database
     */
    public import = async (largeData: any[], identifiers: number[]) => {
        const filtered = largeData.filter(ld => identifiers.includes(ld.Key))

        const promise = this.importToLargeImageDatabase(filtered)

        await this.notifications.async(promise, async () => {
            this.notifications.success(
                `finished restoring from backup...`,
                { durations: { success: 800 } }
            )
        })
    }

    /**
     * convert base64 blobs to real Blobs and bulk insert into large image db
     */
    private importToLargeImageDatabase = async (data: any[]) => {
        if (!data?.length) return

        // simplify key if needed
        // const key = this.namingService.generatePageKey(...)

        for (const record of data) {
            if (record.blob) {
                record.blob = await this.dataUtilityService.base64ToBlob(record.blob)
            }
        }

        await this.imageDatabase.db.table('images').bulkPut(data)
    }
}


