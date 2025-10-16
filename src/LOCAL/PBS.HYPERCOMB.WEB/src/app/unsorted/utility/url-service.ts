

@Injectable({ providedIn: 'root' })
export class UrlService {

    private codes = codes
    constructor(private SerializationService: SerializationService) { }

    public getCode = async (data) => {
        let code = data.HiveUri
        if (!code) {
            const lookup = data.hive.split('-')[1].substring(0, 8)
            code = this.codes.find(c => c.includes(lookup))
        }
        return code.replace('.json', '')
    }

    public getFromStorage(): string {
        const url = localStorage.getItem(Constants.ImageSource)! || 'assets/place-image.png'
        return url
    }

}


