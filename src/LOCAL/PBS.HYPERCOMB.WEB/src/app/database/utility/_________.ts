// angular imports
import { Injectable, effect, inject } from '@angular/core'

// app imports
import { ServiceBase } from '../../service-base'
import { DatabaseService } from '../database-service'
import { ImageDatabase } from '../images/image-database'

@Injectable({ providedIn: 'root' })
export class DatabaseMaintenanceService extends ServiceBase {
    // injects (one-line)
    private readonly db = inject(DatabaseService)
    private readonly images = inject(ImageDatabase)

    constructor() {
        super()

        // listen for Ctrl+Alt+Shift+F1 â†’ full clean
        effect(() => {
            const e = this.ks.keyUp()
            if (!e) return
            const match = this.ks.when(e).key('F1', {
                ctrl: true,
                alt: true,
                shift: true,
            })
            if (!match) return

            debugger
            this.cleanAll()
        })
    }

    private cleanAll = async () => {
        await this.db.clean()
        await this.images.clean()
        console.log('âœ… databases cleaned')
    }
}


