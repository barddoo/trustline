# Operations

Trustline now includes the Phase 1 operational controls needed to move beyond a basic demo flow.

## Requested scope narrowing

Clients can request a subset of their assigned scopes on the token endpoint by sending `scope` with the `client_credentials` request.

- If no `scope` is requested, the provider grants the client's full assigned scope set.
- If the requested scopes are an exact match or a strict subset, the provider grants only that requested set.
- If any requested scope falls outside the client's assigned scopes, the provider returns `invalid_scope`.

The token response includes the effective granted scopes in its `scope` field.

## Token revocation by `jti`

Trustline issues `jti` claims on access tokens and verifies revocation during guard checks.

Use the provider token admin API:

```ts
await provider.tokens.revoke(jti, expiresAt);
```

- Revocation stays in effect until the token expiration you provide.
- The guard rejects revoked tokens with `invalid_token`.

## Client disable and token cutoffs

Client-wide response controls are exposed on `provider.clients`:

```ts
await provider.clients.disable(clientId);
await provider.clients.enable(clientId);
await provider.clients.invalidateTokensBefore(clientId, cutoff);
await provider.clients.clearTokensInvalidBefore(clientId);
```

- Disabled clients cannot obtain new tokens.
- `invalidateTokensBefore` rejects tokens issued before the cutoff while allowing newer tokens.
- `clearTokensInvalidBefore` removes that cutoff without recreating the client.

## Signing key rotation overlap windows

Rotate signing keys with a new primary key while keeping older tokens verifiable during an overlap window:

```ts
await provider.keys.rotate({
  overlapSeconds: 300,
});
```

- New tokens are signed with the new key once it becomes active.
- Older keys remain in JWKS as verification-only keys until the overlap window ends.
- The default overlap is token TTL plus 60 seconds.

Safe practice:

- Keep overlap at least as long as your token TTL.
- Rotate keys before retiring old infrastructure that still serves cached tokens.
- Let verifier JWKS caches refresh naturally before assuming the old key is no longer needed.
