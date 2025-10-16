import { app, HttpRequest, HttpResponseInit } from "@azure/functions";
import { formatResponse, handleError, readRequestBody } from 'hypercomb-validation';
import { TokenValidationService } from 'hypercomb-validation';
import { TokenDecoder } from "./scripts/token-decoder.js";
import { HYPERCOMB_AUTH } from '../constants/authorization-constants.js';

const decoder = new TokenDecoder();
const tokenService = new TokenValidationService(HYPERCOMB_AUTH.REALMS.PORTAL.PROTOCOL.OPENID.CERTS);

export async function ValidateUserIdentifier(req: HttpRequest, context: any): Promise<HttpResponseInit> {
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
         const identifier = authToken.payload["identifier"];

        if (!identifier) {
            return { status: 403, body: 'Unauthorized, please assign user identifier' };
        }

        // Read and parse the request body
        const body = await readRequestBody(req);
        const { hiveId } = body;
        const [path, fragment] = hiveId.split('#');

        if (!path) {
            return formatResponse(400, "Please provide a valid hiveId.");
        }

        return formatResponse(200, {
            status: 200,
            message: 'User identifier is valid',
            userId: identifier
        });

    } catch (error: any) {
        return handleError(error);
    }
}

app.http('ValidateUserIdentifier', {
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: ValidateUserIdentifier
});
