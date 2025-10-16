import axios from "axios";

const baseurl = process.env.BASE_URL;
export async function getUser(email, bearerToken, context) {
    const url = `${baseurl}/admin/realms/pbs/users?email=${email}`;

    try {
        const response = await axios.get(url, {
            headers: {
                'Authorization': `Bearer ${bearerToken}`
            }
        });

        if (response.status === 200) {
            const data = response.data;
            return data.length > 0 ? data[0] : null;
        } else {
            // Handle non-success status codes
            context.error(`Error: ${response.status}`);
            return null;
        }
    } catch (error) {
        // Handle network or other errors
        context.error(`Error: ${error.message}`);
        return null;
    }
}