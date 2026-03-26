# Hono Services Example

This example shows Trustline in a small Hono-based service mesh:

- `auth.ts` runs a Trustline provider and exposes `/token` and `/.well-known/jwks.json`
- `caller.ts` fetches a token with `trustline/client` and calls the receiver
- `receiver.ts` verifies the bearer token with `createGuard()` and `createHonoGuard()`

## Ports

- auth: `4100`
- caller: `4101`
- receiver: `4102`

## Run

Build the package first so the self-referenced `trustline` imports resolve to the latest `dist/` output:

```bash
bun run build
```

Start each service in its own terminal with Node.js:

```bash
npm run example:hono:auth
npm run example:hono:receiver
npm run example:hono:caller
```

Then trigger the caller:

```bash
curl http://127.0.0.1:4101/call-receiver
```

Expected response shape:

```json
{
  "service": "orders-api",
  "receiverStatus": 200,
  "audience": "inventory-service",
  "requiredScope": "read:inventory",
  "downstream": {
    "service": "inventory-service",
    "message": "Receiver accepted the Trustline token",
    "caller": {
      "clientId": "svc_...",
      "name": "orders-api",
      "scopes": ["read:inventory"],
      "env": "production"
    }
  }
}
```

## Notes

- The auth service includes a demo-only endpoint at `/example/credentials` so the caller can bootstrap itself without manual secret copying.
- This endpoint exists only to keep the example runnable. In a real deployment, client credentials would be provisioned out of band.
