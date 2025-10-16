import axios from "axios";

const baseurl = process.env.BASE_URL;

export async function createUser(account, token, context) {
    try {
        // Step 1: Create the user
        const createUserUrl = `${baseurl}/admin/realms/pbs/users`;
        const userData = {
            username: account.email,
            enabled: true,
            email: account.email,
            firstName: account.firstName,
            lastName: account.lastName,
            emailVerified: true
        };

        await axios.post(createUserUrl, userData, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            }
        });

        // Step 2: Retrieve the user ID
        const searchUserUrl = `${baseurl}/admin/realms/pbs/users?username=${encodeURIComponent(account.email)}`;
        const searchResponse = await axios.get(searchUserUrl, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (searchResponse.data && searchResponse.data.length > 0) {
            const userId = searchResponse.data[0].id;

            // Step 3: Set temporary password
            const resetPasswordUrl = `${baseurl}/admin/realms/pbs/users/${userId}/reset-password`;
            const passwordData = {
                type: "password",
                value: "YourTemporaryPassword123!", // Set your temporary password here
                temporary: true
            };

            await axios.put(resetPasswordUrl, passwordData, {
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                }
            });

            context.log("User created and temporary password set.");
        }

    } catch (e) {
        if (e instanceof Error) {
            context.log(`Error in user creation process: ${e.message}`);
        } else {
            context.log('An unknown error occurred during user creation');
        }
    }
}
