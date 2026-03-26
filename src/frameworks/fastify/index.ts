import type { FastifyPluginAsync } from "fastify";

import { AuthError } from "../../core/errors";
import type { ServiceIdentity } from "../../core/token";
import type { Provider } from "../../provider";
import {
  createHeaders,
  serializeRequestBody,
  writeFastifyResponse,
} from "../../provider/http";

export interface GuardVerifier {
  verify(token: string): Promise<ServiceIdentity>;
}

export interface TrustlineFastifyRequest {
  trustline?: ServiceIdentity;
}

export function createFastifyProvider(provider: Provider): FastifyPluginAsync {
  return async (fastify) => {
    fastify.get("/.well-known/jwks.json", async (request, reply) => {
      const response = await provider.handle(
        new Request(buildRequestUrl(request), {
          method: "GET",
          headers: createHeaders(request.headers),
        }),
      );
      await writeFastifyResponse(reply, response);
    });

    fastify.post("/token", async (request, reply) => {
      const response = await provider.handle(
        new Request(buildRequestUrl(request), {
          method: "POST",
          headers: createHeaders(request.headers),
          body: serializeRequestBody(request.body),
        }),
      );
      await writeFastifyResponse(reply, response);
    });
  };
}

export function createFastifyGuard(guard: GuardVerifier) {
  return async function trustlineFastifyGuard(
    request: { headers: { authorization?: string | string[] } },
    reply: {
      code(status: number): { send(payload: unknown): void };
      send?(payload: unknown): void;
    },
  ) {
    const token = getBearerToken(request.headers.authorization);

    if (!token) {
      reply.code(401).send({
        error: "missing_token",
        message: "Missing bearer token",
      });
      return;
    }

    try {
      const identity = await guard.verify(token);
      (request as TrustlineFastifyRequest).trustline = identity;
    } catch (error) {
      const authError =
        error instanceof AuthError
          ? error
          : new AuthError(
              "invalid_token",
              "Token verification failed",
              401,
              error,
            );
      reply.code(authError.status).send({
        error: authError.code,
        message: authError.message,
      });
    }
  };
}

function buildRequestUrl(request: {
  protocol?: string;
  headers: { host?: string | string[] };
  raw?: { url?: string };
  url?: string;
}): string {
  const protocol = request.protocol ?? "http";
  const host = Array.isArray(request.headers.host)
    ? request.headers.host[0]
    : request.headers.host;
  const path = request.raw?.url ?? request.url ?? "/";
  return new URL(path, `${protocol}://${host ?? "localhost"}`).toString();
}

function getBearerToken(header: string | string[] | undefined): string | null {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) {
    return null;
  }

  const [scheme, token] = value.split(/\s+/, 2);
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return null;
  }

  return token;
}
