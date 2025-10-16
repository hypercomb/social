import { HttpRequest, HttpResponseInit } from "@azure/functions";
export declare function handleError(error: any): HttpResponseInit;
export declare function readRequestBody(req: HttpRequest): Promise<any>;
export declare function formatResponse(status: number, body: any, contentType?: string): HttpResponseInit;
export declare function getJson(request: HttpRequest): Promise<any>;
