export const HYPERCOMB_BASE_URL = 'https://accounts.hypercomb.io';

export const HYPERCOMB_REALMS = {
    PORTAL: 'portal',
} as const;

export const HYPERCOMB_AUTH = {
    BASE_URL: HYPERCOMB_BASE_URL,
    REALMS: {
        PORTAL: {
            BASE: `${HYPERCOMB_BASE_URL}/realms/${HYPERCOMB_REALMS.PORTAL}`,
            PROTOCOL: {
                OPENID: {
                    BASE: `${HYPERCOMB_BASE_URL}/realms/${HYPERCOMB_REALMS.PORTAL}/protocol/openid-connect`,
                    CERTS: `${HYPERCOMB_BASE_URL}/realms/${HYPERCOMB_REALMS.PORTAL}/protocol/openid-connect/certs`
                }
            }
        }
    }
}; 