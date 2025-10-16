import { inject, Injectable } from '@angular/core'
import * as download from 'downloadjs'
import JSZip from 'jszip'
import { DataExporter } from './data-exporter'
import { DataServiceBase } from 'src/app/actions/service-base-classes'


@Injectable({
  providedIn: 'root'
})
export class BackupService extends DataServiceBase {
  private readonly dataExporter = inject(DataExporter)

  public backup = async (name: string) => {
    if (!name) {
      // TODO await this.notificationService.error,)
      return
    }

    try {
      // exporting data and converting it to json
      const data = await this.dataExporter.export()
      const jsonString = JSON.stringify(data)

      // creating a zip file and adding the json string
      const zip = new JSZip()
      zip.file("database-backup.json", jsonString)

      const promise = zip.generateAsync({ type: "blob" })

      // // using notification service for download feedback and initiating download
      // await this.notifications.async(promise, content => {
      //   this.notifications.success(`downloading backup...`, { durations: { success: 800 } })
      //   download(content, `${name}.zip`, 'application/zip')
      // },
      //   (err) => {
      //     this.debug.log('error', err)
      //   },
      //   '', { labels: { async: 'Downloading' } })
      throw new Error('Not implemented: backup notifications')

    } catch (error) {
      console.error("Error during backup:", error)
    }
  }
}


