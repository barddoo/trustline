import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

import { createProvider } from "../../src";
import { sqliteStorage } from "../../src/adapters/sqlite";

describe("sqliteStorage(database)", () => {
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      directories
        .splice(0)
        .map((directory) => rm(directory, { force: true, recursive: true })),
    );
  });

  it("persists clients across provider instances", async () => {
    const directory = await mkdtemp(join(tmpdir(), "trustline-"));
    directories.push(directory);

    const databasePath = join(directory, "trustline.sqlite");
    const database = new Database(databasePath);

    try {
      const providerA = createProvider({
        issuer: "http://example.test",
        storage: sqliteStorage(database),
      });

      const created = await providerA.clients.create({
        name: "worker",
        scopes: ["jobs:run"],
      });

      const providerB = createProvider({
        issuer: "http://example.test",
        storage: sqliteStorage(database),
      });

      const clients = await providerB.clients.list();

      expect(clients).toHaveLength(1);
      expect(clients[0]?.clientId).toBe(created.clientId);
      expect(clients[0]?.clientSecret).not.toBe(created.clientSecret);
    } finally {
      database.close();
    }
  });
});
