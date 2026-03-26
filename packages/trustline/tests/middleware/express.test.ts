import express from "express";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { createGuard, memoryStorage } from "../../src";
import { createExpressGuard } from "../../src/frameworks/express";
import { createTestIssuer, type TestIssuer } from "../helpers";

describe("Express guard", () => {
  const issuers: TestIssuer[] = [];

  afterEach(async () => {
    await Promise.all(issuers.splice(0).map((issuer) => issuer.close()));
  });

  it("returns 401 when the bearer token is missing", async () => {
    const app = express();
    const guard = createGuard({
      issuer: "http://127.0.0.1:9999",
      storage: memoryStorage(),
    });

    app.use(createExpressGuard(guard));
    app.get("/", (_request, response) => {
      response.json({ ok: true });
    });

    const response = await request(app).get("/");

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      error: "missing_token",
      message: "Missing bearer token",
    });
  });

  it("attaches the verified identity to the request", async () => {
    const issuer = await createTestIssuer({ aud: "inventory-service" });
    issuers.push(issuer);

    const token = await issuer.issueToken();
    const app = express();
    const guard = createGuard({
      issuer: issuer.issuer,
      audience: "inventory-service",
      storage: issuer.storage,
    });

    app.use(createExpressGuard(guard));
    app.get("/", (req, response) => {
      response.json((req as { trustline?: { clientId: string } }).trustline);
    });

    const response = await request(app)
      .get("/")
      .set("authorization", `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.clientId).toBe("svc_test_client");
  });

  it("returns 403 for authorization failures", async () => {
    const issuer = await createTestIssuer({
      aud: "inventory-service",
      scope: "read:orders",
    });
    issuers.push(issuer);

    const token = await issuer.issueToken();
    const app = express();
    const guard = createGuard({
      issuer: issuer.issuer,
      audience: "inventory-service",
      scopes: ["write:inventory"],
      storage: issuer.storage,
    });

    app.use(createExpressGuard(guard));
    app.get("/", (_request, response) => {
      response.json({ ok: true });
    });

    const response = await request(app)
      .get("/")
      .set("authorization", `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(response.body.error).toBe("invalid_scope");
  });
});
