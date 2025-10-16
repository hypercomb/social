
@Injectable({
    providedIn: 'root'
})
export class NotifyStartCollaboration extends SignalMessage {
    protected override get message(): string { return 'StartCollaboration' }

    constructor(injector: Injector) {
        super(injector)
    }
}


