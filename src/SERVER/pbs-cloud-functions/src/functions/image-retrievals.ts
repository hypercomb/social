import { app, HttpRequest, HttpResponseInit } from "@azure/functions";
import { getJson, TokenValidationService } from 'hypercomb-validation';
import { HYPERCOMB_AUTH } from '../constants/authorization-constants.js';

const tokenService = new TokenValidationService(HYPERCOMB_AUTH.REALMS.PORTAL.PROTOCOL.OPENID.CERTS);

export async function ImageRetrieval(req: HttpRequest, context: any): Promise<HttpResponseInit> {

    // Validate and decode the token
    const token = <any>req.headers.get('authorization')?.split(' ')[1];
    const isValid = await tokenService.validateToken(token);
    if (!isValid) {
        return { status: 403, body: 'Unauthorized, please try again' };
    }

    const body = await getJson(req);

    // ensure prompt is in the request
    let prompt = body.prompt;
    if (!prompt) {
        return {
            status: 400,
            body: "Please provide a prompt for image generation."
        };
    }

    // prepare open ai image call.
    const openaiApiKey = process.env.OPENAI_API_KEY;
    const apiUrl = <string>process.env.API_IMAGE_GENERATIONS_ENDPOINT;
    const requestBody = {
        "model": "dall-e-2",
        "prompt": prompt,
        "n": 1,
        "size": "256x256"
    };

    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${openaiApiKey}`
    };

    try {

        // fetch the image
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(requestBody)
        });

        // request failed
        if (!response.ok) {
            throw new Error(`API request failed with status ${response.status}`);
        }

        // return the link result
        const data = await response.json();
        return {
            status: 200,
            body: JSON.stringify(data),
            headers: {
                'Content-Type': 'application/json'
            }
        };
    } catch (error: any) {
        return {
            status: 500,
            body: `Error generating images: ${error.message}`
        };
    }
};

app.http('ImageRetrieval', {
    methods: ['GET', 'POST'],
    authLevel: 'anonymous',
    handler: ImageRetrieval
});
