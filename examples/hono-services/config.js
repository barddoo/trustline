export const AUTH_PORT = 4100;
export const CALLER_PORT = 4101;
export const RECEIVER_PORT = 4102;

export const TRUSTLINE_ENV = "production";
export const REQUIRED_SCOPE = "read:inventory";
export const RECEIVER_AUDIENCE = "inventory-service";

export const AUTH_ISSUER = `http://127.0.0.1:${AUTH_PORT}`;
export const CALLER_URL = `http://127.0.0.1:${CALLER_PORT}`;
export const RECEIVER_URL = `http://127.0.0.1:${RECEIVER_PORT}`;

export const DEMO_CREDENTIALS_PATH = "/example/credentials";
export const CALL_RECEIVER_PATH = "/call-receiver";
export const RECEIVER_PATH = "/internal/inventory";
