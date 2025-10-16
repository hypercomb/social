import { app, HttpRequest, HttpResponseInit } from "@azure/functions";
import { formatResponse, handleError, TokenValidationService } from 'hypercomb-validation';
import { CosmosClient } from '@azure/cosmos';
import { constants } from "../constants.js";
import { HYPERCOMB_AUTH } from '../constants/authorization-constants.js';

const tokenService = new TokenValidationService(HYPERCOMB_AUTH.REALMS.PORTAL.PROTOCOL.OPENID.CERTS);

// Initialize Cosmos DB client
const cosmosClient = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING);
const database = cosmosClient.database('hives');
const container = database.container(constants.container);

export async function SelectAndUpdateDocuments(req: HttpRequest, context: any): Promise<HttpResponseInit> {
    try {
        // const token = req.headers['authorization'];

        // if (!token) {
        //     return formatResponse(401, "Authorization token is required.");
        // }

        // const tokenPayload = await tokenService.validateToken(token);

        // Query for all documents related to the user
        const querySpec = {
            query: "SELECT * FROM c",
        };

        const { resources: documents } = await container.items.query(querySpec).fetchAll();

        if (documents.length > 0) {
            const updatedDocuments = [];

            // Find the first document for each distinct hiveId and update it
            const uniqueHiveIds = new Set<string>();

            for (const document of documents) {
                if (!uniqueHiveIds.has(document.hiveId)) {
                    uniqueHiveIds.add(document.hiveId);

                    // Update the document to add the isDeleted flag
                    const updatedData = { ...document, isDeleted: false };

                    const { resource: updatedDocument } = await container
                        .item(document.id, document.partitionKey)
                        .replace(updatedData);

                    updatedDocuments.push(updatedDocument);
                }
            }

            return formatResponse(200, {
                message: 'Documents updated successfully',
                documents: updatedDocuments
            });
        } else {
            return formatResponse(404, "No documents found for the user.");
        }
    } catch (error: any) {
        console.error(`Error handling request: ${error.message}`);
        return handleError(error);
    }
}

app.http('SelectAndUpdateDocuments', {
    methods: ['PUT'],
    authLevel: 'anonymous',
    handler: SelectAndUpdateDocuments
});
