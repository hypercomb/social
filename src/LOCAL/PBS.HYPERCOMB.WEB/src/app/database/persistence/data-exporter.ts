import { inject, Injectable } from '@angular/core'
import { DataServiceBase } from 'src/app/actions/service-base-classes'
import { QUERY_HIVE_SVC } from 'src/app/shared/tokens/i-comb-query.token';

@Injectable({ providedIn: 'root' })
export class DataExporter extends DataServiceBase {

    private readonly query = inject(QUERY_HIVE_SVC)

    // export all data as json strings
    public export = async (): Promise<{ local: string; pageKeys: string }> => {
        const local = await this.getLocalJson()
        const pageKeys = await this.getPageKeysJson()
        return { local, pageKeys }
    }

    // dump tiles for active hive
    private getLocalJson = async (): Promise<string> => {
        const hive = this.stack.cell()!.hive

        if (!hive) throw new Error('no active hive selected')

        // const records = await this.store.fetchByHive(hive)

        throw new Error("Not implemented")
        // // convert blobs to base64
        // for (const r of records) {
        //     if (r.blob) {
        //         r.blob = await this.serialization.blobToBase64(r.blob)
        //     }
        // }

//         return JSON.stringify(records, null, 2)
    }

    // dump page keys for active hive
    private getPageKeysJson = async (): Promise<string> => {
        const hive = this.stack.cell()!.hive
        if (!hive) throw new Error('no active hive selected')

        const hives = await this.query.fetchHives()
        const records = hives.filter(h => h.name === hive)

        return JSON.stringify(records, null, 2)
    }
}
