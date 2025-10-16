
@Injectable({
    providedIn: 'root'
})
export class RequestHiveSynchronization extends SignalMessage {

    protected override get message(): string { return RequestHiveSynchronization.name }

    constructor(injector: Injector) {
        super(injector)
    }
}


