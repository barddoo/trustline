# Get Started

Trustline is a service identity library for machine-to-machine authentication. The current package ships a provider, a client, a guard, and dedicated integration entry points, so you can run the full flow or adopt each piece independently.

## What you can use today

Today Trustline ships:

- `createProvider(options)`
- `provider.clients.create()`
- `provider.handle()`
- `createClient(options)`
- `client.getToken()`
- `client.fetch()`
- `createGuard(options)`
- `guard.verify(token)`
- `createExpressProvider(provider)`
- `createExpressGuard(guard)`
- `createFastifyProvider(provider)`
- `createFastifyGuard(guard)`
- `createHonoProvider(provider)`
- `createHonoGuard(guard)`
- `memoryStorage()`
- `sqliteStorage(path | database)`
- `postgresStorage(pool)`
- `mysqlStorage(pool)`

That is enough to issue tokens, cache them on the caller side, and verify them locally on the receiving side without calling the provider on every request.

The current provider surface also includes operational controls for requested scope narrowing, token revocation by `jti`, client disable and re-enable, client token cutoffs, and signing key rotation with overlap windows.

## Installation

Trustline is intended to be consumed as the `trustline` package, and the examples below use the final import paths:

```ts
import { createProvider, createGuard, memoryStorage } from "trustline";
```

You can also import from the dedicated client, framework, and adapter entry points:

```ts
import { createClient } from "trustline/client";
import { createExpressGuard } from "trustline/frameworks/express";
import { sqliteStorage } from "trustline/adapters/sqlite";
```

Install only the integrations you use. Example:

```bash
npm install trustline express
npm install trustline better-sqlite3 kysely
```

If you are working from this repository before package publication, build the package locally and link or install it from the repo source in your application.

## Minimal two-service interaction

This is the smallest realistic shape of a service-to-service call:

- an auth provider issues credentials for the caller service
- the caller service gets a token for the receiver service
- the receiver service verifies that token locally

### Auth provider

```ts
import { Hono } from "hono";
import { createProvider, memoryStorage } from "trustline";
import { createHonoProvider } from "trustline/frameworks/hono";

const provider = createProvider({
  issuer: "https://auth.internal",
  storage: memoryStorage(),
  env: "production",
});

const ordersApiCredentials = await provider.clients.create({
  name: "orders-api",
  scopes: ["read:inventory"],
});

const app = new Hono();

app.route("/", createHonoProvider(provider));
```

The provider returns `ordersApiCredentials.clientId` and `ordersApiCredentials.clientSecret` once. Store those values in the caller service's environment or secret manager.

### Caller service: `orders-api`

```ts
import { Hono } from "hono";
import { createClient } from "trustline/client";

const ordersClient = createClient({
  tokenUrl: "https://auth.internal/token",
  clientId: process.env.TRUSTLINE_CLIENT_ID!,
  clientSecret: process.env.TRUSTLINE_CLIENT_SECRET!,
  audience: "inventory-service",
});

const app = new Hono();

app.get("/shipments", async (context) => {
  const token = await ordersClient.getToken();
  const response = await fetch("https://inventory.internal/items", {
    headers: {
      authorization: `Bearer ${token}`,
    },
  });

  return context.json(await response.json());
});
```

### Receiver service: `inventory-service`

```ts
import { Hono } from "hono";
import { createGuard } from "trustline";
import { createHonoGuard } from "trustline/frameworks/hono";

const inventoryGuard = createGuard({
  issuer: "https://auth.internal",
  audience: "inventory-service",
  scopes: ["read:inventory"],
  env: "production",
});

const app = new Hono();

app.use("*", createHonoGuard(inventoryGuard));

app.get("/items", async (context) => {
  return context.json({
    service: "inventory-service",
    caller: context.get("trustline")?.name ?? context.get("trustline")?.clientId,
    scopes: context.get("trustline")?.scopes ?? [],
  });
});
```

In a real deployment, the provider runs as its own service, the caller stores `clientId` and `clientSecret` in its secret manager or environment, and the receiver only needs the issuer and verification rules.

## Guard-only verification

The smallest useful setup is issuer-only verification:

```ts
import { createGuard } from "trustline";

const guard = createGuard({
  issuer: "https://auth.internal",
});

const identity = await guard.verify(token);
```

Trustline derives the JWKS endpoint automatically:

```txt
issuer: https://auth.internal
jwks:   https://auth.internal/.well-known/jwks.json
```

## Bun.serve example

Bun already runs on the standard Web `Request` and `Response` APIs, so you can use `provider.handle()` directly and call `guard.verify()` inside your server handler.

```ts
import { createGuard, createProvider, memoryStorage } from "trustline";

const provider = createProvider({
  issuer: "https://auth.internal",
  storage: memoryStorage(),
});

Bun.serve({
  port: 3000,
  fetch: provider.handle,
});

const guard = createGuard({
  issuer: "https://auth.internal",
  audience: "inventory-service",
});

Bun.serve({
  port: 4000,
  fetch: async (request) => {
    const header = request.headers.get("authorization");
    const token = header?.replace(/^Bearer\s+/, "") ?? "";
    const identity = await guard.verify(token);

    return Response.json({
      caller: identity.name ?? identity.clientId,
    });
  },
});
```

## Express example

```ts
import express from "express";
import { createGuard, createProvider, memoryStorage } from "trustline";
import { createClient } from "trustline/client";
import {
  createExpressGuard,
  createExpressProvider,
  type TrustlineRequest,
} from "trustline/frameworks/express";

const app = express();

const provider = createProvider({
  issuer: "https://auth.internal",
  storage: memoryStorage(),
});

const service = await provider.clients.create({
  name: "order-processor",
  scopes: ["read:orders"],
});

const client = createClient({
  tokenUrl: "https://auth.internal/token",
  clientId: service.clientId,
  clientSecret: service.clientSecret,
  audience: "inventory-service",
});

const guard = createGuard({
  issuer: "https://auth.internal",
  audience: "inventory-service",
  scopes: ["read:orders"],
});

app.use(createExpressProvider(provider));
app.use(createExpressGuard(guard));

app.get("/orders", async (request: TrustlineRequest, response) => {
  const token = await client.getToken();

  response.json({
    outboundTokenPresent: token.length > 0,
    inboundClient: request.trustline?.clientId ?? null,
  });
});
```

## What to read next

- [Concepts](/concepts) for token shape and verification rules
- [Middleware](/middleware) for cache behavior and verification details
- [Operations](/operations) for revocation, cutoffs, and rotation workflows
- [Reference](/reference) for the current public API
- [Roadmap](/roadmap) for what is still planned beyond the current release
