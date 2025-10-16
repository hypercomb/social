import axios from "axios";

const baseurl = process.env.BASE_URL;

export async function addRoleToUser(userId, roleId, token) {
    try {
        const url = `${baseurl}/admin/realms/pbs/users/${userId}/role-mappings/realm`;
        const roles = [
            { id: roleId, name: "hive-publisher" }
        ];

        const response = await axios.post(url, roles, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            }
        });

        if (response.status === 200 || response.status === 201 || response.status === 204) {
            console.log("Role added successfully");
        } else {
            console.log(`Failed to add role: ${response.status}`);
        }
    } catch (error) {
        console.error(`Error in adding role: ${error}`);
    }
}
