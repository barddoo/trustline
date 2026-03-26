import { describe, expect, it } from "vitest";

import { JwksCache } from "../../src/core/cache";
import { deriveJwksUrl, verifyToken } from "../../src/core/token";
import { createTestIssuer, createUnreachableUrl } from "../helpers";

describe("verifyToken", () => {
  it("verifies a token using the issuer-derived JWKS URL", async () => {
    const issuer = await createTestIssuer({ aud: "inventory-service" });

    try {
      const token = await issuer.issueToken();
      const identity = await verifyToken(token, {
        issuer: issuer.issuer,
        audience: "inventory-service",
        storage: issuer.storage,
      });

      expect(identity.clientId).toBe("svc_test_client");
      expect(identity.name).toBe("order-processor");
      expect(identity.scopes).toEqual(["read:orders", "write:inventory"]);
      expect(identity.env).toBe("production");
    } finally {
      await issuer.close();
    }
  });

  it("supports an explicit JWKS override", async () => {
    const issuer = await createTestIssuer({ aud: "inventory-service" });

    try {
      const token = await issuer.issueToken();
      const identity = await verifyToken(token, {
        issuer: issuer.issuer,
        jwksUrl: issuer.jwksUrl,
        audience: "inventory-service",
        storage: issuer.storage,
      });

      expect(identity.clientId).toBe("svc_test_client");
    } finally {
      await issuer.close();
    }
  });

  it("rejects tokens with the wrong audience", async () => {
    const issuer = await createTestIssuer({ aud: "inventory-service" });

    try {
      const token = await issuer.issueToken();

      await expect(
        verifyToken(token, {
          issuer: issuer.issuer,
          audience: "billing-service",
          storage: issuer.storage,
        }),
      ).rejects.toMatchObject({
        code: "invalid_audience",
        status: 403,
      });
    } finally {
      await issuer.close();
    }
  });

  it("rejects tokens missing required scopes", async () => {
    const issuer = await createTestIssuer({
      aud: "inventory-service",
      scope: "read:orders",
    });

    try {
      const token = await issuer.issueToken();

      await expect(
        verifyToken(token, {
          issuer: issuer.issuer,
          audience: "inventory-service",
          scopes: ["read:orders", "write:inventory"],
          storage: issuer.storage,
        }),
      ).rejects.toMatchObject({
        code: "invalid_scope",
        status: 403,
      });
    } finally {
      await issuer.close();
    }
  });

  it("rejects tokens from the wrong environment", async () => {
    const issuer = await createTestIssuer({
      aud: "inventory-service",
      env: "staging",
    });

    try {
      const token = await issuer.issueToken();

      await expect(
        verifyToken(token, {
          issuer: issuer.issuer,
          audience: "inventory-service",
          env: "production",
          storage: issuer.storage,
        }),
      ).rejects.toMatchObject({
        code: "invalid_env",
        status: 403,
      });
    } finally {
      await issuer.close();
    }
  });

  it("caches JWKS responses within the configured TTL", async () => {
    const issuer = await createTestIssuer({ aud: "inventory-service" });
    const cache = new JwksCache({ ttlMs: 60_000 });

    try {
      const token = await issuer.issueToken();

      await verifyToken(token, {
        issuer: issuer.issuer,
        audience: "inventory-service",
        jwksCache: cache,
        storage: issuer.storage,
      });
      await verifyToken(token, {
        issuer: issuer.issuer,
        audience: "inventory-service",
        jwksCache: cache,
        storage: issuer.storage,
      });

      expect(issuer.getFetchCount()).toBe(1);
    } finally {
      await issuer.close();
    }
  });

  it("deduplicates concurrent JWKS fetches", async () => {
    const issuer = await createTestIssuer({ aud: "inventory-service" });
    const cache = new JwksCache({ ttlMs: 60_000 });

    try {
      const token = await issuer.issueToken();

      await Promise.all([
        verifyToken(token, {
          issuer: issuer.issuer,
          audience: "inventory-service",
          jwksCache: cache,
          storage: issuer.storage,
        }),
        verifyToken(token, {
          issuer: issuer.issuer,
          audience: "inventory-service",
          jwksCache: cache,
          storage: issuer.storage,
        }),
        verifyToken(token, {
          issuer: issuer.issuer,
          audience: "inventory-service",
          jwksCache: cache,
          storage: issuer.storage,
        }),
      ]);

      expect(issuer.getFetchCount()).toBe(1);
    } finally {
      await issuer.close();
    }
  });

  it("surfaces JWKS fetch failures", async () => {
    const jwksUrl = await createUnreachableUrl();

    await expect(
      verifyToken("invalid", {
        issuer: "http://example.test",
        jwksUrl,
        storage: issuerlessStorage(),
      }),
    ).rejects.toMatchObject({
      code: "jwks_fetch_failed",
      status: 401,
    });
  });

  it("derives the standard JWKS path from the issuer", () => {
    expect(deriveJwksUrl("https://auth.internal")).toBe(
      "https://auth.internal/.well-known/jwks.json",
    );
    expect(deriveJwksUrl("https://auth.internal/")).toBe(
      "https://auth.internal/.well-known/jwks.json",
    );
  });
});

function issuerlessStorage() {
  return createTestIssuerStorage();
}

function createTestIssuerStorage() {
  return {
    findClient: async () => null,
    createClient: async () => {},
    deleteClient: async () => {},
    listClients: async () => [],
    touchClient: async () => {},
    setClientActive: async () => {},
    setTokensInvalidBefore: async () => {},
    getSigningKeys: async () => [],
    addSigningKey: async () => {},
    setSigningKeyNotAfter: async () => {},
    findRevokedToken: async () => null,
    revokeToken: async () => {},
  };
}
