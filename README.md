# Trustline

[![npm version](https://img.shields.io/npm/v/trustline)](https://www.npmjs.com/package/trustline)
[![docs](https://img.shields.io/badge/docs-github%20pages-blue)](https://barddoo.github.io/trustline/)

Service identity and authorization for modern JavaScript runtimes.

Trustline is a machine-to-machine authentication library for internal services. It is designed around dedicated core and integration entry points:

- `trustline`: provider, guard, memory storage, and shared core exports
- `trustline/client`: token fetching and caching for outgoing requests
- `trustline/frameworks/*`: framework adapters for receiving services
- `trustline/adapters/*`: SQL storage adapters

The package now ships the first full stack: provider, client, guard, framework adapters, memory storage, and SQL storage adapters for SQLite, Postgres, and MySQL.

## Installation

Trustline is intended to be consumed as the `trustline` package:

```bash
bun add trustline
```

Or with npm:

```bash
npm install trustline
```

Install only the integrations you use. For example, Express users install `express`; SQLite users install `better-sqlite3` and `kysely`.

Example installs:

```bash
npm install trustline express
npm install trustline better-sqlite3 kysely
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
import { createGuard, createProvider, memoryStorage } from "trustline";
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

const guard = createGuard({
  issuer: "https://auth.internal",
  audience: "inventory-service",
});

app.use(createExpressProvider(provider));
app.use(createExpressGuard(guard));

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
- `guard.verify(token)`
- `createExpressProvider(provider)`
- `createExpressGuard(guard)`
- `createFastifyProvider(provider)`
- `createFastifyGuard(guard)`
- `createHonoProvider(provider)`
- `createHonoGuard(guard)`

Supported signing algorithms:

- `RS256`
- `ES256`

Bundled storage adapters via dedicated subpaths:

- `memoryStorage()`
- `sqliteStorage(path | database)`
- `postgresStorage(pool)`
- `mysqlStorage(pool)`

SQL adapters follow the Better Auth-style pattern of receiving ready-made database handles:

```ts
import Database from "better-sqlite3";
import { createPool as createMysqlPool } from "mysql2";
import { Pool as PostgresPool } from "pg";
import { mysqlStorage } from "trustline/adapters/mysql";
import { postgresStorage } from "trustline/adapters/postgres";
import { sqliteStorage } from "trustline/adapters/sqlite";

const sqlite = sqliteStorage(new Database("./trustline.sqlite"));
const postgres = postgresStorage(
  new PostgresPool({ connectionString: process.env.DATABASE_URL }),
);
const mysql = mysqlStorage(createMysqlPool(process.env.DATABASE_URL!));
```

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
