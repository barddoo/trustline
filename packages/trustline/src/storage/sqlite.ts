import type { Database as BunSqliteDatabase } from "bun:sqlite";
import { createRequire } from "node:module";
import { join } from "node:path";
import type BetterSqlite3 from "better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";

import type { SqlStorageOptions, StorageAdapter } from "./interface";
import { createSqlStorage } from "./sql";

export function sqliteStorage(
  pathOrDatabase: string | BetterSqlite3.Database | BunSqliteDatabase,
  options?: SqlStorageOptions,
): StorageAdapter {
  return isBunRuntime()
    ? createBunSqliteStorage(pathOrDatabase, options)
    : createNodeSqliteStorage(pathOrDatabase, options);
}

function createNodeSqliteStorage(
  pathOrDatabase: string | BetterSqlite3.Database | BunSqliteDatabase,
  options?: SqlStorageOptions,
): StorageAdapter {
  const database =
    typeof pathOrDatabase === "string"
      ? createNodeSqliteDatabase(pathOrDatabase)
      : (pathOrDatabase as BetterSqlite3.Database);

  return createSqlStorage(
    new Kysely({
      dialect: new SqliteDialect({
        database,
      }),
    }),
    "sqlite",
    options,
  );
}

function createNodeSqliteDatabase(path: string): BetterSqlite3.Database {
  const require = createRuntimeRequire();
  const BetterSqlite3 =
    require("better-sqlite3") as typeof import("better-sqlite3");
  const database = new BetterSqlite3(path);
  database.pragma("journal_mode = WAL");
  return database;
}

function createBunSqliteStorage(
  pathOrDatabase: string | BetterSqlite3.Database | BunSqliteDatabase,
  options?: SqlStorageOptions,
): StorageAdapter {
  const database =
    typeof pathOrDatabase === "string"
      ? createBunSqliteDatabase(pathOrDatabase)
      : (pathOrDatabase as BunSqliteDatabase);

  return createSqlStorage(
    new Kysely({
      dialect: new SqliteDialect({
        database: wrapBunDatabase(database),
      }),
    }),
    "sqlite",
    options,
  );
}

function createBunSqliteDatabase(path: string): BunSqliteDatabase {
  const require = createRuntimeRequire();
  const { Database } = require("bun:sqlite") as typeof import("bun:sqlite");
  const database = new Database(path);
  database.exec("pragma journal_mode = WAL");
  return database;
}

function wrapBunDatabase(database: BunSqliteDatabase) {
  return {
    close() {
      database.close();
    },
    prepare(sql: string) {
      const statement = database.prepare(sql);

      return {
        reader: (statement.columnNames?.length ?? 0) > 0,
        all(parameters: ReadonlyArray<unknown>) {
          return statement.all(...parameters);
        },
        iterate(parameters: ReadonlyArray<unknown>) {
          return statement.iterate(...parameters);
        },
        run(parameters: ReadonlyArray<unknown>) {
          return statement.run(...parameters);
        },
      };
    },
  };
}

function isBunRuntime(): boolean {
  return "Bun" in globalThis;
}

function createRuntimeRequire(): NodeRequire {
  const globalWithRequire = globalThis as typeof globalThis & {
    require?: NodeRequire;
  };

  if (typeof globalWithRequire.require === "function") {
    return globalWithRequire.require;
  }

  return createRequire(join(process.cwd(), "package.json"));
}
