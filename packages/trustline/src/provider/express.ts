import type {
  Request as ExpressRequest,
  Response as ExpressResponse,
  RequestHandler,
} from "express";

export interface WebHandler {
  handle(request: Request): Promise<Response>;
}

export function createExpressProvider(provider: WebHandler): RequestHandler {
  return async function trustlineProvider(
    request: ExpressRequest,
    response: ExpressResponse,
  ) {
    const origin = `${request.protocol}://${request.get("host") ?? "localhost"}`;
    const url = new URL(request.originalUrl || request.url, origin);
    const body =
      request.method === "GET" || request.method === "HEAD"
        ? undefined
        : await readBody(request);

    const providerResponse = await provider.handle(
      new Request(url.toString(), {
        method: request.method,
        headers: request.headers as HeadersInit,
        body,
      }),
    );

    response.status(providerResponse.status);
    providerResponse.headers.forEach((value, key) => {
      response.setHeader(key, value);
    });
    response.send(await providerResponse.text());
  };
}

function readBody(request: ExpressRequest): Promise<string | undefined> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    request.on("data", (chunk) => {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    });
    request.on("end", () => {
      resolve(
        chunks.length > 0 ? Buffer.concat(chunks).toString("utf8") : undefined,
      );
    });
    request.on("error", reject);
  });
}
