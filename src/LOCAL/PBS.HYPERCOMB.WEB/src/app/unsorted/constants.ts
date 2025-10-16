import { environment } from "src/environments/environment"

const DatabaseConstants = {
    TRUE: 1,
    FALSE: 0,
    ClipboardHive: 'hypercomb-clipboard-identifier',
}

export const HiveEvents = {
    CancelPanningEvent: 'cancel-panning',
    ClearCanvas: 'clear-canvas',
    HexagonDetected: 'hexagon-detected',
    HexagonDropped: 'hexagon-dropped',
    HexagonImageDropped: 'hexagon-image-dropped',
    HexagonLinkDropped: 'hexagon-link-dropped',
    StartedEditing: 'started-editing',
}

export enum LocalAssets {
  Background = 'assets/svg/tile-icons-background.svg',
  NInitialImagePath = 'assets/initial-tile.png',
  TileMask = 'assets/hexagon-cutout.png',
  PlaceholderPath = 'assets/guide-tile.png',
  YouTube = 'assets/youtube.png',
}



const NamedConstants = {
    BuildMode: 'build-mode',
    LastHiveVisited: 'last-hive-visited',
    OldDatabaseIdentifier: 'Hypercomb' + 'Database',
    DatabaseIdentifier: 'Database',
    HiveOrigin: 0,
    OldImageDatabaseIdentifier: 'Hypercomb' + 'ImageDatabase',
    ImageDatabaseIdentifier: 'hypercomb-images',
    ImageSource: 'ImageSource',
    InitialRevisionNumber: 0,
    HypercombDataType: 'hypercomb',
    NeedsCentering: 'needs-centering',
    HexagonSide: 200,
}

const EndPointsConstants = {
    hypercombio: 'https://hypercomb.io'
}

const SecruredEndPointConstants = {
    connection: 'https://localhost:7024/tile-hub',
    jsonAiQuery: 'https://pbs-hypercomb-ai-functions.azurewebsites.net/api/JsonQuery',
    publishQuery: 'http://localhost:7071/api/PublishJsonDocument',
    storeImage: 'https://pbs-hypercomb-ai-functions.azurewebsites.net/api/StoreTileImage',
    validateQuery: 'http://localhost:7071/api/ValidateUserIdentifier',
    imageGeneration: 'https://pbs-hypercomb-ai-functions.azurewebsites.net/api/ImageRetrieval',
    functionUrl: 'https://pbs-hypercomb-ai-functions.azurewebsites.net/api/GetOpenGraphMetadata'
}

const DefaultConstants = {
    ServerHeadTimeout: 200,
    ...DatabaseConstants,
    ...NamedConstants,
    ...SecruredEndPointConstants,
    ...EndPointsConstants,
    apiEndpoint: 'https://pbs-hypercomb-ai-functions.azurewebsites.net/api',
    accountsUrl: 'https://accounts.hypercomb.io/realms/pbs',
    connection: 'https://pbs-hypercomb-hive-relay-app-service.azurewebsites.net/tile-hub',
    conigurationKey: 'r4A1vOAncBP4hzDTZHaacHutbi-VXSJPkFNwIVm6JK5fAzFuh2APIg==',
    configuration: 'https://storagehypercomb.blob.core.windows.net/hypercomb-data/',
    storage: 'https://storagehypercomb.blob.core.windows.net/hypercomb-images/',
    comfyui: 'http://comfy.hypercomb.io',
    configureHeaders: () => {
        return {
            'Content-Type': 'application/jsoncharset=utf-8',
            'x-functions-key': DefaultConstants.conigurationKey,
        }
    },

    postHeaders: () => {
        return {
            'x-functions-key': DefaultConstants.conigurationKey,
        }
    }
}

const DebugConstants = {
    ...DefaultConstants,
    apiEndpoint: 'http://localhost:7071/api',
    comfyui: 'http://localhost:8818',
    publishEndpoint: 'http://localhost:7071/api/PublishJsonDocument',
    connection: 'https://localhost:7024/tile-hub',
    storeImage: 'http://localhost:7071/api/StoreTileImage',
    imageGeneration: 'ImageRetrieval',
    // functionUrl : 'http://localhost:7071/api/GetOpenGraphMetadata'
}


const Constants = environment.production ? DefaultConstants : DebugConstants
export { Constants }

console.log(`production: (${environment.production}) loading ${environment.production ? 'production' : 'development'} configuration`)


