// src/app/hives/hive-name.service.ts
import { Injectable, inject } from '@angular/core'
import { NamingService } from 'src/app/database/utility/naming-service'
import { NotificationService } from 'src/app/unsorted/utility/notification-service'

@Injectable({ providedIn: 'root' })
export class HiveNameService {
    private readonly naming = inject(NamingService)
    private readonly notifications = inject(NotificationService)

    public sanitize(raw: string): string {
        if (!raw) return ''
        const decoded = decodeURIComponent(raw)
        return this.naming.createValidName(decoded).toLocaleLowerCase()
    }

    public async isValid(sanitized: string): Promise<boolean> {
        if (!sanitized) return false
        if (sanitized.length < 4) {
            this.notifications.warning(
                `this hive name ${sanitized} must be 4 chars or more`
            )
            return false
        }
        return true
    }

    public async prepare(raw: string): Promise<string | null> {
        const sanitized = this.sanitize(raw)
        return (await this.isValid(sanitized)) ? sanitized : null
    }
}


