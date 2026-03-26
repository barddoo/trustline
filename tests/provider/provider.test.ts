import { describe, expect, it } from "vitest";

import { createGuard, createProvider, memoryStorage } from "../../src";
import { createProviderServer } from "../helpers";

describe("provider", () => {
  it("serves JWKS with cache-control headers", async () => {
    const server = await createProviderServer((issuer) =>
      createProvider({
        issuer,
        storage: memoryStorage(),
      }),
    );

    try {
      const response = await fetch(server.url("/.well-known/jwks.json"));

      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("public, max-age=600");
      expect(await response.json()).toMatchObject({
        keys: expect.any(Array),
      });
    } finally {
      await server.close();
    }
  });

  it("issues tokens that the guard can verify", async () => {
    const storage = memoryStorage();
    const server = await createProviderServer((issuer) =>
      createProvider({
        issuer,
        env: "production",
        storage,
      }),
    );

    try {
      const created = await server.provider.clients.create({
        name: "order-processor",
        scopes: ["read:orders", "write:inventory"],
      });

      const response = await fetch(server.url("/token"), {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from(
            `${created.clientId}:${created.clientSecret}`,
          ).toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          audience: "inventory-service",
        }).toString(),
      });

      expect(response.status).toBe(200);
      const payload = (await response.json()) as { access_token: string };

      const guard = createGuard({
        issuer: server.issuer,
        audience: "inventory-service",
        env: "production",
        scopes: ["read:orders"],
        storage,
      });
      const identity = await guard.verify(payload.access_token);

      expect(identity.clientId).toBe(created.clientId);
      expect(identity.name).toBe("order-processor");
      expect(identity.scopes).toEqual(["read:orders", "write:inventory"]);
      expect(identity.env).toBe("production");
    } finally {
      await server.close();
    }
  });

  it("narrows scopes when a valid subset is requested", async () => {
    const storage = memoryStorage();
    const server = await createProviderServer((issuer) =>
      createProvider({
        issuer,
        storage,
      }),
    );

    try {
      const created = await server.provider.clients.create({
        name: "order-processor",
        scopes: ["read:orders", "write:inventory"],
      });

      const response = await fetch(server.url("/token"), {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from(
            `${created.clientId}:${created.clientSecret}`,
          ).toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          audience: "inventory-service",
          scope: "read:orders",
        }).toString(),
      });

      expect(response.status).toBe(200);
      const payload = (await response.json()) as {
        access_token: string;
        scope: string;
      };

      const guard = createGuard({
        issuer: server.issuer,
        audience: "inventory-service",
        storage,
      });
      const identity = await guard.verify(payload.access_token);

      expect(payload.scope).toBe("read:orders");
      expect(identity.scopes).toEqual(["read:orders"]);
    } finally {
      await server.close();
    }
  });

  it("preserves scopes when the requested set exactly matches the client permissions", async () => {
    const storage = memoryStorage();
    const server = await createProviderServer((issuer) =>
      createProvider({
        issuer,
        storage,
      }),
    );

    try {
      const created = await server.provider.clients.create({
        name: "order-processor",
        scopes: ["read:orders", "write:inventory"],
      });

      const response = await fetch(server.url("/token"), {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from(
            `${created.clientId}:${created.clientSecret}`,
          ).toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          scope: "read:orders write:inventory",
        }).toString(),
      });

      expect(response.status).toBe(200);
      const payload = (await response.json()) as {
        access_token: string;
        scope: string;
      };

      const guard = createGuard({
        issuer: server.issuer,
        storage,
      });
      const identity = await guard.verify(payload.access_token);

      expect(payload.scope).toBe("read:orders write:inventory");
      expect(identity.scopes).toEqual(["read:orders", "write:inventory"]);
    } finally {
      await server.close();
    }
  });

  it("rejects requested scopes outside the client permissions", async () => {
    const server = await createProviderServer((issuer) =>
      createProvider({
        issuer,
        storage: memoryStorage(),
      }),
    );

    try {
      const created = await server.provider.clients.create({
        name: "order-processor",
        scopes: ["read:orders"],
      });

      const response = await fetch(server.url("/token"), {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from(
            `${created.clientId}:${created.clientSecret}`,
          ).toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          scope: "write:inventory",
        }).toString(),
      });

      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: "invalid_scope",
      });
    } finally {
      await server.close();
    }
  });

  it("rejects inactive clients", async () => {
    const storage = memoryStorage();
    const server = await createProviderServer((issuer) =>
      createProvider({
        issuer,
        storage,
      }),
    );

    try {
      const created = await server.provider.clients.create({
        name: "billing-worker",
      });
      await server.provider.clients.disable(created.clientId);

      const response = await fetch(server.url("/token"), {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from(
            `${created.clientId}:${created.clientSecret}`,
          ).toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
      });

      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({
        error: "invalid_client",
      });
    } finally {
      await server.close();
    }
  });

  it("rejects revoked tokens during verification", async () => {
    const storage = memoryStorage();
    const server = await createProviderServer((issuer) =>
      createProvider({
        issuer,
        storage,
      }),
    );

    try {
      const created = await server.provider.clients.create({
        name: "order-processor",
      });

      const response = await fetch(server.url("/token"), {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from(
            `${created.clientId}:${created.clientSecret}`,
          ).toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
      });
      const payload = (await response.json()) as { access_token: string };
      const claims = JSON.parse(
        Buffer.from(
          payload.access_token.split(".")[1] ?? "",
          "base64url",
        ).toString("utf8"),
      ) as { exp: number; jti: string };

      await server.provider.tokens.revoke(
        claims.jti,
        new Date(claims.exp * 1000),
      );

      const guard = createGuard({
        issuer: server.issuer,
        storage,
      });

      await expect(guard.verify(payload.access_token)).rejects.toMatchObject({
        code: "invalid_token",
      });
    } finally {
      await server.close();
    }
  });

  it("rejects tokens issued before the client cutoff", async () => {
    const storage = memoryStorage();
    const server = await createProviderServer((issuer) =>
      createProvider({
        issuer,
        storage,
      }),
    );

    try {
      const created = await server.provider.clients.create({
        name: "order-processor",
      });

      const firstResponse = await fetch(server.url("/token"), {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from(
            `${created.clientId}:${created.clientSecret}`,
          ).toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
      });
      const firstPayload = (await firstResponse.json()) as {
        access_token: string;
      };
      const firstClaims = JSON.parse(
        Buffer.from(
          firstPayload.access_token.split(".")[1] ?? "",
          "base64url",
        ).toString("utf8"),
      ) as { iat: number };

      const cutoff = new Date((firstClaims.iat + 1) * 1000);
      await server.provider.clients.invalidateTokensBefore(
        created.clientId,
        cutoff,
      );
      await waitFor(cutoff.getTime() - Date.now() + 50);

      const secondResponse = await fetch(server.url("/token"), {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from(
            `${created.clientId}:${created.clientSecret}`,
          ).toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
      });
      const secondPayload = (await secondResponse.json()) as {
        access_token: string;
      };

      const guard = createGuard({
        issuer: server.issuer,
        storage,
      });

      await expect(
        guard.verify(firstPayload.access_token),
      ).rejects.toMatchObject({
        code: "invalid_token",
      });
      await expect(
        guard.verify(secondPayload.access_token),
      ).resolves.toMatchObject({
        clientId: created.clientId,
      });
    } finally {
      await server.close();
    }
  });

  it("restores verification after clearing the client cutoff", async () => {
    const storage = memoryStorage();
    const server = await createProviderServer((issuer) =>
      createProvider({
        issuer,
        storage,
      }),
    );

    try {
      const created = await server.provider.clients.create({
        name: "order-processor",
      });

      const response = await fetch(server.url("/token"), {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from(
            `${created.clientId}:${created.clientSecret}`,
          ).toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
      });
      const payload = (await response.json()) as { access_token: string };
      const claims = JSON.parse(
        Buffer.from(
          payload.access_token.split(".")[1] ?? "",
          "base64url",
        ).toString("utf8"),
      ) as { iat: number };

      const cutoff = new Date((claims.iat + 1) * 1000);
      await server.provider.clients.invalidateTokensBefore(
        created.clientId,
        cutoff,
      );
      await waitFor(cutoff.getTime() - Date.now() + 50);

      const guard = createGuard({
        issuer: server.issuer,
        storage,
      });

      await expect(guard.verify(payload.access_token)).rejects.toMatchObject({
        code: "invalid_token",
      });

      await server.provider.clients.clearTokensInvalidBefore(created.clientId);

      await expect(guard.verify(payload.access_token)).resolves.toMatchObject({
        clientId: created.clientId,
      });
    } finally {
      await server.close();
    }
  });

  it("keeps old and new tokens valid during key overlap after rotation", async () => {
    const storage = memoryStorage();
    const server = await createProviderServer((issuer) =>
      createProvider({
        issuer,
        storage,
      }),
    );

    try {
      const created = await server.provider.clients.create({
        name: "order-processor",
      });

      const firstResponse = await fetch(server.url("/token"), {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from(
            `${created.clientId}:${created.clientSecret}`,
          ).toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
      });
      const firstPayload = (await firstResponse.json()) as {
        access_token: string;
      };

      await server.provider.keys.rotate({ overlapSeconds: 300 });

      const secondResponse = await fetch(server.url("/token"), {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from(
            `${created.clientId}:${created.clientSecret}`,
          ).toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
      });
      const secondPayload = (await secondResponse.json()) as {
        access_token: string;
      };

      const guard = createGuard({
        issuer: server.issuer,
        storage,
      });

      await expect(
        guard.verify(firstPayload.access_token),
      ).resolves.toMatchObject({
        clientId: created.clientId,
      });
      await expect(
        guard.verify(secondPayload.access_token),
      ).resolves.toMatchObject({
        clientId: created.clientId,
      });
    } finally {
      await server.close();
    }
  });

  it("rejects invalid client secrets", async () => {
    const server = await createProviderServer((issuer) =>
      createProvider({
        issuer,
        storage: memoryStorage(),
      }),
    );

    try {
      const created = await server.provider.clients.create({
        name: "billing-worker",
      });

      const response = await fetch(server.url("/token"), {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from(
            `${created.clientId}:wrong-secret`,
          ).toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
      });

      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({
        error: "invalid_client",
      });
    } finally {
      await server.close();
    }
  });
});

function waitFor(milliseconds: number): Promise<void> {
  return new Promise((resolve) =>
    setTimeout(resolve, Math.max(milliseconds, 0)),
  );
}
