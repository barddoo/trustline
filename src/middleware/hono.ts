import { createMiddleware } from "hono/factory";

import { AuthError } from "../core/errors";
import type { GuardOptions } from "../core/token";
import { verifyToken } from "../core/token";

export function createHonoGuard(options: GuardOptions) {
  return createMiddleware(async (context, next) => {
    const header = context.req.header("authorization");
    const token = getBearerToken(header);

    if (!token) {
      return context.json(
        {
          error: "missing_token",
          message: "Missing bearer token",
        },
        401,
      );
    }

    try {
      const identity = await verifyToken(token, options);
      context.set("trustline", identity);
      await next();
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
      return context.json(
        {
          error: authError.code,
          message: authError.message,
        },
        authError.status as 401 | 403,
      );
    }
  });
}

function getBearerToken(header: string | undefined): string | null {
  if (!header) {
    return null;
  }

  const [scheme, token] = header.split(/\s+/, 2);
  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return null;
  }

  return token;
}
