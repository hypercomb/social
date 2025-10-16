import { Injectable, inject } from '@angular/core'
import { ClipboardState } from './clipboard-state'
import { HoneycombService } from 'src/app/unsorted/utility/honeycomb-service'
import { WithWorkspaceMixin } from 'src/app/workspace/workspace.base'

// small common base for clipboard actions
@Injectable({ providedIn: 'root' })
export class ClipboardOperation extends WithWorkspaceMixin(class { }) {
    protected readonly clipboardState = inject(ClipboardState)
    protected readonly honeycomb = inject(HoneycombService)
}


