---
layout: home

hero:
  name: "Trustline"
  text: "Service identity and authorization for Node.js"
  tagline: "Issue, fetch, cache, and verify machine-to-machine tokens with one library."
  actions:
    - theme: brand
      text: Get Started
      link: /get-started
    - theme: alt
      text: Reference
      link: /reference

features:
  - title: Full M2M path
    details: "Trustline ships a provider, a client, and middleware so you can issue tokens, call downstream services, and verify requests end to end."
  - title: Local verification
    details: "Trustline verifies tokens against JWKS and caches public keys in memory, so your services do not depend on the auth provider on every request."
  - title: Framework-agnostic core
    details: "Core logic is built on Web-standard request and response primitives, with adapters for Express, Fastify, and Hono."
  - title: Composable entry points
    details: "Trustline is split into `trustline`, `trustline/client`, and `trustline/middleware`, so teams can adopt only the pieces they need."
---

## What Trustline is for

Trustline solves service-to-service authentication inside your infrastructure. It gives a receiving service a consistent way to verify who called it, what that caller is allowed to do, and whether the token belongs to the correct environment.

The project has three parts:

- `trustline`: provider and shared exports
- `trustline/client`: token fetching, caching, and auto-refresh for outgoing calls
- `trustline/middleware`: token verification for incoming calls

Each piece is independently useful. You can use the full Trustline stack, or you can use the guard by itself against any standards-compliant issuer such as Keycloak or Auth0.

## Current status

- Available now: `createProvider`, `createClient`, `createGuard`, `memoryStorage()`, and `sqliteStorage(path)`
- Implemented features: client credentials token issuance, JWKS publishing, token caching with refresh deduplication, local JWT verification, and Express/Fastify/Hono adapters
- Planned next: key rotation overlap windows, revocation workflows, and broader operational controls

## First working example

```ts
import { createProvider, memoryStorage } from "trustline";
import { createClient } from "trustline/client";
import { createGuard } from "trustline/middleware";

const provider = createProvider({
  issuer: "https://auth.internal",
  storage: memoryStorage(),
  env: "production",
});

const caller = createClient({
  tokenUrl: "https://auth.internal/token",
  clientId: process.env.TRUSTLINE_CLIENT_ID!,
  clientSecret: process.env.TRUSTLINE_CLIENT_SECRET!,
  audience: "inventory-service",
});

const guard = createGuard({
  issuer: "https://auth.internal",
  audience: "inventory-service",
});

const token = await caller.getToken();
const identity = await guard.verify(token);
```

Continue with [Get Started](/get-started) for setup and [Reference](/reference) for the current public API.
