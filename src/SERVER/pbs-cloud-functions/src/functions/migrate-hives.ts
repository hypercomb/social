import { app, HttpRequest, HttpResponseInit } from "@azure/functions";
import { formatResponse, handleError } from 'hypercomb-validation';
import { CosmosClient } from '@azure/cosmos';
import { constants } from "../constants.js";

const cosmosClient = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING);
const sourceDatabase = cosmosClient.database('hives');
const sourceContainer = sourceDatabase.container('hives-container');
const destinationContainer = sourceDatabase.container(constants.container);

export async function MigrateHives(req: HttpRequest, context: any): Promise<HttpResponseInit> {
    try {
        if (req.method !== 'GET') {
            return formatResponse(405, "Method not allowed. Only POST is supported.");
        }

        context.log('Starting data retrieval from source container.');

        // Query all documents from the source container
        const { resources: items } = await sourceContainer.items.readAll().fetchAll();

        if (items.length === 0) {
            context.log('No documents found in the source container.');
            return formatResponse(204, "No Content");
        }

        context.log(`Retrieved ${items.length} documents from source container.`);

        // Insert each document into the destination container
        for (const item of items) {
            const { id, ...rest } = item; // Ensure unique ids if necessary
            const newItem = { ...rest, id: item.id }; // Optionally generate new id if required

            await destinationContainer.items.create(newItem);
        }

        context.log('Data moved successfully.');

        return formatResponse(200, "Data moved successfully.");
    } catch (error: any) {
        context.log.error('Error moving data:', error);
        return handleError(error);
    }
}

app.http('MigrateHives', {
    methods: ['GET'],
    authLevel: 'anonymous',
    handler: MigrateHives
});
