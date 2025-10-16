import { app, HttpRequest, HttpResponseInit } from "@azure/functions";
import { formatResponse, handleError, readRequestBody, TokenValidationService } from 'hypercomb-validation';
import { BlobServiceClient } from '@azure/storage-blob';
import * as crypto from 'crypto';
import { HYPERCOMB_AUTH } from '../constants/authorization-constants.js';

const tokenService = new TokenValidationService(HYPERCOMB_AUTH.REALMS.PORTAL.PROTOCOL.OPENID.CERTS);
const blobServiceClient = BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);

export async function RemoveTileImage(req: HttpRequest, context: any): Promise<HttpResponseInit> {
    try {
        const token = req.headers['authorization'];
        if (!token) {
            return formatResponse(401, "Authorization token is required.");
        }

        const tokenPayload = await tokenService.validateToken(token);
        const userId = "00000001";

        if (!userId) {
            return formatResponse(403, "User ID is required in the token.");
        }

        const { blobUrl } = await readRequestBody(req);
        if (!blobUrl) {
            return formatResponse(400, "Please provide blobUrl.");
        }

        // Extract the blob name from the URL
        const urlParts = blobUrl.split('/');
        const blobName = urlParts[urlParts.length - 1];

        // Hash the userId
        const hashedUserId = crypto.createHash('sha256').update(userId).digest('hex');

        // Check if the blob name includes the hashedUserId
        if (!blobName.startsWith(hashedUserId)) {
            return formatResponse(403, "You do not have permission to delete this image.");
        }

        const containerName = 'thumbnails';
        const containerClient = blobServiceClient.getContainerClient(containerName);
        const blockBlobClient = containerClient.getBlockBlobClient(blobName);

        // Delete the blob
        await blockBlobClient.deleteIfExists();

        return formatResponse(200, { message: 'Image deleted successfully' });

    } catch (error: any) {
        console.error(`Error handling request: ${error.message}`);
        return handleError(error);
    }
}

app.http('RemoveTileImage', {
    methods: ['DELETE'],
    authLevel: 'anonymous',
    handler: RemoveTileImage
});
