import { Injectable } from "@angular/core"

@Injectable({ providedIn: 'root' })
export class Preferences {
    public showTabEditIcon: boolean = false
    public showDoubleClickIcon: boolean = false
}


