import { describe, expect, it } from "vitest";

import { createGuard, createProvider, memoryStorage } from "../../src";
import { createProviderServer } from "../helpers";

describe("provider", () => {
  it("issues tokens that the guard can verify", async () => {
    const server = await createProviderServer((issuer) =>
      createProvider({
        issuer,
        env: "production",
        storage: memoryStorage(),
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
