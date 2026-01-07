// database-manager.token.ts

import { InjectionToken } from "@angular/core"
import { IDatabaseManagerPort } from "../ports/i-database-management-port"


export const DATABASE_MANAGER = new InjectionToken<IDatabaseManagerPort>('DATABASE_MANAGER')


