import { type Kysely, sql } from "kysely";

import type {
  ServiceClient,
  SigningKey,
  SqlStorageOptions,
  StorageAdapter,
} from "./interface";

type SqlDialect = "mysql" | "postgres" | "sqlite";

interface SqlTables {
  clients: string;
  signingKeys: string;
}

interface SqlDatabase {
  [tableName: string]: SqlRow;
}

interface SqlRow {
  algorithm?: SigningKey["algorithm"];
  client_id?: string;
  client_secret?: string;
  created_at: string;
  id?: string;
  key_id?: string;
  last_seen_at?: string | null;
  name?: string;
  private_key?: string;
  public_key?: string;
  retired_at?: string | null;
  scopes?: string;
}

interface ClientRow {
  id: string;
  client_id: string;
  client_secret: string;
  name: string;
  scopes: string;
  created_at: string;
  last_seen_at: string | null;
}

interface SigningKeyRow {
  key_id: string;
  algorithm: SigningKey["algorithm"];
  private_key: string;
  public_key: string;
  created_at: string;
  retired_at: string | null;
}

export function createSqlStorage(
  database: Kysely<SqlDatabase>,
  dialect: SqlDialect,
  options?: SqlStorageOptions,
): StorageAdapter {
  const tables = resolveTables(options);
  let schemaPromise: Promise<void> | null = null;

  async function ensureSchema(): Promise<void> {
    if (!schemaPromise) {
      schemaPromise = createSchema(database, dialect, tables);
    }

    await schemaPromise;
  }

  return {
    async findClient(clientId) {
      await ensureSchema();

      const row = (await database
        .selectFrom(tables.clients)
        .selectAll()
        .where("client_id", "=", clientId)
        .executeTakeFirst()) as ClientRow | undefined;

      return row ? mapClientRow(row) : null;
    },
    async createClient(client) {
      await ensureSchema();

      await database
        .insertInto(tables.clients)
        .values({
          id: client.id,
          client_id: client.clientId,
          client_secret: client.clientSecret,
          name: client.name,
          scopes: JSON.stringify(client.scopes),
          created_at: client.createdAt.toISOString(),
          last_seen_at: client.lastSeenAt?.toISOString() ?? null,
        })
        .execute();
    },
    async deleteClient(clientId) {
      await ensureSchema();

      await database
        .deleteFrom(tables.clients)
        .where("client_id", "=", clientId)
        .execute();
    },
    async listClients() {
      await ensureSchema();

      const rows = (await database
        .selectFrom(tables.clients)
        .selectAll()
        .orderBy("created_at", "asc")
        .execute()) as ClientRow[];

      return rows.map(mapClientRow);
    },
    async touchClient(clientId, lastSeenAt) {
      await ensureSchema();

      await database
        .updateTable(tables.clients)
        .set({
          last_seen_at: lastSeenAt.toISOString(),
        })
        .where("client_id", "=", clientId)
        .execute();
    },
    async getSigningKeys() {
      await ensureSchema();

      const rows = (await database
        .selectFrom(tables.signingKeys)
        .selectAll()
        .orderBy("created_at", "asc")
        .execute()) as SigningKeyRow[];

      return rows.map(mapSigningKeyRow);
    },
    async addSigningKey(key) {
      await ensureSchema();

      await database
        .insertInto(tables.signingKeys)
        .values({
          key_id: key.keyId,
          algorithm: key.algorithm,
          private_key: key.privateKey,
          public_key: key.publicKey,
          created_at: key.createdAt.toISOString(),
          retired_at: key.retiredAt?.toISOString() ?? null,
        })
        .execute();
    },
    async retireKey(keyId) {
      await ensureSchema();

      await database
        .updateTable(tables.signingKeys)
        .set({
          retired_at: new Date().toISOString(),
        })
        .where("key_id", "=", keyId)
        .execute();
    },
  };
}

function resolveTables(options?: SqlStorageOptions): SqlTables {
  const prefix = options?.tablePrefix ?? "trustline_";

  return {
    clients: options?.tables?.clients ?? `${prefix}clients`,
    signingKeys: options?.tables?.signingKeys ?? `${prefix}signing_keys`,
  };
}

async function createSchema(
  database: Kysely<SqlDatabase>,
  dialect: SqlDialect,
  tables: SqlTables,
): Promise<void> {
  await createClientsTable(database, dialect, tables.clients);
  await createSigningKeysTable(database, dialect, tables.signingKeys);
}

async function createClientsTable(
  database: Kysely<SqlDatabase>,
  dialect: SqlDialect,
  tableName: string,
): Promise<void> {
  if (dialect === "mysql") {
    await sql`
      create table if not exists ${sql.table(tableName)} (
        id varchar(255) not null,
        client_id varchar(255) not null primary key,
        client_secret text not null,
        name varchar(255) not null,
        scopes text not null,
        created_at varchar(64) not null,
        last_seen_at varchar(64) null
      )
    `.execute(database);
    return;
  }

  await sql`
    create table if not exists ${sql.table(tableName)} (
      id varchar(255) not null,
      client_id varchar(255) not null primary key,
      client_secret text not null,
      name varchar(255) not null,
      scopes text not null,
      created_at varchar(64) not null,
      last_seen_at varchar(64)
    )
  `.execute(database);
}

async function createSigningKeysTable(
  database: Kysely<SqlDatabase>,
  dialect: SqlDialect,
  tableName: string,
): Promise<void> {
  if (dialect === "mysql") {
    await sql`
      create table if not exists ${sql.table(tableName)} (
        key_id varchar(255) not null primary key,
        algorithm varchar(32) not null,
        private_key text not null,
        public_key text not null,
        created_at varchar(64) not null,
        retired_at varchar(64) null
      )
    `.execute(database);
    return;
  }

  await sql`
    create table if not exists ${sql.table(tableName)} (
      key_id varchar(255) not null primary key,
      algorithm varchar(32) not null,
      private_key text not null,
      public_key text not null,
      created_at varchar(64) not null,
      retired_at varchar(64)
    )
  `.execute(database);
}

function mapClientRow(row: ClientRow): ServiceClient {
  return {
    id: row.id,
    clientId: row.client_id,
    clientSecret: row.client_secret,
    name: row.name,
    scopes: JSON.parse(row.scopes) as string[],
    createdAt: new Date(row.created_at),
    lastSeenAt: row.last_seen_at ? new Date(row.last_seen_at) : null,
  };
}

function mapSigningKeyRow(row: SigningKeyRow): SigningKey {
  return {
    keyId: row.key_id,
    algorithm: row.algorithm,
    privateKey: row.private_key,
    publicKey: row.public_key,
    createdAt: new Date(row.created_at),
    retiredAt: row.retired_at ? new Date(row.retired_at) : null,
  };
}
