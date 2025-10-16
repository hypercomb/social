import { app, HttpRequest, HttpResponseInit } from "@azure/functions";
import { formatResponse, handleError, readRequestBody } from 'hypercomb-validation';
import { CosmosClient } from '@azure/cosmos';
import * as crypto from 'crypto';
import { constants } from "../constants.js";
import { TokenValidationService } from 'hypercomb-validation';
import { TokenDecoder } from "./scripts/token-decoder.js";
import { HYPERCOMB_AUTH } from '../constants/authorization-constants.js';

const decoder = new TokenDecoder();
const tokenService = new TokenValidationService(HYPERCOMB_AUTH.REALMS.PORTAL.PROTOCOL.OPENID.CERTS);

// Initialize Cosmos DB client
const cosmosClient = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING);
const database = cosmosClient.database('hives');
const container = database.container(constants.container);

function generateUniqueId(): string {
    return crypto.randomUUID();
}

export async function PublishJsonDocument(req: HttpRequest, context: any): Promise<HttpResponseInit> {
    try {

        // Validate and decode the token
        const isValid = await tokenService.validateToken(req);
        if (!isValid) {
            return { status: 403, body: 'Unauthorized, please try again' };
        }


        if (req.method !== 'POST') {
            return formatResponse(405, "Method not allowed. Only POST is supported.");
        }

        const authToken = await decoder.decode(req);

        const identifier = authToken.payload["identifier"]
        
        // validate publisher role.
        const roles = authToken?.payload?.realm_access?.roles|| [];

        if (!roles.includes('publisher')) {
            context.res = { status: 403, body: 'Forbidden: Missing publisher role' };
            return;
        }

        if (!identifier) {
            return { status: 403, body: 'Unauthorized, please assign user identifier' };
        }

        // Read and parse the request body
        const body = await readRequestBody(req);
        const { hiveId, caption, uniqueId, data } = body;
        const [path, fragment] = hiveId.split('#');

        if (!path || !uniqueId || !data) {
            return formatResponse(400, "Please provide hiveId, uniqueId, and data.");
        }
        
        // Define the partition key
        const partitionKey = identifier;

        // Check if documents exist
        const querySpec = {
            query: "SELECT * FROM c WHERE c.hiveId = @hiveId AND c.userId = @userId",
            parameters: [
                { name: "@hiveId", value: path.trim() },
                { name: "@userId", value: identifier.trim() }
            ]
        };

        const { resources: documents } = await container.items.query(querySpec).fetchAll();
        const { resource: containerSettings } = await container.read();

        if (containerSettings.uniqueKeyPolicy && containerSettings.uniqueKeyPolicy.uniqueKeys) {
            console.log("Unique Keys:", containerSettings.uniqueKeyPolicy.uniqueKeys);
        } else {
            console.log("No unique keys defined.");
        }

        // Update all found documents to set isDeleted = true
        for (const document of documents) {
            const updatedData = { ...document, isDeleted: true };
            await container.item(document.id, partitionKey).replace(updatedData);
        }

        // Create a new document with isDeleted = false and a UUID as the id
        const newDocument = {
            id: generateUniqueId(),
            caption,
            hiveId: path,
            userId: identifier,
            uniqueId,
            data,
            isDeleted: false
        };

        try {

            const { resource: createdDocument } = await container.items.upsert(newDocument);

            return formatResponse(201, {
                message: 'Documents updated and new document created successfully',
                document: createdDocument,
                _etag: createdDocument._etag.replace(/"/g, "") // Include the new etag in the response
            });
        } catch (error) {
            return formatResponse(500, `Error creating document: ${error.message}`);
        }
    } catch (error: any) {
        return handleError(error);
    }
}

app.http('PublishJsonDocument', {
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: PublishJsonDocument
});
