# Concepts

## The Trustline model

Trustline is built for service-to-service authentication:

- one service obtains a signed token from an issuer
- another service verifies that token locally
- authorization checks happen from claims, not from a callback to the issuer

This keeps the receiving service resilient. If the issuer is temporarily unavailable, already-issued tokens remain verifiable until they expire.

## Product shape

Trustline is designed as three independent entry points:

- Provider: issue signed JWTs to registered service clients
- Client: fetch and cache access tokens for outgoing requests
- Middleware / Guard: verify tokens on the receiving service

The current implementation covers the full provider, client, and guard flow, with adapters for Express, Fastify, and Hono. Bun works directly through the standard Web `Request` and `Response` APIs.

## Token shape

Trustline expects standard JWT claims plus a few service-auth focused claims:

```json
{
  "sub": "service-a-client-uuid",
  "iss": "https://auth.internal",
  "aud": "inventory-service",
  "scope": "read:orders write:inventory",
  "env": "production",
  "name": "order-processor",
  "jti": "unique-token-id",
  "iat": 1711999694,
  "exp": 1711999999
}
```

Key claims:

- `sub`: unique service client identifier
- `iss`: token issuer
- `aud`: intended receiving service
- `scope`: space-separated permissions
- `env`: environment isolation tag
- `name`: human-readable client name
- `jti`: token identifier for optional revocation workflows

## Issuer and JWKS

The guard accepts an issuer URL and derives the JWKS URL automatically:

```txt
issuer: https://auth.internal
jwks:   https://auth.internal/.well-known/jwks.json
```

If your provider does not expose the standard JWKS path, the current API also accepts `jwksUrl` explicitly.

## Local verification

Trustline does not introspect tokens remotely. Verification happens in-process:

- fetch JWKS on first use
- cache the JWK set in memory for 10 minutes
- verify signatures locally
- re-fetch the JWKS once on key mismatch or signature verification failure

That design lets your service keep verifying existing tokens without needing the auth server online for every request.

## Authorization checks

The guard can apply three layers of checks:

- issuer: always enforced
- audience: enforced when configured
- scopes: all configured scopes must be present
- environment: enforced when configured

When verification succeeds, Trustline normalizes the token into a service identity object with:

- `clientId`
- `name`
- `scopes`
- `env`
- `raw` decoded JWT payload
