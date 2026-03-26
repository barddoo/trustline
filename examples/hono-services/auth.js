import { Hono } from "hono";
import { createProvider, memoryStorage } from "trustline";
import { createHonoProvider } from "trustline/frameworks/hono";

import {
  AUTH_ISSUER,
  AUTH_PORT,
  CALLER_URL,
  DEMO_CREDENTIALS_PATH,
  RECEIVER_AUDIENCE,
  RECEIVER_URL,
  REQUIRED_SCOPE,
  TRUSTLINE_ENV,
} from "./config.js";
import { serveApp } from "./server.js";

const provider = createProvider({
  issuer: AUTH_ISSUER,
  storage: memoryStorage(),
  env: TRUSTLINE_ENV,
});

const createdClient = await provider.clients.create({
  name: "orders-api",
  scopes: [REQUIRED_SCOPE],
});

const app = new Hono();

app.route("/", createHonoProvider(provider));

app.get("/", (context) =>
  context.json({
    service: "trustline-auth",
    issuer: AUTH_ISSUER,
    tokenUrl: `${AUTH_ISSUER}/token`,
    jwksUrl: `${AUTH_ISSUER}/.well-known/jwks.json`,
    callerUrl: CALLER_URL,
    receiverUrl: RECEIVER_URL,
  }),
);

app.get(DEMO_CREDENTIALS_PATH, (context) =>
  context.json({
    clientId: createdClient.clientId,
    clientSecret: createdClient.clientSecret,
    audience: RECEIVER_AUDIENCE,
    receiverUrl: RECEIVER_URL,
    requiredScope: REQUIRED_SCOPE,
    tokenUrl: `${AUTH_ISSUER}/token`,
  }),
);

console.log(`[auth] issuer: ${AUTH_ISSUER}`);
console.log(`[auth] jwks: ${AUTH_ISSUER}/.well-known/jwks.json`);
console.log(`[auth] token: ${AUTH_ISSUER}/token`);
console.log(`[auth] demo client id: ${createdClient.clientId}`);
console.log(`[auth] demo client secret: ${createdClient.clientSecret}`);
console.log(
  `[auth] caller route: ${CALLER_URL} (fetches ${DEMO_CREDENTIALS_PATH} automatically)`,
);

serveApp({
  fetch: app.fetch,
  name: "auth",
  port: AUTH_PORT,
});
