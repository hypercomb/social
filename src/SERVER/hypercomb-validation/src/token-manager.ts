import { TokenValidationService } from "./token-validation-service";

const jwt = require('jsonwebtoken');

export class TokenManager {
    private tokenService: any;

    constructor(tokenServiceEndpoint: string) {
        this.tokenService = new TokenValidationService(tokenServiceEndpoint);
    }

    async decodeToken(token: string) {
        return jwt.decode(token, { complete: true });
    }

    async getKey(decodedToken: any) {
        const kid = decodedToken.header.kid;
        return this.tokenService.getKey(kid);
    }

    async validateToken(key: string, token: string) {
        return this.tokenService.validateToken(key, token);
    }
}
