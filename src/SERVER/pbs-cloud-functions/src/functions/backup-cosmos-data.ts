import { app, HttpRequest, HttpResponseInit } from "@azure/functions";
import { formatResponse, handleError } from 'hypercomb-validation';
import { CosmosClient } from '@azure/cosmos';
import * as stream from 'stream';
import { constants } from "../constants.js";

const cosmosClient = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING);
const database = cosmosClient.database('hives');
const container = database.container(constants.container);

export async function BackupCosmosData(req: HttpRequest, context: any): Promise<HttpResponseInit> {
    try {
        if (req.method !== 'GET') {
            return formatResponse(405, "Method not allowed. Only GET is supported.");
        }

        // Query all documents from the container
        const { resources: items } = await container.items.readAll().fetchAll();
        const jsonContent = JSON.stringify(items, null, 2);

        // Create a readable stream from the JSON content
        const readableStream = new stream.Readable();
        readableStream.push(jsonContent);
        readableStream.push(null);

        // Set the response headers to return a downloadable file
        context.res = {
            status: 200,
            body: readableStream,
            headers: {
                'Content-Type': 'application/json',
                'Content-Disposition': `attachment; filename="backup-${Date.now()}.json"`
            }
        };
    } catch (error: any) {
        context.log.error('Error exporting data:', error);
        return handleError(error);
    }
}

app.http('BackupCosmosData', {
    methods: ['GET'],
    authLevel: 'anonymous',
    handler: BackupCosmosData
});
