import jwt from "jsonwebtoken";

export class TokenDecoder { 

    public decode = async (req:any) :Promise<any> => {
        const token = <any>req.headers.get('authorization')?.split(' ')[1];
        const decodedToken = jwt.decode(token, { complete: true });
        return decodedToken;
    }
}
