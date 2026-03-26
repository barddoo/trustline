import { Hono } from "hono";
import { createMiddleware } from "hono/factory";

import { AuthError } from "../../core/errors";
import type { ServiceIdentity } from "../../core/token";
import type { Provider } from "../../provider";

export interface GuardVerifier {
  verify(token: string): Promise<ServiceIdentity>;
}

export function createHonoProvider(provider: Provider): Hono {
  const app = new Hono();

  app.get("/.well-known/jwks.json", async (context) =>
    provider.handle(
      new Request(context.req.raw.url, {
        method: "GET",
        headers: context.req.raw.headers,
      }),
    ),
  );

  app.post("/token", async (context) =>
    provider.handle(createForwardedRequest(context.req.raw)),
  );

  return app;
}

export function createHonoGuard(guard: GuardVerifier) {
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
      const identity = await guard.verify(token);
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

function createForwardedRequest(request: Request): Request {
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers: request.headers,
  };

  if (hasBody) {
    init.body = request.body;
    init.duplex = "half";
  }

  return new Request(request.url, init);
}
