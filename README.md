# Trustline

Service identity and authorization for Node.js.

Trustline is a machine-to-machine authentication library for internal services. It is designed around three independent entry points:

- `trustline`: provider and shared exports
- `trustline/client`: token fetching and caching for outgoing requests
- `trustline/middleware`: token verification for receiving services

The current implementation focuses on the middleware and guard slice. You can use it today to verify JWTs from a standards-compliant issuer such as Keycloak or Auth0.

## Current status

Available now:

- `createGuard(options)`
- `guard.verify(token)`
- `guard.express()`

Implemented verification behavior:

- issuer validation
- optional audience enforcement
- optional scope enforcement
- optional environment enforcement
- JWKS discovery from the issuer URL
- in-memory JWKS caching with one refresh retry on key mismatch

Planned next:

- provider
- client
- storage adapters
- key rotation workflows

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

Minimal verification:

```ts
import { createGuard } from "trustline";

const guard = createGuard({
  issuer: "https://auth.internal",
});

const identity = await guard.verify(token);
```

Recommended verification:

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

Trustline derives the JWKS endpoint automatically:

```txt
issuer: https://auth.internal
jwks:   https://auth.internal/.well-known/jwks.json
```

## Express

```ts
import express from "express";
import { createGuard, type TrustlineRequest } from "trustline/middleware";

const app = express();
const guard = createGuard({
  issuer: "https://auth.internal",
  audience: "inventory-service",
});

app.use(guard.express());

app.get("/internal", (request: TrustlineRequest, response) => {
  response.json({
    caller: request.trustline?.name ?? request.trustline?.clientId,
  });
});
```

The Express adapter:

- reads `Authorization: Bearer <token>`
- verifies the token locally
- attaches `request.trustline`
- returns JSON auth errors on failure

## API

Current public API:

```ts
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

Supported signing algorithms:

- `RS256`
- `ES256`

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
