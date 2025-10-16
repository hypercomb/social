
@Injectable({
    providedIn: 'root'
})
export class HandleStartCollaboration extends MessageHandler {
    public override get method(): string { return HandleStartCollaboration.name }
    constructor(injector: Injector) {
        super(injector)
    }

    protected override canHandle = async (...args: any[]): Promise<boolean> => {

        this.debug.log('http', `Received message from ${args}:`)
        const result = !localStorage.getItem("follower")
        return result
    }

    protected override onHandle = async (...args: any[]) => {

        const [leader] = args

        if (localStorage.getItem("leader") != leader) {
            localStorage.setItem("follower", "true")
        }

        // if (this.state.uniqueIdentifier != uniqueId) {
        //     const parsed = JSON.parse(message)
        //     const data = this.tileMapper.prepare(parsed)
        //     console.log(data)
        //     this.tileMessageReceived.emit(data)
        // }

    }
}


