import { Injectable, effect } from "@angular/core"
import { HypercombData } from "src/app/actions/hypercomb-data"

@Injectable({ providedIn: 'root' })
export class PublishService extends HypercombData {


  constructor() {
    super()

    effect(() => {
      const ev = this.ks.keyUp()
      if (!ev) return

      const pressed =
        this.ks.when(ev).key(':', { ctrl: true, shift: true, alt: true }) ||
        this.ks.when(ev).key(':', { meta: true, shift: true, alt: true })

      if (pressed) {
        ev.preventDefault()
        this.publish()
      }
    })
  }

  public async publish() {
    throw new Error('Method not implemented.')
    // try {
    //   const hiveName = context.hiveName()
    //   const root = await this.query.cells.fetchRoot(hiveName)
    //   const { name, sourceId, uniqueId } = root!

    //   const hiveData = await this.query.hierarchy.fetchHierarchy(hiveName!, sourceId!)
    //   const cells = [root, ...hiveData]

    //   await this.validateUser(hiveName)
    //   await this.sendImagesToServer(cells)
    //   const filtered = cells.filter((cell): cell is Cell => cell !== undefined)
    
    //   const response = await this.publishJson(hiveName, filtered, name, uniqueId)
    //   const { _etag } = response
    //   const { hiveId, userId } = response.document

    //   const hive = (await this.query.hive.fetchHive(hiveName))!
    //   hive._etag = _etag
    //   await this.modify.updateCell(hive)
    //   // const newHive = await this.modify.rename(hive, `${hiveId}#${userId}`)
    //   throw new Error('Test error after rename')
    //   // await this.change(newHive)

    //   this.debug.log('http', 'publish successful', response)
    // } catch (error) {
    //   this.debug.log('http', 'publish error', error)
    // } finally {
    //   this.debug.log('http', 'publish completed')
    // }
  }
}
