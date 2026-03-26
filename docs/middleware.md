# Verification And Adapters

Trustline's verification layer is centered on a transport-agnostic guard. Framework integrations live in dedicated subpaths such as `trustline/frameworks/express`, `trustline/frameworks/fastify`, and `trustline/frameworks/hono`.

## `createGuard`

```ts
import { createGuard } from "trustline";

const guard = createGuard({
  issuer: "https://auth.internal",
  audience: "inventory-service",
  scopes: ["read:orders"],
  env: "production",
});
```

### Options

```ts
interface GuardOptions {
  issuer: string;
  jwksUrl?: string;
  audience?: string | string[];
  scopes?: string[];
  env?: string;
  clockTolerance?: number;
}
```

- `issuer`: required JWT issuer
- `jwksUrl`: optional override for nonstandard JWKS locations
- `audience`: optional audience constraint
- `scopes`: optional required scopes; all listed scopes must be present
- `env`: optional environment constraint
- `clockTolerance`: optional clock skew tolerance in seconds; defaults to `5`

## Direct token verification

Use `guard.verify(token)` when you are not inside Express or when you need to verify a token manually for queues, background jobs, RPC handlers, or custom transports.

```ts
const identity = await guard.verify(token);

console.log(identity.clientId);
console.log(identity.scopes);
console.log(identity.raw);
```

Returned shape:

```ts
interface ServiceIdentity {
  clientId: string;
  name: string | null;
  scopes: string[];
  env: string | null;
  raw: Record<string, unknown>;
}
```

## Express adapter

```ts
import express from "express";
import { createGuard } from "trustline";
import {
  createExpressGuard,
  type TrustlineRequest,
} from "trustline/frameworks/express";

const app = express();
const guard = createGuard({
  issuer: "https://auth.internal",
  audience: "inventory-service",
});

app.use(createExpressGuard(guard));

app.get("/internal", (request: TrustlineRequest, response) => {
  response.json({
    caller: request.trustline?.name ?? request.trustline?.clientId,
  });
});
```

The Express adapter:

- reads the bearer token from `Authorization`
- verifies it with the same guard logic as `verify(token)`
- sets `request.trustline`
- returns JSON error responses instead of calling the next handler on auth failure

Fastify and Hono follow the same pattern through `createFastifyGuard(guard)` and `createHonoGuard(guard)` from their respective framework subpaths.

## Bun usage

Bun already uses the standard Web `Request` and `Response` APIs, so you can call `guard.verify(token)` directly from a `Bun.serve()` handler.

```ts
import { createGuard } from "trustline";

const guard = createGuard({
  issuer: "https://auth.internal",
  audience: "inventory-service",
});

Bun.serve({
  port: 3000,
  fetch: async (request) => {
    const header = request.headers.get("authorization");
    const token = header?.replace(/^Bearer\s+/, "") ?? "";
    const identity = await guard.verify(token);

    return Response.json({
      clientId: identity.clientId,
      scopes: identity.scopes,
    });
  },
});
```

That keeps Bun support on the same core verifier instead of adding a separate adapter surface.

## Error behavior

Current error codes returned by the guard or Express adapter:

| Code | Status | Meaning |
| --- | --- | --- |
| `missing_token` | `401` | No bearer token was provided |
| `invalid_token` | `401` | Signature, structure, expiration, or general JWT verification failed |
| `invalid_issuer` | `401` | `iss` did not match the configured issuer |
| `invalid_audience` | `403` | `aud` did not match the configured audience |
| `invalid_scope` | `403` | One or more required scopes were missing |
| `invalid_env` | `403` | `env` did not match the configured environment |
| `jwks_fetch_failed` | `401` | JWKS retrieval failed |

## Caching behavior

The current in-memory JWKS cache:

- is keyed by JWKS URL
- uses a 10 minute TTL
- reuses in-flight fetch promises to avoid stampedes
- re-fetches once on key mismatch or signature verification failure before failing the request

No external cache is required for the current verification slice.
