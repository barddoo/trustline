import type { Pool as MysqlPool } from "mysql2";
import type { Pool as PostgresPool } from "pg";
import { describe, expect, it } from "vitest";

import * as trustline from "../../src";
import { mysqlStorage } from "../../src/adapters/mysql";
import { postgresStorage } from "../../src/adapters/postgres";
import { sqliteStorage } from "../../src/adapters/sqlite";

describe("storage adapter exports", () => {
  it("keeps root exports focused on core APIs", () => {
    expect(typeof trustline.memoryStorage).toBe("function");
    expect("sqliteStorage" in trustline).toBe(false);
    expect("postgresStorage" in trustline).toBe(false);
    expect("mysqlStorage" in trustline).toBe(false);
  });

  it("exports storage factories from adapter subpaths", () => {
    expect(typeof sqliteStorage).toBe("function");
    expect(typeof postgresStorage).toBe("function");
    expect(typeof mysqlStorage).toBe("function");
  });

  it("accepts postgres and mysql pool types", () => {
    const postgresPool = {} as PostgresPool;
    const mysqlPool = {} as MysqlPool;

    expect(() => postgresStorage(postgresPool)).not.toThrow();
    expect(() => mysqlStorage(mysqlPool)).not.toThrow();
  });
});
