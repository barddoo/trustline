import { Hono } from "hono";
import { createGuard } from "trustline";
import { createHonoGuard } from "trustline/frameworks/hono";

import {
  AUTH_ISSUER,
  RECEIVER_AUDIENCE,
  RECEIVER_PATH,
  RECEIVER_PORT,
  REQUIRED_SCOPE,
  TRUSTLINE_ENV,
} from "./config.js";
import { serveApp } from "./server.js";

const app = new Hono();

const guard = createGuard({
  issuer: AUTH_ISSUER,
  audience: RECEIVER_AUDIENCE,
  scopes: [REQUIRED_SCOPE],
  env: TRUSTLINE_ENV,
});

app.get("/", (context) =>
  context.json({
    service: "inventory-service",
    protectedRoute: RECEIVER_PATH,
    issuer: AUTH_ISSUER,
    requiredScope: REQUIRED_SCOPE,
    audience: RECEIVER_AUDIENCE,
  }),
);

app.use(RECEIVER_PATH, createHonoGuard(guard));

app.get(RECEIVER_PATH, (context) => {
  const identity = context.get("trustline");

  return context.json({
    service: "inventory-service",
    message: "Receiver accepted the Trustline token",
    caller: {
      clientId: identity.clientId,
      name: identity.name,
      scopes: identity.scopes,
      env: identity.env,
    },
  });
});

console.log(`[receiver] protected route: ${RECEIVER_PATH}`);

serveApp({
  fetch: app.fetch,
  name: "receiver",
  port: RECEIVER_PORT,
});
