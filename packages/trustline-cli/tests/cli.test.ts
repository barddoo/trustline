import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

describe("trustline-cli", () => {
  it("creates clients and prints shell exports by default", async () => {
    const { databasePath } = await createTempDatabasePath();
    const result = await runCli([
      "client",
      "create",
      "--issuer",
      "https://auth.internal",
      "--sqlite-path",
      databasePath,
      "--name",
      "orders-api",
      "--scope",
      "read:inventory",
      "--scope",
      "write:inventory",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("export TRUSTLINE_CLIENT_ID='svc_");
    expect(result.stdout).toContain("export TRUSTLINE_CLIENT_SECRET='");

    const listed = await runCli([
      "client",
      "list",
      "--issuer",
      "https://auth.internal",
      "--sqlite-path",
      databasePath,
    ]);

    expect(listed.exitCode).toBe(0);
    expect(listed.stdout).toContain("orders-api");
    expect(listed.stdout).toContain("scopes=read:inventory,write:inventory");
  });

  it("supports JSON output and config precedence", async () => {
    const { databasePath, directory } = await createTempDatabasePath();
    const configPath = join(directory, "trustline.config.json");

    await writeFile(
      configPath,
      JSON.stringify({
        issuer: "https://from-config.internal",
        sqlitePath: join(directory, "wrong.sqlite"),
      }),
    );

    const result = await runCli(
      [
        "client",
        "create",
        "--config",
        configPath,
        "--issuer",
        "https://from-flag.internal",
        "--sqlite-path",
        databasePath,
        "--name",
        "inventory-worker",
        "--json",
      ],
      {
        env: {
          TRUSTLINE_CLI_ISSUER: "https://from-env.internal",
        },
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");

    const parsed = JSON.parse(result.stdout) as {
      clientId: string;
      clientSecret: string;
    };

    expect(parsed.clientId).toMatch(/^svc_/);
    expect(parsed.clientSecret.length).toBeGreaterThan(10);

    const fetched = await runCli([
      "client",
      "get",
      "--config",
      configPath,
      "--sqlite-path",
      databasePath,
      "--issuer",
      "https://from-flag.internal",
      "--client-id",
      parsed.clientId,
      "--json",
    ]);

    expect(fetched.exitCode).toBe(0);
    expect(JSON.parse(fetched.stdout)).toMatchObject({
      clientId: parsed.clientId,
      name: "inventory-worker",
    });
  });

  it("updates clients and rotates secrets", async () => {
    const { databasePath } = await createTempDatabasePath();
    const created = await createClient(databasePath, "worker");

    const renamed = await runCli([
      "client",
      "rename",
      "--issuer",
      "https://auth.internal",
      "--sqlite-path",
      databasePath,
      "--client-id",
      created.clientId,
      "--name",
      "worker-v2",
    ]);
    expect(renamed.exitCode).toBe(0);

    const scoped = await runCli([
      "client",
      "set-scopes",
      "--issuer",
      "https://auth.internal",
      "--sqlite-path",
      databasePath,
      "--client-id",
      created.clientId,
      "--scope",
      "jobs:run",
      "--scope",
      "jobs:cancel",
      "--json",
    ]);
    expect(JSON.parse(scoped.stdout)).toMatchObject({
      clientId: created.clientId,
      scopes: ["jobs:run", "jobs:cancel"],
      ok: true,
    });

    const rotated = await runCli([
      "client",
      "rotate-secret",
      "--issuer",
      "https://auth.internal",
      "--sqlite-path",
      databasePath,
      "--client-id",
      created.clientId,
      "--overlap-seconds",
      "0",
    ]);
    expect(rotated.exitCode).toBe(0);
    expect(rotated.stdout).toContain("export TRUSTLINE_CLIENT_SECRET='");

    const fetched = await runCli([
      "client",
      "get",
      "--issuer",
      "https://auth.internal",
      "--sqlite-path",
      databasePath,
      "--client-id",
      created.clientId,
      "--json",
    ]);
    expect(JSON.parse(fetched.stdout)).toMatchObject({
      clientId: created.clientId,
      name: "worker-v2",
      scopes: ["jobs:run", "jobs:cancel"],
      hasPendingSecretRotation: false,
    });
  });

  it("handles disable, token cutoffs, and revocations", async () => {
    const { databasePath } = await createTempDatabasePath();
    const created = await createClient(databasePath, "receiver");

    const disabled = await runCli([
      "client",
      "disable",
      "--issuer",
      "https://auth.internal",
      "--sqlite-path",
      databasePath,
      "--client-id",
      created.clientId,
      "--json",
    ]);
    expect(JSON.parse(disabled.stdout)).toMatchObject({
      clientId: created.clientId,
      active: false,
      ok: true,
    });

    const cutoff = await runCli([
      "client",
      "invalidate-tokens-before",
      "--issuer",
      "https://auth.internal",
      "--sqlite-path",
      databasePath,
      "--client-id",
      created.clientId,
      "--at",
      "2026-01-01T00:00:00.000Z",
      "--json",
    ]);
    expect(JSON.parse(cutoff.stdout)).toMatchObject({
      clientId: created.clientId,
      at: "2026-01-01T00:00:00.000Z",
      ok: true,
    });

    const cleared = await runCli([
      "client",
      "clear-tokens-invalid-before",
      "--issuer",
      "https://auth.internal",
      "--sqlite-path",
      databasePath,
      "--client-id",
      created.clientId,
    ]);
    expect(cleared.exitCode).toBe(0);

    const tokenRevoked = await runCli([
      "token",
      "revoke",
      "--issuer",
      "https://auth.internal",
      "--sqlite-path",
      databasePath,
      "--jti",
      "token-123",
      "--expires-at",
      "2026-01-02T00:00:00.000Z",
      "--json",
    ]);
    expect(JSON.parse(tokenRevoked.stdout)).toMatchObject({
      jti: "token-123",
      ok: true,
    });

    const enabled = await runCli([
      "client",
      "enable",
      "--issuer",
      "https://auth.internal",
      "--sqlite-path",
      databasePath,
      "--client-id",
      created.clientId,
    ]);
    expect(enabled.exitCode).toBe(0);

    const revoked = await runCli([
      "client",
      "revoke",
      "--issuer",
      "https://auth.internal",
      "--sqlite-path",
      databasePath,
      "--client-id",
      created.clientId,
    ]);
    expect(revoked.exitCode).toBe(0);

    const missing = await runCli([
      "client",
      "get",
      "--issuer",
      "https://auth.internal",
      "--sqlite-path",
      databasePath,
      "--client-id",
      created.clientId,
    ]);
    expect(missing.exitCode).toBe(1);
    expect(missing.stderr).toContain(`Unknown client: ${created.clientId}`);
  });

  it("rotates signing keys and validates bad input", async () => {
    const { databasePath } = await createTempDatabasePath();

    const rotated = await runCli([
      "key",
      "rotate",
      "--issuer",
      "https://auth.internal",
      "--sqlite-path",
      databasePath,
      "--algorithm",
      "RS256",
      "--json",
    ]);

    expect(rotated.exitCode).toBe(0);
    expect(JSON.parse(rotated.stdout)).toMatchObject({
      keyId: expect.any(String),
    });

    const invalid = await runCli([
      "client",
      "rotate-secret",
      "--issuer",
      "https://auth.internal",
      "--sqlite-path",
      databasePath,
      "--client-id",
      "svc_missing",
      "--overlap-seconds",
      "10",
      "--expires-at",
      "2026-01-02T00:00:00.000Z",
    ]);

    expect(invalid.exitCode).toBe(1);
    expect(invalid.stderr).toContain(
      "Cannot use --overlap-seconds and --expires-at together.",
    );
  });

  it("builds a host binary that can execute commands", async () => {
    const buildResult = await runSubprocess(
      "bun",
      ["run", "build:cli:host"],
      process.cwd(),
    );
    expect(buildResult.exitCode).toBe(0);

    const { databasePath } = await createTempDatabasePath();
    const binaryPath = resolve(process.cwd(), "dist/cli/trustline-cli");
    const versionResult = await runSubprocess(
      binaryPath,
      ["--version"],
      process.cwd(),
    );
    expect(versionResult.exitCode).toBe(0);
    expect(versionResult.stdout.trim()).not.toBe("");

    const createResult = await runSubprocess(
      binaryPath,
      [
        "client",
        "create",
        "--issuer",
        "https://auth.internal",
        "--sqlite-path",
        databasePath,
        "--name",
        "binary-client",
      ],
      process.cwd(),
    );
    expect(createResult.exitCode).toBe(0);
    expect(createResult.stdout).toContain("TRUSTLINE_CLIENT_ID");
  });
});

async function createTempDatabasePath() {
  const directory = await mkdtemp(join(tmpdir(), "trustline-cli-"));
  directories.push(directory);

  return {
    databasePath: join(directory, "trustline.sqlite"),
    directory,
  };
}

async function createClient(databasePath: string, name: string) {
  const result = await runCli([
    "client",
    "create",
    "--issuer",
    "https://auth.internal",
    "--sqlite-path",
    databasePath,
    "--name",
    name,
    "--json",
  ]);

  return JSON.parse(result.stdout) as {
    clientId: string;
    clientSecret: string;
  };
}

async function runCli(
  args: string[],
  options?: {
    env?: Record<string, string>;
  },
) {
  return runSubprocess(
    "bun",
    ["src/cli/main.ts", ...args],
    process.cwd(),
    options?.env,
  );
}

function runSubprocess(
  command: string,
  args: string[],
  cwd: string,
  env?: Record<string, string>,
) {
  return new Promise<{
    exitCode: number;
    stderr: string;
    stdout: string;
  }>((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", rejectPromise);
    child.on("close", (exitCode) => {
      resolvePromise({
        exitCode: exitCode ?? 1,
        stderr,
        stdout,
      });
    });
  });
}
