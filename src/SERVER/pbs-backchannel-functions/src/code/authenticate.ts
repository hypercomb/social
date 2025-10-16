import axios from "axios";
import { getWellKnownConfiguration } from "./get-wellknown-configuration";

export async function authenticate(): Promise<string> {
    try {
        const wellKnownConfig = await getWellKnownConfiguration();
        const tokenEndpoint = wellKnownConfig.token_endpoint;

        const hypercombAdminSecret = process.env.KEYCLOAK_CLIENT_SECRET;
        const keycloakApiClient = process.env.KEYCLOAK_API_CLIENT;

        const formContent = new URLSearchParams();
        formContent.append('grant_type', 'client_credentials');
        formContent.append('client_id', keycloakApiClient);
        formContent.append('client_secret', hypercombAdminSecret);
        formContent.append('scope', 'manage-subscriber');

        const config = {
            method: 'post',
            url: tokenEndpoint,
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            data: formContent
        };

        const response = await axios(config);
        return response.data.access_token
    } catch (error) {
        console.error(error);
    }
}

