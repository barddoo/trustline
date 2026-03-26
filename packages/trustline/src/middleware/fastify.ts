import type { FastifyReply, FastifyRequest } from "fastify";

import { AuthError } from "../core/errors";
import type { GuardOptions, ServiceIdentity } from "../core/token";
import { verifyToken } from "../core/token";

export interface TrustlineFastifyRequest extends FastifyRequest {
  trustline?: ServiceIdentity;
}

export function createFastifyGuard(options: GuardOptions) {
  return async function trustlineFastifyGuard(
    request: FastifyRequest,
    reply: FastifyReply,
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
      const identity = await verifyToken(token, options);
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
