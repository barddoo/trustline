import BetterSqlite3 from "better-sqlite3";
import { Kysely, SqliteDialect } from "kysely";

import type { SqlStorageOptions, StorageAdapter } from "./interface";
import { createSqlStorage } from "./sql";

export function sqliteStorage(
  pathOrDatabase: string | BetterSqlite3.Database,
  options?: SqlStorageOptions,
): StorageAdapter {
  const database =
    typeof pathOrDatabase === "string"
      ? createSqliteDatabase(pathOrDatabase)
      : pathOrDatabase;

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

function createSqliteDatabase(path: string): BetterSqlite3.Database {
  const database = new BetterSqlite3(path);
  database.pragma("journal_mode = WAL");
  return database;
}
