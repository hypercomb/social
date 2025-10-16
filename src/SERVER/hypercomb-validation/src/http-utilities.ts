import { HttpRequest, HttpResponseInit } from "@azure/functions";

export function handleError(error: any): HttpResponseInit {
    // Customize error handling logic
    const status = error.status || 500;
    const message = error.message || 'Internal server error';
    return formatResponse(status, { error: message });
}

export async function readRequestBody(req: HttpRequest): Promise<any> {
    const chunks = [];
    for await (let chunk of req.body) {
        chunks.push(chunk);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf-8'));
}

export function formatResponse(status: number, body: any, contentType = 'application/json'): HttpResponseInit {
    return {
        status: status,
        body: JSON.stringify(body),
        headers: { 'Content-Type': contentType }
    };
}

export async function getJson(request: HttpRequest) : Promise<any>  {
    // read the body object
    const chunks = [];
    for await (let chunk of request.body) {
        chunks.push(chunk);
    }

    const bodyString = Buffer.concat(chunks).toString('utf-8');
    const body = JSON.parse(bodyString);
    return body;
}
