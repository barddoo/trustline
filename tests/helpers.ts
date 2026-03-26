import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { exportJWK, generateKeyPair, type JWK, SignJWT } from "jose";

import type { Provider } from "../src/provider";

export interface TestIssuer {
  issuer: string;
  jwksUrl: string;
  close(): Promise<void>;
  issueToken(claims?: Record<string, unknown>): Promise<string>;
  getFetchCount(): number;
}

export async function createTestIssuer(
  baseClaims: Record<string, unknown> = {},
): Promise<TestIssuer> {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  let fetchCount = 0;

  const server = createServer(async (request, response) => {
    if (request.url !== "/.well-known/jwks.json") {
      response.statusCode = 404;
      response.end("not found");
      return;
    }

    fetchCount += 1;
    const jwk = await exportPublicJwk(publicKey);
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ keys: [jwk] }));
  });

  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );

  const address = server.address() as AddressInfo;
  const issuer = `http://127.0.0.1:${address.port}`;

  return {
    issuer,
    jwksUrl: `${issuer}/.well-known/jwks.json`,
    close() {
      return closeServer(server);
    },
    getFetchCount() {
      return fetchCount;
    },
    async issueToken(claims = {}) {
      const payload = {
        sub: "svc_test_client",
        name: "order-processor",
        scope: "read:orders write:inventory",
        env: "production",
        ...baseClaims,
        ...claims,
      };

      return new SignJWT(payload)
        .setProtectedHeader({ alg: "RS256", kid: "test-key" })
        .setIssuer(issuer)
        .setIssuedAt()
        .setExpirationTime("5m")
        .sign(privateKey);
    },
  };
}

export async function createUnreachableUrl(): Promise<string> {
  const server = createServer((_request, response) => {
    response.statusCode = 500;
    response.end();
  });

  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const address = server.address() as AddressInfo;
  const url = `http://127.0.0.1:${address.port}/.well-known/jwks.json`;
  await closeServer(server);
  return url;
}

export interface ProviderTestServer {
  issuer: string;
  provider: Provider;
  close(): Promise<void>;
  url(pathname: string): string;
}

export async function createProviderServer(
  factory: (issuer: string) => Provider,
): Promise<ProviderTestServer> {
  let issuer = "";
  let provider: Provider;

  const server = createServer(async (request, response) => {
    try {
      const chunks: Uint8Array[] = [];
      request.on("data", (chunk) => {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
      });

      await new Promise<void>((resolve, reject) => {
        request.on("end", () => resolve());
        request.on("error", reject);
      });

      const providerResponse = await provider.handle(
        new Request(new URL(request.url ?? "/", issuer), {
          method: request.method,
          headers: normalizeNodeHeaders(request.headers),
          body:
            request.method === "GET" || request.method === "HEAD"
              ? undefined
              : Buffer.concat(chunks).toString("utf8"),
        }),
      );

      response.statusCode = providerResponse.status;
      providerResponse.headers.forEach((value, key) => {
        response.setHeader(key, value);
      });
      response.end(await providerResponse.text());
    } catch (error) {
      response.statusCode = 500;
      response.setHeader("content-type", "text/plain");
      response.end(error instanceof Error ? error.stack : String(error));
    }
  });

  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );

  const address = server.address() as AddressInfo;
  issuer = `http://127.0.0.1:${address.port}`;
  provider = factory(issuer);

  return {
    issuer,
    provider,
    close() {
      return closeServer(server);
    },
    url(pathname) {
      return `${issuer}${pathname}`;
    },
  };
}

function normalizeNodeHeaders(
  headers: NodeJS.Dict<string | string[]>,
): Headers {
  const normalized = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string") {
      normalized.set(key, value);
    }

    if (Array.isArray(value)) {
      normalized.set(key, value.join(", "));
    }
  }

  return normalized;
}

async function exportPublicJwk(
  publicKey: Parameters<typeof exportJWK>[0],
): Promise<JWK> {
  const jwk = await exportJWK(publicKey);
  return {
    ...jwk,
    use: "sig",
    kid: "test-key",
    alg: "RS256",
  };
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    if ("closeIdleConnections" in server) {
      server.closeIdleConnections();
    }
    if ("closeAllConnections" in server) {
      server.closeAllConnections();
    }

    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}
