// TextGeneration.ts
import { app, HttpRequest, HttpResponseInit } from "@azure/functions";
import { formatResponse, readRequestBody, handleError, TokenValidationService } from 'hypercomb-validation';
import { HYPERCOMB_AUTH } from '../constants/authorization-constants.js';

const tokenService = new TokenValidationService(HYPERCOMB_AUTH.REALMS.PORTAL.PROTOCOL.OPENID.CERTS);

export async function TextGeneration(req: HttpRequest, context: any): Promise<HttpResponseInit> {
    try {

    // Validate and decode the token
    const token = <any>req.headers.get('authorization')?.split(' ')[1];
    const isValid = await tokenService.validateToken(token);
    if (!isValid) {
        return { status: 403, body: 'Unauthorized, please try again' };
    }

        // Read and parse the request body
        const body = await readRequestBody(req);
        const prompt = body.prompt;
        if (!prompt) {
            return formatResponse(400, "Please provide a prompt for text generation.");
        }

        // Prepare OpenAI text call
        const openaiApiKey = process.env.OPENAI_API_KEY;
        const apiUrl = <string>process.env.API_TEXT_GENERATIONS_ENDPOINT;
        const requestBody = {
            "model": "gpt-3.5-turbo",
            "prompt": prompt,
            "max_tokens": 150
        };

        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${openaiApiKey}`
        };

        // Fetch the text response
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            throw new Error(`API request failed with status ${response.status}`);
        }

        const data = await response.json();
        return formatResponse(200, data);

    } catch (error: any) {
        return handleError(error);
    }
}

app.http('TextGeneration', {
    methods: ['GET', 'POST'],
    authLevel: 'anonymous',
    handler: TextGeneration
});
