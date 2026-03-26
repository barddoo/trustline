import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    "adapters/mysql/index": "src/adapters/mysql/index.ts",
    "adapters/postgres/index": "src/adapters/postgres/index.ts",
    "adapters/sqlite/index": "src/adapters/sqlite/index.ts",
    "client/index": "src/client/index.ts",
    "frameworks/express/index": "src/frameworks/express/index.ts",
    "frameworks/fastify/index": "src/frameworks/fastify/index.ts",
    "frameworks/hono/index": "src/frameworks/hono/index.ts",
    index: "src/index.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "node18",
});
