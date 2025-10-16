export declare class TokenManager {
    private tokenService;
    constructor(tokenServiceEndpoint: string);
    decodeToken(token: string): Promise<any>;
    getKey(decodedToken: any): Promise<any>;
    validateToken(key: string, token: string): Promise<any>;
}
