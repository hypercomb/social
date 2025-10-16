import { app, HttpRequest, HttpResponseInit } from "@azure/functions";
import { formatResponse, handleError, readRequestBody, TokenValidationService } from 'hypercomb-validation';
import { HYPERCOMB_AUTH } from '../constants/authorization-constants.js';

const tokenService = new TokenValidationService(HYPERCOMB_AUTH.REALMS.PORTAL.PROTOCOL.OPENID.CERTS);

export async function JsonQuery(req: HttpRequest, context: any): Promise<HttpResponseInit> {
    try {
        // Validate and decode the token
        const isValid = await tokenService.validateToken(req);
        if (!isValid) {
            return { status: 403, body: 'Unauthorized, please try again' };
        }

        // Read and parse the request body
        const body = await readRequestBody(req);
        const userQuery = body.query;
        if (!userQuery) {
            return formatResponse(400, "Please provide a query.");
        }

        // Prepare OpenAI API call
        const openaiApiKey = process.env.OPENAI_API_KEY;
        const apiUrl = "https://api.openai.com/v1/chat/completions";
        const requestBody = {
            model: "gpt-3.5-turbo-1106",
            response_format: { "type": "json_object" },
            // messages: [
            //     { "role": "system", "content": "Output a list of 12 item in JSON format. Each item in the list should be an object with a single key 'Caption'. The value of 'Caption' should be a string combining the name and a brief description relevant to the user's query. The output list should be named 'Data'. For example, if the query is about popular YouTubers, each object might look like: { Caption: 'PewDiePie: Swedish YouTuber known for his Let's Play videos and comedic content.' }." },
            //     { "role": "user", "content": `Provide a list of current popular ${userQuery}. The information should be as accurate and up-to-date as possible.` }
            // ]
            messages: [
                { "role": "system", "content": "Output a list of items in JSON format. Each item in the list should be an object with a single key 'Caption'. The value of 'Caption' should be a few words containing the entity. The output list should be named 'Data'. For example, if the query is about popular software, each object might look like: { Caption: 'Microsoft 365: share and collaborate using your favorite apps' }." },
                { "role": "user", "content": `Provide a list of current popular item: ${userQuery}. The information should be as accurate and up-to-date as possible each time creating a new result different from the previous.` }
            ]
        };

        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${openaiApiKey}`
        };

        debugger
        // Fetch response from OpenAI
        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            throw new Error(`API request failed with status ${response.status}`);
        }

        const data = await response.json();
        const resultContent = JSON.parse(data.choices[0].message.content);

        // Assuming resultContent is an array of { Link, SourcePath, Caption }
        return formatResponse(200, resultContent);

    } catch (error: any) {
        return handleError(error);
    }
}

app.http('JsonQuery', {
    methods: ['GET', 'POST'],
    authLevel: 'anonymous',
    handler: JsonQuery
});
