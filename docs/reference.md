# Reference

## Package entry points

Current documented imports:

```ts
import {
  createGuard,
  createProvider,
  memoryStorage,
  sqliteStorage,
} from "trustline";
import { createClient } from "trustline/client";
import { createGuard } from "trustline/middleware";
```

## `createProvider(options)`

Creates a provider that issues client-credentials JWTs and publishes a JWKS document.

```ts
const provider = createProvider(options);
```

### `ProviderOptions`

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
```

### Provider instance

```ts
interface Provider {
  handle(request: Request): Promise<Response>;
  express(): RequestHandler;
  fastify(): FastifyPluginAsync;
  hono(): Hono;
  clients: {
    create(input: { name: string; scopes?: string[] }): Promise<{
      clientId: string;
      clientSecret: string;
    }>;
    list(): Promise<ServiceClient[]>;
    revoke(clientId: string): Promise<void>;
  };
}
```

## `createClient(options)`

Creates a caller-side token client with in-memory caching and a `fetch` wrapper.

```ts
const client = createClient(options);
```

```ts
interface ClientOptions {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  audience?: string;
  fetch?: typeof globalThis.fetch;
  refreshSkewSeconds?: number;
}
```

## `createGuard(options)`

Creates a reusable verifier with direct verification and framework adapters.

```ts
const guard = createGuard(options);
```

### `GuardOptions`

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

## Guard instance

```ts
interface Guard {
  verify(token: string): Promise<ServiceIdentity>;
  express(): RequestHandler;
  fastify(): (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  hono(): MiddlewareHandler;
}
```

### `guard.verify(token)`

Verifies a bearer token and returns a normalized identity object.

```ts
const identity = await guard.verify(token);
```

### Framework adapters

- `provider.handle(request)` can be passed directly to Bun or any Web API-compatible runtime
- `guard.verify(token)` can be called directly inside Bun or any custom server handler
- `guard.express()` populates `request.trustline`
- `guard.fastify()` populates `request.trustline`
- `guard.hono()` stores identity under `context.get("trustline")`

## `ServiceIdentity`

```ts
interface ServiceIdentity {
  clientId: string;
  name: string | null;
  scopes: string[];
  env: string | null;
  raw: JWTPayload & Record<string, unknown>;
}
```

## `TrustlineRequest`

The middleware exports a request type for typed Express handlers:

```ts
import type { TrustlineRequest } from "trustline/middleware";
```

It extends `Request` with:

```ts
interface TrustlineRequest extends Request {
  trustline?: ServiceIdentity;
}
```

## Storage

```ts
interface StorageAdapter {
  findClient(clientId: string): Promise<ServiceClient | null>;
  createClient(client: ServiceClient): Promise<void>;
  deleteClient(clientId: string): Promise<void>;
  listClients(): Promise<ServiceClient[]>;
  touchClient(clientId: string, lastSeenAt: Date): Promise<void>;
  getSigningKeys(): Promise<SigningKey[]>;
  addSigningKey(key: SigningKey): Promise<void>;
  retireKey(keyId: string): Promise<void>;
}
```

Bundled implementations:

- `memoryStorage()`
- `sqliteStorage(path)`

## Verification rules

Current verifier behavior:

- allows `RS256` and `ES256`
- requires `sub` to be a non-empty string
- always validates `iss`
- validates `aud` only when configured
- validates `scope` only when configured
- validates `env` only when configured
- parses `scope` as a space-delimited string
