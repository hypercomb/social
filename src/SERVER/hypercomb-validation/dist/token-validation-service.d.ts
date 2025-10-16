export declare class TokenValidationService {
    client: any;
    constructor(jwksUri: any);
    getKey(kid: any): Promise<any>;
    validateToken(req: any): Promise<unknown>;
}
