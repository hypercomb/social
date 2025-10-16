import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";

export const GetProxiedImage = async (req: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
  const imageUrl = req.query.get('link');
  if (!imageUrl) return { status: 400, body: "Missing 'link' query parameter" };

  try {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      return { status: response.status, body: `Failed to fetch image: ${response.statusText}` };
    }

    const ab = await response.arrayBuffer();
    const base64 = Buffer.from(ab).toString("base64");

    return {
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ image: base64 })
    };
  } catch (err) {
    context.log("Error fetching image:", err);
    return { status: 500, body: "An error occurred while retrieving the image" };
  }
};

app.http("GetProxiedImage", {
  methods: ["GET", "POST"],
  authLevel: "anonymous",
  handler: GetProxiedImage
});