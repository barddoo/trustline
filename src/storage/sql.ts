import { type Kysely, sql } from "kysely";

import type {
  RevokedToken,
  ServiceClient,
  SigningKey,
  SqlStorageOptions,
  StorageAdapter,
} from "./interface";

type SqlDialect = "mysql" | "postgres" | "sqlite";

interface SqlTables {
  clients: string;
  signingKeys: string;
  revokedTokens: string;
}

interface SqlDatabase {
  [tableName: string]: SqlRow;
}

interface SqlRow {
  algorithm?: SigningKey["algorithm"];
  client_id?: string;
  client_secret?: string;
  created_at?: string;
  id?: string;
  key_id?: string;
  last_seen_at?: string | null;
  name?: string;
  not_after?: string | null;
  not_before?: string;
  private_key?: string;
  public_key?: string;
  active?: number | boolean;
  scopes?: string;
  tokens_invalid_before?: string | null;
  jti?: string;
  expires_at?: string;
}

interface ClientRow {
  id: string;
  client_id: string;
  client_secret: string;
  name: string;
  scopes: string;
  created_at: string;
  last_seen_at: string | null;
  active: number | boolean;
  tokens_invalid_before: string | null;
}

interface SigningKeyRow {
  key_id: string;
  algorithm: SigningKey["algorithm"];
  private_key: string;
  public_key: string;
  created_at: string;
  not_before: string;
  not_after: string | null;
}

interface RevokedTokenRow {
  jti: string;
  expires_at: string;
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
          active: serializeBoolean(client.active),
          tokens_invalid_before:
            client.tokensInvalidBefore?.toISOString() ?? null,
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
    async setClientActive(clientId, active) {
      await ensureSchema();

      await database
        .updateTable(tables.clients)
        .set({
          active: serializeBoolean(active),
        })
        .where("client_id", "=", clientId)
        .execute();
    },
    async setTokensInvalidBefore(clientId, at) {
      await ensureSchema();

      await database
        .updateTable(tables.clients)
        .set({
          tokens_invalid_before: at?.toISOString() ?? null,
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
          not_before: key.notBefore.toISOString(),
          not_after: key.notAfter?.toISOString() ?? null,
        })
        .execute();
    },
    async setSigningKeyNotAfter(keyId, notAfter) {
      await ensureSchema();

      await database
        .updateTable(tables.signingKeys)
        .set({
          not_after: notAfter?.toISOString() ?? null,
        })
        .where("key_id", "=", keyId)
        .execute();
    },
    async findRevokedToken(jti) {
      await ensureSchema();

      const row = (await database
        .selectFrom(tables.revokedTokens)
        .selectAll()
        .where("jti", "=", jti)
        .executeTakeFirst()) as RevokedTokenRow | undefined;

      return row ? mapRevokedTokenRow(row) : null;
    },
    async revokeToken(token) {
      await ensureSchema();

      await database
        .insertInto(tables.revokedTokens)
        .values({
          jti: token.jti,
          expires_at: token.expiresAt.toISOString(),
        })
        .execute();
    },
  };
}

function resolveTables(options?: SqlStorageOptions): SqlTables {
  const prefix = options?.tablePrefix ?? "trustline_";

  return {
    clients: options?.tables?.clients ?? `${prefix}clients`,
    signingKeys: options?.tables?.signingKeys ?? `${prefix}signing_keys`,
    revokedTokens: options?.tables?.revokedTokens ?? `${prefix}revoked_tokens`,
  };
}

async function createSchema(
  database: Kysely<SqlDatabase>,
  dialect: SqlDialect,
  tables: SqlTables,
): Promise<void> {
  await createClientsTable(database, dialect, tables.clients);
  await createSigningKeysTable(database, dialect, tables.signingKeys);
  await createRevokedTokensTable(database, dialect, tables.revokedTokens);
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
        last_seen_at varchar(64) null,
        active boolean not null,
        tokens_invalid_before varchar(64) null
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
      last_seen_at varchar(64),
      active boolean not null,
      tokens_invalid_before varchar(64)
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
        not_before varchar(64) not null,
        not_after varchar(64) null
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
      not_before varchar(64) not null,
      not_after varchar(64)
    )
  `.execute(database);
}

async function createRevokedTokensTable(
  database: Kysely<SqlDatabase>,
  dialect: SqlDialect,
  tableName: string,
): Promise<void> {
  if (dialect === "mysql") {
    await sql`
      create table if not exists ${sql.table(tableName)} (
        jti varchar(255) not null primary key,
        expires_at varchar(64) not null
      )
    `.execute(database);
    return;
  }

  await sql`
    create table if not exists ${sql.table(tableName)} (
      jti varchar(255) not null primary key,
      expires_at varchar(64) not null
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
    active: deserializeBoolean(row.active),
    tokensInvalidBefore: row.tokens_invalid_before
      ? new Date(row.tokens_invalid_before)
      : null,
  };
}

function mapSigningKeyRow(row: SigningKeyRow): SigningKey {
  return {
    keyId: row.key_id,
    algorithm: row.algorithm,
    privateKey: row.private_key,
    publicKey: row.public_key,
    createdAt: new Date(row.created_at),
    notBefore: new Date(row.not_before),
    notAfter: row.not_after ? new Date(row.not_after) : null,
  };
}

function mapRevokedTokenRow(row: RevokedTokenRow): RevokedToken {
  return {
    jti: row.jti,
    expiresAt: new Date(row.expires_at),
  };
}

function serializeBoolean(value: boolean): number {
  return value ? 1 : 0;
}

function deserializeBoolean(value: number | boolean | undefined): boolean {
  return value === true || value === 1;
}
