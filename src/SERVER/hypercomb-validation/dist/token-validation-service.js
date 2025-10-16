"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TokenValidationService = void 0;
const jwksClient = require('jwks-rsa');
const jwt = require('jsonwebtoken');
class TokenValidationService {
    constructor(jwksUri) {
        this.client = jwksClient({
            jwksUri: jwksUri,
            cache: true,
            cacheMaxAge: 86400000,
        });
    }
    getKey(kid) {
        return __awaiter(this, void 0, void 0, function* () {
            return yield this.client.getSigningKey(kid);
        });
    }
    validateToken(req) {
        var _a;
        return __awaiter(this, void 0, void 0, function* () {
            debugger;
            const token = (_a = req.headers.get('authorization')) === null || _a === void 0 ? void 0 : _a.split(' ')[1];
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
                const signingKey = yield this.getKey(kid);
                const key = signingKey.getPublicKey();
                return yield new Promise((resolve) => {
                    jwt.verify(token, key, (err) => {
                        if (err) {
                            console.error('JWT verification failed:', err.message);
                            resolve(false);
                        }
                        else {
                            resolve(true);
                        }
                    });
                });
            }
            catch (error) {
                console.error('Error in token validation:', error.message);
                return false;
            }
        });
    }
}
exports.TokenValidationService = TokenValidationService;
//# sourceMappingURL=token-validation-service.js.map