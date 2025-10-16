const jwksClient = require('jwks-rsa');
const jwt = require('jsonwebtoken');

export class TokenValidationService {
    client: any;
    constructor(jwksUri: any) {
        this.client = jwksClient({
            jwksUri: jwksUri,
            cache: true,
            cacheMaxAge: 86400000,
        });
    }

    async getKey(kid) {
        return await this.client.getSigningKey(kid);
    }

    async validateToken(req) {
        const token = <any>req.headers.get('authorization')?.split(' ')[1];
        if (!token) {
            return false;
        }
        
        const decodedToken = jwt.decode(token, { complete: true });
        if (!decodedToken || !decodedToken.header) {
            return false;
        }

        const kid = decodedToken.header.kid;
        if (!kid) {
            return false;
        }

        try {
            const signingKey = await this.getKey(kid);
            const key = signingKey.getPublicKey();

            return await new Promise((resolve) => {
                jwt.verify(token, key, (err) => {
                    if (err) {
                        console.error('JWT verification failed:', err.message);
                        resolve(false);
                    } else {
                        resolve(true);
                    }
                });
            });
        } catch (error) {
            console.error('Error in token validation:', error.message);
            return false;
        }
    }
}
