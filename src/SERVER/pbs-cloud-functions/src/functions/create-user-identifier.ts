import { app, HttpRequest, HttpResponseInit } from "@azure/functions";
import { formatResponse, handleError, readRequestBody } from 'hypercomb-validation';
import { CosmosClient } from '@azure/cosmos';
import { TokenValidationService } from 'hypercomb-validation';
import { HYPERCOMB_AUTH } from '../constants/authorization-constants.js';

const tokenService = new TokenValidationService(HYPERCOMB_AUTH.REALMS.PORTAL.PROTOCOL.OPENID.CERTS);

// Initialize Cosmos DB client
const cosmosClient = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING);
const database = cosmosClient.database('hives');
const container = database.container('identifiers');

export async function CreateUserIdentifier(req: HttpRequest, context: any): Promise<HttpResponseInit> {
    try {
        // Validate and decode the token
        const isValid = await tokenService.validateToken(req);
        if (!isValid) {
            return { status: 403, body: 'Unauthorized, please try again' };
        }

        if (req.method !== 'POST') {
            return formatResponse(405, "Method not allowed. Only POST is supported.");
        }

        // Read and parse the request body
        const body = await readRequestBody(req);
        const { userId } = body;

        if (!userId) {
            return formatResponse(400, "Please provide userId.");
        }

        // Define the partition key
        const partitionKey = userId;

        // Check if the userId already exists
        try {
            const { resource: existingUser } = await container.item(userId, partitionKey).read();

            if (existingUser) {
                return formatResponse(409, "userId already exists");
            }
        } catch (error) {
            if (error.code !== 404) {
                return handleError(error);
            }
        }

        // Create a new document with userId as the id and partition key
        const newDocument = {
            id: userId, // use userId as the document id
            userId: userId
        };

        try {
            const { resource: createdDocument } = await container.items.create(newDocument);
            return formatResponse(201, {
                message: 'userId created successfully',
                document: createdDocument
            });
        } catch (error) {
            return formatResponse(500, `Error creating document: ${error.message}`);
        }
    } catch (error: any) {
        return handleError(error);
    }
}

app.http('CreateUserIdentifier', {
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: CreateUserIdentifier
});
