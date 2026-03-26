import type { Request, RequestHandler, Response } from "express";

import { AuthError } from "../core/errors";
import {
  type GuardOptions,
  type ServiceIdentity,
  verifyToken,
} from "../core/token";

export interface TrustlineRequest extends Request {
  trustline?: ServiceIdentity;
}

export function createExpressGuard(options: GuardOptions): RequestHandler {
  return async function trustlineGuard(
    request: Request,
    response: Response,
    next,
  ) {
    const token = getBearerToken(request.headers.authorization);

    if (!token) {
      response.status(401).json({
        error: "missing_token",
        message: "Missing bearer token",
      });
      return;
    }

    try {
      const identity = await verifyToken(token, options);
      (request as TrustlineRequest).trustline = identity;
      next();
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
      response.status(authError.status).json({
        error: authError.code,
        message: authError.message,
      });
    }
  };
}

function getBearerToken(header: string | undefined): string | null {
  if (!header) {
    return null;
  }

  const [scheme, value] = header.split(/\s+/, 2);
  if (scheme?.toLowerCase() !== "bearer" || !value) {
    return null;
  }

  return value;
}
