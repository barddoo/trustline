import process from "node:process";

import type { ResolvedCliConfig } from "./config";

export function writeResult(
  config: ResolvedCliConfig,
  payload: unknown,
  message: string,
): void {
  if (config.json) {
    writeJson(payload);
    return;
  }

  process.stdout.write(`${message}\n`);
}

export function writeJson(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

export function writeCreatedClientExports(
  clientId: string,
  clientSecret: string,
): void {
  process.stdout.write(
    `${[
      `export TRUSTLINE_CLIENT_ID=${quoteShellValue(clientId)}`,
      `export TRUSTLINE_CLIENT_SECRET=${quoteShellValue(clientSecret)}`,
    ].join("\n")}\n`,
  );
}

export function writeRotatedSecretExport(clientSecret: string): void {
  process.stdout.write(
    `export TRUSTLINE_CLIENT_SECRET=${quoteShellValue(clientSecret)}\n`,
  );
}

export function formatClientSummary(client: {
  active: boolean;
  clientId: string;
  name: string;
  scopes: string[];
}): string {
  return [
    client.clientId,
    client.name,
    client.active ? "active" : "disabled",
    `scopes=${client.scopes.join(",") || "-"}`,
  ].join(" ");
}

export function formatClientDetails(client: {
  active: boolean;
  clientId: string;
  createdAt: Date;
  currentSecretCreatedAt: Date;
  currentSecretLastUsedAt: Date | null;
  hasPendingSecretRotation: boolean;
  lastSeenAt: Date | null;
  name: string;
  nextSecretCreatedAt: Date | null;
  nextSecretExpiresAt: Date | null;
  nextSecretLastUsedAt: Date | null;
  scopes: string[];
  secretLastRotatedAt: Date | null;
  tokensInvalidBefore: Date | null;
  updatedAt: Date;
}): string {
  return [
    `clientId: ${client.clientId}`,
    `name: ${client.name}`,
    `active: ${client.active}`,
    `scopes: ${client.scopes.join(", ") || "-"}`,
    `createdAt: ${client.createdAt.toISOString()}`,
    `updatedAt: ${client.updatedAt.toISOString()}`,
    `lastSeenAt: ${client.lastSeenAt?.toISOString() ?? "null"}`,
    `currentSecretCreatedAt: ${client.currentSecretCreatedAt.toISOString()}`,
    `currentSecretLastUsedAt: ${client.currentSecretLastUsedAt?.toISOString() ?? "null"}`,
    `nextSecretCreatedAt: ${client.nextSecretCreatedAt?.toISOString() ?? "null"}`,
    `nextSecretExpiresAt: ${client.nextSecretExpiresAt?.toISOString() ?? "null"}`,
    `nextSecretLastUsedAt: ${client.nextSecretLastUsedAt?.toISOString() ?? "null"}`,
    `secretLastRotatedAt: ${client.secretLastRotatedAt?.toISOString() ?? "null"}`,
    `tokensInvalidBefore: ${client.tokensInvalidBefore?.toISOString() ?? "null"}`,
    `hasPendingSecretRotation: ${client.hasPendingSecretRotation}`,
  ].join("\n");
}

function quoteShellValue(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
