import axios from 'axios'; // Assuming you use axios for HTTP requests

export const updateTokenWithClaim = async (userId: string, claimType: string, claimValue: string, token: string): Promise<void> => {
    // Define the URL and payload based on your token service API
    const url = `${process.env.TOKEN_SERVICE_URL}/add-claim`;
    const payload = {
        userId,
        claimType,
        claimValue
    };

    // Make the request to add the claim to the token
    try {
        await axios.post(url, payload, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
    } catch (error) {
        console.error('Error updating token with claim:', error);
        throw new Error('Unable to update token with claim');
    }
};
