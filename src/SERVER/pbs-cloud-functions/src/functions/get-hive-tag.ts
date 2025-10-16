import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { CosmosClient } from '@azure/cosmos';
import { constants } from '../constants.js';
import { TokenValidationService } from 'hypercomb-validation';
import { HYPERCOMB_AUTH } from '../constants/authorization-constants.js';

// Initialize Cosmos DB client
const cosmosClient = new CosmosClient(process.env.COSMOS_DB_CONNECTION_STRING);
const database = cosmosClient.database('hives');
const container = database.container(constants.container);

const tokenService = new TokenValidationService(HYPERCOMB_AUTH.REALMS.PORTAL.PROTOCOL.OPENID.CERTS);


export async function GetHiveTag(req: HttpRequest): Promise<HttpResponseInit> {
    try {
        // Validate and decode the token
        const token = <any>req.headers.get('authorization')?.split(' ')[1];
        const isValid = await tokenService.validateToken(token);
        if (!isValid) {
            return { status: 403, body: 'Unauthorized, please try again' };
        }

        const hiveId = req.query.get('hiveId');

        if (!hiveId) {
            return {
                status: 400,
                body: "Please pass a hiveId on the query string or in the request body"
            };
        }

        const querySpec = {
            query: "SELECT * FROM c WHERE c.hiveId = @hiveId",
            parameters: [
                {
                    name: "@hiveId",
                    value: hiveId
                }
            ]
        };

        const { resources: items } = await container.items.query(querySpec).fetchAll();

        if (items.length === 0) {
            return {
                status: 404,
                body: "Hive not found"
            };
        }

        const _etag = items[0]._etag.replace(/"/g, ""); // Assuming '_etag' is the correct property

        return {
            status: 200,
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({ _etag })
        };
    } catch (error) {
        return {
            status: 500,
            body: `Error fetching hive: ${error.message}`
        };
    }
}

// Register the function
app.http('GetHiveTag', {
    methods: ['GET'],
    authLevel: 'anonymous',
    handler: GetHiveTag
});
