import { createProvider } from "trustline";
import { sqliteStorage } from "trustline/adapters/sqlite";
import type { ResolvedCliConfig } from "./config";

export function createCliProvider(config: ResolvedCliConfig) {
  return createProvider({
    issuer: config.issuer,
    storage: sqliteStorage(config.sqlitePath, {
      tablePrefix: config.tablePrefix,
    }),
  });
}
