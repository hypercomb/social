
@Injectable({
  providedIn: 'root'
})
export class StateService {

  dirty: Subject<boolean> = new Subject<boolean>()
  center$:  Subject<boolean> = new Subject<boolean>()
  isCtrlDown: boolean = false
  link$: Subject<string> = new Subject<string>()
  panning$: Subject<boolean> = new Subject<boolean>()
  selection?: fabric.Image
  setAnchor$:   Subject<boolean> = new Subject<boolean>()
  shiftKey: boolean = false
  spaceKey: boolean  =false
  showCropper$: Subject<boolean> = new Subject<boolean>()
  showLinkInput$: Subject<boolean> = new Subject<boolean>()
  
  height: number
  width: number
  
  

  get locator(): string { return window.location.pathname.split('/').pop()! }

  constructor() {

    this.width = window.innerWidth
    this.height = window.innerHeight
    this.center$.subscribe({ 
this.debug.log('shortcuts', 'center pressed')
    })
    this.dirty.subscribe(this.updateDirty)
    this.link$.subscribe({
      next: (link) => {
        (<any>this.selection).link = link
      }
    })
    this.panning$.subscribe({ 
      next: (active) => this.spaceKey = active
    })
  
    this.setAnchor$.subscribe({ 
      next: (active:boolean) => {
        (<any>this.selection).anchor = active
      }
    })
    this.showCropper$.subscribe(this.updateDirty)
    this.showLinkInput$.subscribe(this.updateDirty)
  
  
  }

  private updateDirty (dirty: boolean) {
    if (dirty) {
      document.body.style.borderWidth =  ".5em"
    }
  }

  reset() {
    this.showCropper$.next(false)
    this.showLinkInput$.next(false)
    document.body.style.borderWidth = "0"
  }
} 


