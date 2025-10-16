
@Injectable({
    providedIn: 'root'
})
export class NavigationService {

    private undoStack: INavigationCommand[] = []
    private redoStack: INavigationCommand[] = []

    constructor(private injector: Injector, private router: Router) {
        this.router.events.pipe(
            filter(event => event instanceof NavigationStart)
        ).subscribe((event: any) => {
            if (event.navigationTrigger === 'popstate') {
                if (event.restoredState) {
                    if (event.id > event.restoredState.navigationId) {
                        // Forward navigation
                        this.handleForwardNavigation()
                    } else {
                        // Backward navigation
                        this.handleBackwardNavigation()
                    }
                }
            }
        })
    }

    navigate(command: INavigationCommand) {
        if (command) {
            command.navigate()
            this.undoStack.push(command)
            this.redoStack = []
            // Clear the redo stack on new navigation
        }
    }

    goHome(name: string) {

    }

    goBack() {
        if (this.undoStack.length > 0) {
            const command = this.undoStack.pop()!
            command.goBack()
            this.redoStack.push(command)
        } else {
            this.router.navigate(['']) // navigate to a default or previous route if stack is empty
        }
    }

    goForward() {
        if (this.redoStack.length > 0) {
            const command = this.redoStack.pop()!
            command.navigate()
            this.undoStack.push(command)
        }
    }

    private handleBackwardNavigation() {
        this.goBack()
    }

    private handleForwardNavigation() {
        this.goForward()
    }
}


