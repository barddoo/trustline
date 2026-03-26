import { Kysely, MysqlDialect } from "kysely";
import type { Pool } from "mysql2";

import type { SqlStorageOptions, StorageAdapter } from "./interface";
import { createSqlStorage } from "./sql";

export function mysqlStorage(
  pool: Pool,
  options?: SqlStorageOptions,
): StorageAdapter {
  return createSqlStorage(
    new Kysely({
      dialect: new MysqlDialect({
        pool,
      }),
    }),
    "mysql",
    options,
  );
}
