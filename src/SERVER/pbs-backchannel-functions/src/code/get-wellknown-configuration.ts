import axios from "axios";

const baseurl = process.env.BASE_URL;

export async function getWellKnownConfiguration(): Promise<any> {
    try {
        const wellKnownUrl = `${baseurl}/realms/pbs/.well-known/openid-configuration`;
        const response = await axios.get(wellKnownUrl);
        return response.data;
    } catch (error) {
        console.error(error);
        throw error;
    }
}
