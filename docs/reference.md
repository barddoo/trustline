# Reference

## Package entry points

Current documented imports:

```ts
import {
  createGuard,
  createProvider,
  memoryStorage,
} from "trustline";
import { createClient } from "trustline/client";
import {
  createExpressGuard,
  createExpressProvider,
  type TrustlineRequest,
} from "trustline/frameworks/express";
import {
  createFastifyGuard,
  createFastifyProvider,
} from "trustline/frameworks/fastify";
import {
  createHonoGuard,
  createHonoProvider,
} from "trustline/frameworks/hono";
import { mysqlStorage } from "trustline/adapters/mysql";
import { postgresStorage } from "trustline/adapters/postgres";
import { sqliteStorage } from "trustline/adapters/sqlite";
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
  clients: {
    create(input: { name: string; scopes?: string[] }): Promise<{
      clientId: string;
      clientSecret: string;
    }>;
    list(): Promise<ServiceClient[]>;
    revoke(clientId: string): Promise<void>;
    disable(clientId: string): Promise<void>;
    enable(clientId: string): Promise<void>;
    invalidateTokensBefore(clientId: string, at?: Date): Promise<void>;
    clearTokensInvalidBefore(clientId: string): Promise<void>;
  };
  keys: {
    rotate(input?: RotateSigningKeyInput): Promise<{ keyId: string }>;
  };
  tokens: {
    revoke(jti: string, expiresAt: Date): Promise<void>;
  };
}
```

```ts
interface RotateSigningKeyInput {
  activateAt?: Date;
  algorithm?: "ES256" | "RS256";
  keyId?: string;
  overlapSeconds?: number;
  privateKey?: string;
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

Creates a reusable verifier with direct verification.

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
- `createExpressProvider(provider)` adapts the provider to Express
- `createExpressGuard(guard)` populates `request.trustline`
- `createFastifyProvider(provider)` adapts the provider to Fastify
- `createFastifyGuard(guard)` populates `request.trustline`
- `createHonoProvider(provider)` adapts the provider to Hono
- `createHonoGuard(guard)` stores identity under `context.get("trustline")`

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

The Express framework entrypoint exports a request type for typed handlers:

```ts
import type { TrustlineRequest } from "trustline/frameworks/express";
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
  setClientActive(clientId: string, active: boolean): Promise<void>;
  setTokensInvalidBefore(clientId: string, at: Date | null): Promise<void>;
  getSigningKeys(): Promise<SigningKey[]>;
  addSigningKey(key: SigningKey): Promise<void>;
  setSigningKeyNotAfter(keyId: string, notAfter: Date | null): Promise<void>;
  findRevokedToken(jti: string): Promise<RevokedToken | null>;
  revokeToken(token: RevokedToken): Promise<void>;
}
```

Bundled implementations:

- `memoryStorage()`
- `sqliteStorage(path | database, options?)`
- `postgresStorage(pool, options?)`
- `mysqlStorage(pool, options?)`

The SQL adapters are imported from dedicated subpaths rather than the root package.

SQL-backed adapters accept:

```ts
interface SqlStorageOptions {
  tablePrefix?: string;
  tables?: {
    clients?: string;
    signingKeys?: string;
    revokedTokens?: string;
  };
}
```

## Verification rules

Current verifier behavior:

- allows `RS256` and `ES256`
- requires `sub` to be a non-empty string
- always validates `iss`
- validates `aud` only when configured
- validates `scope` only when configured
- validates `env` only when configured
- rejects tokens for inactive clients
- rejects revoked tokens by `jti` until expiration
- rejects tokens issued before a client cutoff
- parses `scope` as a space-delimited string
