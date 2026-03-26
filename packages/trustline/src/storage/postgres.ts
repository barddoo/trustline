import { Kysely, PostgresDialect } from "kysely";
import type { Pool } from "pg";

import type { SqlStorageOptions, StorageAdapter } from "./interface";
import { createSqlStorage } from "./sql";

export function postgresStorage(
  pool: Pool,
  options?: SqlStorageOptions,
): StorageAdapter {
  return createSqlStorage(
    new Kysely({
      dialect: new PostgresDialect({
        pool,
      }),
    }),
    "postgres",
    options,
  );
}
