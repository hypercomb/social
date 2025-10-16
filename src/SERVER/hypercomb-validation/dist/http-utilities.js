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
var __asyncValues = (this && this.__asyncValues) || function (o) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var m = o[Symbol.asyncIterator], i;
    return m ? m.call(o) : (o = typeof __values === "function" ? __values(o) : o[Symbol.iterator](), i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () { return this; }, i);
    function verb(n) { i[n] = o[n] && function (v) { return new Promise(function (resolve, reject) { v = o[n](v), settle(resolve, reject, v.done, v.value); }); }; }
    function settle(resolve, reject, d, v) { Promise.resolve(v).then(function(v) { resolve({ value: v, done: d }); }, reject); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getJson = exports.formatResponse = exports.readRequestBody = exports.handleError = void 0;
function handleError(error) {
    // Customize error handling logic
    const status = error.status || 500;
    const message = error.message || 'Internal server error';
    return formatResponse(status, { error: message });
}
exports.handleError = handleError;
function readRequestBody(req) {
    var _a, e_1, _b, _c;
    return __awaiter(this, void 0, void 0, function* () {
        const chunks = [];
        try {
            for (var _d = true, _e = __asyncValues(req.body), _f; _f = yield _e.next(), _a = _f.done, !_a; _d = true) {
                _c = _f.value;
                _d = false;
                let chunk = _c;
                chunks.push(chunk);
            }
        }
        catch (e_1_1) { e_1 = { error: e_1_1 }; }
        finally {
            try {
                if (!_d && !_a && (_b = _e.return)) yield _b.call(_e);
            }
            finally { if (e_1) throw e_1.error; }
        }
        return JSON.parse(Buffer.concat(chunks).toString('utf-8'));
    });
}
exports.readRequestBody = readRequestBody;
function formatResponse(status, body, contentType = 'application/json') {
    return {
        status: status,
        body: JSON.stringify(body),
        headers: { 'Content-Type': contentType }
    };
}
exports.formatResponse = formatResponse;
function getJson(request) {
    var _a, e_2, _b, _c;
    return __awaiter(this, void 0, void 0, function* () {
        // read the body object
        const chunks = [];
        try {
            for (var _d = true, _e = __asyncValues(request.body), _f; _f = yield _e.next(), _a = _f.done, !_a; _d = true) {
                _c = _f.value;
                _d = false;
                let chunk = _c;
                chunks.push(chunk);
            }
        }
        catch (e_2_1) { e_2 = { error: e_2_1 }; }
        finally {
            try {
                if (!_d && !_a && (_b = _e.return)) yield _b.call(_e);
            }
            finally { if (e_2) throw e_2.error; }
        }
        const bodyString = Buffer.concat(chunks).toString('utf-8');
        const body = JSON.parse(bodyString);
        return body;
    });
}
exports.getJson = getJson;
//# sourceMappingURL=http-utilities.js.map