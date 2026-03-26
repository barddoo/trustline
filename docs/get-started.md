# Get Started

Trustline is a service identity library for machine-to-machine authentication. The current package ships a provider, a client, and middleware, so you can run the full flow or adopt each piece independently.

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
- `guard.express()`
- `guard.fastify()`
- `guard.hono()`
- `memoryStorage()`
- `sqliteStorage(path | database)`
- `postgresStorage(pool)`
- `mysqlStorage(pool)`

That is enough to issue tokens, cache them on the caller side, and verify them locally on the receiving side without calling the provider on every request.

## Installation

Trustline is intended to be consumed as the `trustline` package, and the examples below use the final import paths:

```ts
import { createProvider, createGuard, memoryStorage } from "trustline";
```

You can also import from the dedicated client and middleware entry points:

```ts
import { createClient } from "trustline/client";
import { createGuard } from "trustline/middleware";
```

If you are working from this repository before package publication, build the package locally and link or install it from the repo source in your application.

## Minimal full-stack setup

```ts
import { createProvider, createGuard, memoryStorage } from "trustline";
import { createClient } from "trustline/client";

const provider = createProvider({
  issuer: "https://auth.internal",
  storage: memoryStorage(),
  env: "production",
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
  env: "production",
});

const token = await client.getToken();
const identity = await guard.verify(token);
```

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
import {
  createProvider,
  createGuard,
  memoryStorage,
  type TrustlineRequest,
} from "trustline";
import { createClient } from "trustline/client";

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

app.use(provider.express());
app.use(guard.express());

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
- [Reference](/reference) for the current public API
- [Roadmap](/roadmap) for what is still planned beyond the current release
