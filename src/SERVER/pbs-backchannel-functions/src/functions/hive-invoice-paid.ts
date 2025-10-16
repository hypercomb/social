import { app, HttpRequest, HttpResponseInit } from '@azure/functions';
import { validateRecurlyAdmin } from '../code/validate-recurly-admin';
import { authenticate } from '../code/authenticate';
import { getJson } from 'hypercomb-validation';
import { Client } from 'recurly';
import { createUser } from '../code/create-user';
import { addRoleToUser } from '../code/add-role-to-user';
import { getUser } from '../code/get-user';
import { updateTokenWithClaim } from '../code/update-token-with-claim';

export async function HandleInvoicePaid(request: HttpRequest, context: any): Promise<HttpResponseInit> {
    context.log('JavaScript HTTP trigger function processed a request.');

    // Get the transaction request from Recurly
    const body = await getJson(request);

    try {
        // Validate and decode the token
        const isValid = await validateRecurlyAdmin(request);
        if (!isValid) {
            return { status: 403, body: 'Unauthorized, please try again' };
        }

        // Ensure body is in the correct format
        if (!body || !body.id || !body.userId) {
            throw new Error('Invalid request body');
        }
        console.log(body);

        // Create client and get the invoice
        const client = new Client(process.env.RECURLY_API_KEY);
        const invoice = await client.getInvoice(body.id);
        const account = invoice.account;
        // Invoice must be paid for roles to be applied
        if (!invoice || invoice.state !== 'paid') {
            throw new Error("Invoice not paid or not found");
        }

        const token = await authenticate();
        const userId = body.userId;  // Assume userId is sent from Recurly
        const email = invoice.account.email;

        await createUser(account, token, context);

        const user = await <any>(getUser(email, token, context));
        const roleId = "e46537bd-ae7a-422e-942e-6e226f47460f"; // Until there is a new keycloak API wrapper.
        await addRoleToUser(userId, roleId, token);

        // Add a permanent user identifier claim to the token
        const identifierType = 'user_identifier';
        const identifierValue = userId;

        try {
            await updateTokenWithClaim(userId, identifierType, identifierValue, token);
        } catch (error) {
            console.error('Error adding user identifier to token:', error);
            throw new Error('Unable to add user identifier to token');
        }

        return {
            status: 200,
            headers: {
                'Content-Type': 'application/json'
            }
        };

    } catch (e) {
        console.error(e);
        return {
            status: 500, // Internal Server Error
            body: e.message
        };
    }
}

app.http('HandleInvoicePaid', {
    methods: ['GET', 'POST'],
    authLevel: 'anonymous',
    handler: HandleInvoicePaid
});
