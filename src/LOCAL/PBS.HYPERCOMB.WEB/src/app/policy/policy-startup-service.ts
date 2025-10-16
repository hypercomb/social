

@Injectable({ providedIn: 'root' })
export class PolicyStartupService {
    private readonly ps = inject(PolicyService)

    constructor() {
        // only touch TileSelectionRefresher if editor policies are active
        if (this.ps.has(POLICY.EditInProgress)) {
            // inject(TileSelectionRefresher)
        }
    }
}


