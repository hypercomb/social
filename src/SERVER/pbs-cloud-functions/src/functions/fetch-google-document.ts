// import { app, HttpRequest, HttpResponseInit } from "@azure/functions";
// import axios from 'axios';
// import DOMPurify from 'dompurify';
// import { JSDOM } from 'jsdom';

// // Function to fetch and sanitize Google Doc HTML content by ID
// export async function FetchGoogleDocument(req: HttpRequest, context: any): Promise<HttpResponseInit> {
//     try {
//         // Get the Google Doc ID from the request query parameters
//         const googleDocId = req.query.get('docId'); 
        
//         if (!googleDocId) {
//             return { status: 400, body: "Please provide a valid Google Doc ID." };
//         }
        
//         // Construct the Google Doc URL using the ID
//         const googleDocUrl = `https://script.google.com/macros/s/AKfycbw8yKpikI4SZBzA8kYfw6WYur81lEiblWN79xgeGVxZE42ysSOF7AfGHU5Tu7xAaEum/exec?${googleDocId}`;
        
//         // Fetch the document's HTML content
//         const response = await axios.get(googleDocUrl);
//         const rawHtml = response.data;

//         // Set up JSDOM and DOMPurify for server-side sanitization
//         const { window } = new JSDOM('');
//         const purify = DOMPurify(window);

//         // Sanitize the HTML content
//         const sanitizedHtml = purify.sanitize(rawHtml);

//         // Return the sanitized content
//         return {
//             status: 200,
//             headers: { 'Content-Type': 'text/html' },
//             body: sanitizedHtml,
//         };

//     } catch (error: any) {
//         return {
//             status: 500,
//             body: `Error fetching or sanitizing content: ${error.message}`,
//         };
//     }
// }

// app.http('FetchGoogleDocument', {
//     methods: ['GET'],
//     authLevel: 'anonymous',
//     handler: FetchGoogleDocument,
// });
