import { Hono } from "hono";
import { createClient } from "trustline/client";

import {
  AUTH_ISSUER,
  AUTH_PORT,
  CALL_RECEIVER_PATH,
  CALLER_PORT,
  DEMO_CREDENTIALS_PATH,
  RECEIVER_PATH,
} from "./config.js";
import { serveApp } from "./server.js";

const app = new Hono();
let cachedClient = null;

app.get("/", (context) =>
  context.json({
    service: "orders-api",
    callRoute: CALL_RECEIVER_PATH,
    authIssuer: AUTH_ISSUER,
    authPort: AUTH_PORT,
  }),
);

app.get(CALL_RECEIVER_PATH, async (context) => {
  const credentials = await getDemoCredentials();
  const client = getClient(credentials);
  const downstream = await client.fetch(
    `${credentials.receiverUrl}${RECEIVER_PATH}`,
  );
  const body = await downstream.json();

  return context.json({
    service: "orders-api",
    receiverStatus: downstream.status,
    audience: credentials.audience,
    requiredScope: credentials.requiredScope,
    downstream: body,
  });
});

console.log(
  `[caller] invoke: http://127.0.0.1:${CALLER_PORT}${CALL_RECEIVER_PATH}`,
);

serveApp({
  fetch: app.fetch,
  name: "caller",
  port: CALLER_PORT,
});

function getClient(credentials) {
  if (cachedClient) {
    return cachedClient;
  }

  cachedClient = createClient({
    tokenUrl: credentials.tokenUrl,
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
    audience: credentials.audience,
  });

  return cachedClient;
}

async function getDemoCredentials() {
  const response = await fetch(`${AUTH_ISSUER}${DEMO_CREDENTIALS_PATH}`);
  if (!response.ok) {
    throw new Error(
      `Failed to load demo credentials from auth service: ${response.status}`,
    );
  }

  return response.json();
}
