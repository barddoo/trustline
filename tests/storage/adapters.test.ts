import type { Pool as MysqlPool } from "mysql2";
import type { Pool as PostgresPool } from "pg";
import { describe, expect, it } from "vitest";

import {
  memoryStorage,
  mysqlStorage,
  postgresStorage,
  sqliteStorage,
} from "../../src";

describe("storage adapter exports", () => {
  it("exports all storage factories", () => {
    expect(typeof memoryStorage).toBe("function");
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
