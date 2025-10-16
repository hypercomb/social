import { app, HttpRequest, HttpResponseInit } from "@azure/functions";
import { formatResponse, handleError } from 'hypercomb-validation';
import { CosmosClient, CosmosClientOptions } from '@azure/cosmos';
import { constants } from "../constants.js";

// Initialize Cosmos DB client with retry options
const cosmosClientOptions: CosmosClientOptions = {
    endpoint: process.env.COSMOS_ENDPOINT!,
    key: process.env.COSMOS_ACCESS_KEY!,
    userAgentSuffix: "CosmosDBRetrySample",
    connectionPolicy: {
        retryOptions: {
            fixedRetryIntervalInMilliseconds: 500,
            maxRetryAttemptCount: 9,
            maxWaitTimeInSeconds: 30000
        }
    }
};

const cosmosClient = new CosmosClient(cosmosClientOptions);
const database = cosmosClient.database('hives');
const container = database.container(constants.container);

export async function QueryJsonDocument(req: HttpRequest, context: any): Promise<HttpResponseInit> {
    try {
        const hiveId: string | null = req.query.get('hiveId');
        const userId: string | null = req.query.get('userId');

        if (!hiveId) {
            return formatResponse(400, "Missing hiveId.");
        }

        const parameters = [
            { name: '@hiveId', value: hiveId.toLowerCase().trim() }
        ];

        let query = "SELECT * FROM c WHERE LOWER(c.hiveId) = @hiveId AND c.isDeleted = false";

        if (userId) {
            query += " AND LOWER(c.userId) = @userId";
            parameters.push({ name: '@userId', value: userId.toLowerCase().trim() });
        }

        const querySpec = { query, parameters };

        console.log(querySpec.query);
        console.log(`Executing query with hiveId: ${hiveId} ${userId ? 'and userId: ' + userId : ''}`);

        const queryResult = container.items.query(querySpec);
        const { resources } = await queryResult.fetchAll();

        if (!resources?.length) {
            return formatResponse(200, { result: 'not found' });
        }

        const record = resources[0];
        return formatResponse(200, record);

    } catch (error: any) {
        return handleError(error);
    }
}

app.http('QueryJsonDocument', {
    methods: ['GET'],
    authLevel: 'anonymous',
    handler: QueryJsonDocument
});
