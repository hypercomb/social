export async function validateRecurlyAdmin(req: any): Promise<boolean> {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
        console.log('Authorization header is missing.');
        return false;
    }

    if (!authHeader.startsWith('Basic ')) {
        console.log('Authorization header is not using Basic auth.');
        return false;
    }

    // Extract and decode the base64 encoded username and password
    const base64Credentials = authHeader.split(' ')[1];
    const credentials = Buffer.from(base64Credentials, 'base64').toString('utf8');

    // Split the decoded string into username and password
    const [username, password] = credentials.split(':');

    const expectedPassword = process.env.RECURLY_ADMIN_SECRET_1;
    const adminUsername = process.env.RECURLY_ADMIN_USER_1;

    // Validate the username and password against expected values
    if (username !== adminUsername || password !== expectedPassword) {
        console.log(`Invalid username or password. Received username: ${username}`);
        return false;
    }

    console.log('Valid username and password received.');
    return true;
}