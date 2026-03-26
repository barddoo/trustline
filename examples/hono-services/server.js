import { createServer } from "node:http";

export function serveApp({ fetch, name, port }) {
  const server = createServer(async (request, response) => {
    try {
      const chunks = [];
      request.on("data", (chunk) => {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      });

      await new Promise((resolve, reject) => {
        request.on("end", resolve);
        request.on("error", reject);
      });

      const requestUrl = new URL(
        request.url ?? "/",
        `http://${request.headers.host ?? `127.0.0.1:${port}`}`,
      );

      const appResponse = await fetch(
        new Request(requestUrl, {
          method: request.method,
          headers: normalizeHeaders(request.headers),
          body:
            request.method === "GET" || request.method === "HEAD"
              ? undefined
              : Buffer.concat(chunks),
        }),
      );

      response.statusCode = appResponse.status;
      appResponse.headers.forEach((value, key) => {
        response.setHeader(key, value);
      });
      response.end(Buffer.from(await appResponse.arrayBuffer()));
    } catch (error) {
      response.statusCode = 500;
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          error: "example_server_error",
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`[${name}] listening on http://127.0.0.1:${port}`);
  });

  return server;
}

function normalizeHeaders(headers) {
  const normalized = new Headers();

  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string") {
      normalized.set(key, value);
      continue;
    }

    if (Array.isArray(value)) {
      normalized.set(key, value.join(", "));
    }
  }

  return normalized;
}
