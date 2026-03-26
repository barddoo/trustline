import { describe, expect, it } from "vitest";

import { createProvider, memoryStorage } from "../../src";
import { createGuard } from "../../src/middleware";
import { createProviderServer } from "../helpers";

describe("createGuard().verify", () => {
  it("verifies a real token end to end against a JWKS endpoint", async () => {
    const storage = memoryStorage();
    const issuer = await createProviderServer((url) =>
      createProvider({
        issuer: url,
        env: "production",
        storage,
      }),
    );

    try {
      const created = await issuer.provider.clients.create({
        name: "order-processor",
        scopes: ["read:orders", "write:inventory"],
      });

      const guard = createGuard({
        issuer: issuer.issuer,
        audience: "inventory-service",
        storage,
      });

      const response = await fetch(issuer.url("/token"), {
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
      const payload = (await response.json()) as { access_token: string };

      const token = payload.access_token;
      const identity = await guard.verify(token);

      expect(identity).toMatchObject({
        clientId: created.clientId,
        name: "order-processor",
        env: "production",
      });
      expect(identity.scopes).toEqual(["read:orders", "write:inventory"]);
    } finally {
      await issuer.close();
    }
  });
});
