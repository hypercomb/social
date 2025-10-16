import { app, HttpRequest, HttpResponseInit } from "@azure/functions";
import { formatResponse, handleError, readRequestBody, TokenValidationService } from 'hypercomb-validation';
import { BlobServiceClient } from '@azure/storage-blob';
import * as crypto from 'crypto';
import sharp from 'sharp';
import { HYPERCOMB_AUTH } from '../constants/authorization-constants.js';
import { TokenDecoder } from "./scripts/token-decoder.js";

const decoder = new TokenDecoder();
const tokenService = new TokenValidationService(HYPERCOMB_AUTH.REALMS.PORTAL.PROTOCOL.OPENID.CERTS);
const blobServiceClient = BlobServiceClient.fromConnectionString(process.env.AZURE_STORAGE_CONNECTION_STRING);

export async function StoreTileImage(req: HttpRequest, context: any): Promise<HttpResponseInit> {
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


        // Read and validate the request body
        const body = await readRequestBody(req);
        const { imageBase64 } = body;

        if (!imageBase64) {
            return formatResponse(400, "Please provide a valid imageBase64.");
        }

        // Hash the userId
        const hashedUserId = crypto.createHash('sha256').update(identifier).digest('hex');

        // Strip out any data URL part
        const cleanBase64 = imageBase64.replace(/^data:image\/[a-zA-Z+]+;base64,/, '');
        const buffer = Buffer.from(cleanBase64, 'base64');

        // Convert image to WebP with reduced quality using sharp
        const webPBuffer = await sharp(buffer)
            .webp({ quality: 80 })
            .toBuffer();


        // Concatenate hashed userId to the image buffer before hashing (for hash calculation only)
        const combinedBuffer = Buffer.concat([Buffer.from(hashedUserId), webPBuffer]);

        const hash = crypto.createHash('sha256').update(combinedBuffer).digest('hex');
        const containerName = 'thumbnails';
        const blobName = `${hashedUserId}-${hash}.webp`; // Include hashedUserId in the blob name
        const containerClient = blobServiceClient.getContainerClient(containerName);

        const createResponse = await containerClient.createIfNotExists();
        if (createResponse.succeeded === false) {
            console.log('Container creation failed or not needed.');
        }

        const blockBlobClient = containerClient.getBlockBlobClient(blobName);
        await blockBlobClient.uploadData(webPBuffer, {
            blobHTTPHeaders: {
                blobContentType: 'image/webp' // Set MIME type to image/webp
            },
            metadata: { userId: hashedUserId }
        });

        return formatResponse(201, { message: 'Image uploaded successfully', blobUrl: blockBlobClient.url });

    } catch (error: any) {
        console.error(`Error handling request: ${error.message}`);
        return handleError(error);
    }
}

app.http('StoreTileImage', {
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: StoreTileImage
});
