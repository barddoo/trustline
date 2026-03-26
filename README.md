# Trustline

Service identity and authorization for Node.js.

Trustline is a machine-to-machine authentication library for internal services. It is designed around three independent entry points:

- `trustline`: provider, storage, and shared exports
- `trustline/client`: token fetching and caching for outgoing requests
- `trustline/middleware`: token verification for receiving services

The package now ships the first full stack: provider, client, guard, memory storage, and SQLite storage.

## Current status

Available now:

- `createProvider(options)`
- `createClient(options)`
- `createGuard(options)`
- `memoryStorage()`
- `sqliteStorage(path)`

Implemented behavior:

- client credentials token issuance
- JWKS publishing
- token caching with proactive refresh and request deduplication
- issuer, audience, scope, and environment verification
- JWKS discovery and caching
- Express, Fastify, and Hono adapters

Planned next:

- key rotation overlap windows
- token revocation workflows
- requested-scope narrowing during issuance

## Installation

Trustline is intended to be consumed as the `trustline` package:

```bash
bun add trustline
```

Or with npm:

```bash
npm install trustline
```

If you are working from this repository before package publication, build the package locally and install or link it from the repo source.

## Quick start

Provider:

```ts
import { createProvider, memoryStorage } from "trustline";

const provider = createProvider({
  issuer: "https://auth.internal",
  storage: memoryStorage(),
  env: "production",
});

const service = await provider.clients.create({
  name: "order-processor",
  scopes: ["read:orders", "write:inventory"],
});
```

Client:

```ts
import { createClient } from "trustline/client";

const client = createClient({
  tokenUrl: "https://auth.internal/token",
  clientId: service.clientId,
  clientSecret: service.clientSecret,
  audience: "inventory-service",
});

const token = await client.getToken();
```

Guard:

```ts
import { createGuard } from "trustline";

const guard = createGuard({
  issuer: "https://auth.internal",
  audience: "inventory-service",
  scopes: ["read:orders"],
  env: "production",
});

const identity = await guard.verify(token);
```

Trustline derives the JWKS endpoint automatically for verification:

```txt
issuer: https://auth.internal
jwks:   https://auth.internal/.well-known/jwks.json
```

## Bun

Trustline does not need a Bun-specific adapter. Bun already uses the standard Web `Request` and `Response` APIs, so use the provider's `handle()` method directly and call `guard.verify()` inside your `fetch` handler.

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

## Express

```ts
import express from "express";
import {
  createProvider,
  createGuard,
  memoryStorage,
  type TrustlineRequest,
} from "trustline";

const app = express();

const provider = createProvider({
  issuer: "https://auth.internal",
  storage: memoryStorage(),
});

const guard = createGuard({
  issuer: "https://auth.internal",
  audience: "inventory-service",
});

app.use(provider.express());
app.use(guard.express());

app.get("/internal", (request: TrustlineRequest, response) => {
  response.json({
    caller: request.trustline?.name ?? request.trustline?.clientId,
  });
});
```

## API

Current public API includes:

```ts
interface ProviderOptions {
  issuer: string;
  storage: StorageAdapter;
  signing?: {
    algorithm?: "ES256" | "RS256";
    privateKey?: string;
    keyId?: string;
  };
  token?: {
    ttl?: number;
  };
  env?: string;
}

interface GuardOptions {
  issuer: string;
  jwksUrl?: string;
  audience?: string | string[];
  scopes?: string[];
  env?: string;
  clockTolerance?: number;
}

interface ServiceIdentity {
  clientId: string;
  name: string | null;
  scopes: string[];
  env: string | null;
  raw: Record<string, unknown>;
}
```

Adapter surface:

- `provider.handle(request)`
- `provider.express()`
- `provider.fastify()`
- `provider.hono()`
- `guard.verify(token)`
- `guard.express()`
- `guard.fastify()`
- `guard.hono()`

Supported signing algorithms:

- `RS256`
- `ES256`

Bundled storage adapters:

- `memoryStorage()`
- `sqliteStorage(path)`

## Documentation

The VitePress docs site lives in `docs/`.

Key pages:

- `docs/index.md`
- `docs/get-started.md`
- `docs/concepts.md`
- `docs/middleware.md`
- `docs/reference.md`
- `docs/roadmap.md`

To run the docs locally:

```bash
cd docs
bun run docs:dev
```

To build the docs:

```bash
cd docs
bun run docs:build
```

## Development

Build the package:

```bash
bun run build
```

Run type checks:

```bash
bun run typecheck
```

Run tests:

```bash
bun run test
```

Run formatting and lint checks:

```bash
bun run check
```

## License

MIT
