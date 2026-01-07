import { Injectable } from "@angular/core"
import { Subject } from "rxjs"
import { HypercombMode } from "../models/enumerations"

@Injectable({
  providedIn: 'root'
})
export class ModeChangeService {
  private modeChangeSubject = new Subject<HypercombMode>()
  public modeChanged$ = this.modeChangeSubject.asObservable()

  emitModeChange(mode: HypercombMode) {
    this.modeChangeSubject.next(mode)
  }
}


