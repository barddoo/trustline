import { describe, expect, it } from "vitest";

import { createGuard } from "../../src/middleware";
import { createTestIssuer } from "../helpers";

describe("createGuard().verify", () => {
  it("verifies a real token end to end against a JWKS endpoint", async () => {
    const issuer = await createTestIssuer({ aud: "inventory-service" });

    try {
      const guard = createGuard({
        issuer: issuer.issuer,
        audience: "inventory-service",
      });

      const token = await issuer.issueToken();
      const identity = await guard.verify(token);

      expect(identity).toMatchObject({
        clientId: "svc_test_client",
        name: "order-processor",
        env: "production",
      });
      expect(identity.scopes).toEqual(["read:orders", "write:inventory"]);
    } finally {
      await issuer.close();
    }
  });
});
