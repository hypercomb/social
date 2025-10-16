import { app, HttpRequest, HttpResponseInit } from "@azure/functions";

export async function GetOpenGraphMetadata(req: HttpRequest, context: any): Promise<HttpResponseInit> {
    context.log('Function triggered.');

    const ogs = require('open-graph-scraper');

    const url = req.query.get('url');
    context.log('URL received:', url);

    if (!url) {
        context.log('No URL provided in query.');
        return {
            status: 400,
            body: "Please pass a URL on the query string"
        };
    }

    try {
        const options = {
            url,
            headers: {
                'User-Agent':
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                'Connection': 'keep-alive',
                'Referer': 'https://www.google.com/'
            }
        };

        const { error, result } = await ogs(options);

        if (error) {
            context.log('OG scraper returned error:', result?.error || 'Unknown error');
            return {
                status: 500,
                body: "Failed to extract Open Graph metadata."
            };
        }

        context.log('Open Graph metadata result:', result);

        return {
            status: 200,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(result)
        };

    } catch (error) {
        context.log('Unhandled error during processing:', error);
        return {
            status: 500,
            body: "Internal server error while processing the URL."
        };
    }
}

app.http('GetOpenGraphMetadata', {
    methods: ['GET', 'POST'],
    authLevel: 'anonymous',
    handler: GetOpenGraphMetadata
});
