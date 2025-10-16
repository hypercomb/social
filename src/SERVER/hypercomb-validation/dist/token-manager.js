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
exports.TokenManager = void 0;
const token_validation_service_1 = require("./token-validation-service");
const jwt = require('jsonwebtoken');
class TokenManager {
    constructor(tokenServiceEndpoint) {
        this.tokenService = new token_validation_service_1.TokenValidationService(tokenServiceEndpoint);
    }
    decodeToken(token) {
        return __awaiter(this, void 0, void 0, function* () {
            return jwt.decode(token, { complete: true });
        });
    }
    getKey(decodedToken) {
        return __awaiter(this, void 0, void 0, function* () {
            const kid = decodedToken.header.kid;
            return this.tokenService.getKey(kid);
        });
    }
    validateToken(key, token) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.tokenService.validateToken(key, token);
        });
    }
}
exports.TokenManager = TokenManager;
//# sourceMappingURL=token-manager.js.map