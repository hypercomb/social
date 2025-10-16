import { app, HttpRequest, HttpResponseInit } from "@azure/functions";
import { formatResponse, handleError } from 'hypercomb-validation';
import { CosmosClient } from '@azure/cosmos';
import { constants } from "../constants.js";

// Initialize Cosmos DB client
const cosmosClient = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING);
const database = cosmosClient.database('hives');
const container = database.container(constants.container);

export async function CheckHiveUpdates(req: HttpRequest): Promise<HttpResponseInit> {
    try {
        const hiveId = req.query.get("hiveId");
        const storedEtag = req.query.get("_etag");

        if (!hiveId || !storedEtag) {
            return formatResponse(400, "Please provide hiveId and storedEtag.");
        }

        // Check if document exists
        const querySpec = {
            query: "SELECT * FROM c WHERE c.hiveId = @hiveId AND !isDeleted",
            parameters: [
                { name: "@hiveId", value: hiveId.trim() }
            ]
        };

        const { resources: documents } = await container.items.query(querySpec).fetchAll();

        if (documents.length > 0) {
            const document = documents[0];
            const currentEtag = document._etag;

            if (currentEtag !== storedEtag) {
                return formatResponse(200, { changed: true, message: 'Document has been updated.', _etag: currentEtag });
            } else {
                return formatResponse(200, { changed: false, message: 'Document is up to date.', _etag: currentEtag });
            }
        } else {
            return formatResponse(404, "Document not found.");
        }
    } catch (error: any) {
        console.error(`Error handling request: ${error.message}`);
        return handleError(error);
    }
}

app.http('CheckHiveUpdates', {
    methods: ['GET'],
    authLevel: 'anonymous',
    handler: CheckHiveUpdates
});
