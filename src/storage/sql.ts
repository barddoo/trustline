import { type Kysely, sql } from "kysely";

import { verifySecret } from "../core/crypto";
import type {
  ClientSecretRecord,
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
  created_at?: string;
  current_secret_created_at?: string;
  current_secret_hash?: string;
  current_secret_last_used_at?: string | null;
  id?: string;
  key_id?: string;
  last_seen_at?: string | null;
  name?: string;
  next_secret_created_at?: string | null;
  next_secret_expires_at?: string | null;
  next_secret_hash?: string | null;
  next_secret_last_used_at?: string | null;
  not_after?: string | null;
  not_before?: string;
  private_key?: string;
  public_key?: string;
  active?: number | boolean;
  scopes?: string;
  secret_last_rotated_at?: string | null;
  tokens_invalid_before?: string | null;
  updated_at?: string;
  jti?: string;
  expires_at?: string;
}

interface ClientRow {
  id: string;
  client_id: string;
  name: string;
  scopes: string;
  created_at: string;
  updated_at: string;
  last_seen_at: string | null;
  current_secret_hash: string;
  current_secret_created_at: string;
  current_secret_last_used_at: string | null;
  next_secret_hash: string | null;
  next_secret_created_at: string | null;
  next_secret_expires_at: string | null;
  next_secret_last_used_at: string | null;
  secret_last_rotated_at: string | null;
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
        .values(mapClientForWrite(client))
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
    async updateClient(clientId, updates) {
      await ensureSchema();

      const values = mapClientUpdatesForWrite(updates);
      if (Object.keys(values).length === 0) {
        return;
      }

      await database
        .updateTable(tables.clients)
        .set(values)
        .where("client_id", "=", clientId)
        .execute();
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
    async findClientBySecret(secret) {
      await ensureSchema();

      const rows = (await database
        .selectFrom(tables.clients)
        .selectAll()
        .execute()) as ClientRow[];

      const now = Date.now();
      for (const row of rows) {
        const client = mapClientRow(row);

        if (await verifySecret(secret, client.currentSecretHash)) {
          return createClientSecretRecord(client, "current");
        }

        const nextSecretExpired =
          client.nextSecretExpiresAt &&
          client.nextSecretExpiresAt.getTime() <= now;
        if (
          client.nextSecretHash &&
          !nextSecretExpired &&
          (await verifySecret(secret, client.nextSecretHash))
        ) {
          return createClientSecretRecord(client, "next");
        }
      }

      return null;
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
  await ensureClientsColumns(database, dialect, tables.clients);
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
        name varchar(255) not null,
        scopes text not null,
        created_at varchar(64) not null,
        updated_at varchar(64) not null,
        last_seen_at varchar(64) null,
        current_secret_hash text not null,
        current_secret_created_at varchar(64) not null,
        current_secret_last_used_at varchar(64) null,
        next_secret_hash text null,
        next_secret_created_at varchar(64) null,
        next_secret_expires_at varchar(64) null,
        next_secret_last_used_at varchar(64) null,
        secret_last_rotated_at varchar(64) null,
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
      name varchar(255) not null,
      scopes text not null,
      created_at varchar(64) not null,
      updated_at varchar(64) not null,
      last_seen_at varchar(64),
      current_secret_hash text not null,
      current_secret_created_at varchar(64) not null,
      current_secret_last_used_at varchar(64),
      next_secret_hash text,
      next_secret_created_at varchar(64),
      next_secret_expires_at varchar(64),
      next_secret_last_used_at varchar(64),
      secret_last_rotated_at varchar(64),
      active boolean not null,
      tokens_invalid_before varchar(64)
    )
  `.execute(database);
}

async function ensureClientsColumns(
  database: Kysely<SqlDatabase>,
  dialect: SqlDialect,
  tableName: string,
): Promise<void> {
  if (dialect === "sqlite") {
    return;
  }

  await addColumnIfMissing(
    database,
    dialect,
    tableName,
    "updated_at",
    "varchar(64) not null default '1970-01-01T00:00:00.000Z'",
  );
  await addColumnIfMissing(
    database,
    dialect,
    tableName,
    "current_secret_hash",
    "text not null default ''",
  );
  await addColumnIfMissing(
    database,
    dialect,
    tableName,
    "current_secret_created_at",
    "varchar(64) not null default '1970-01-01T00:00:00.000Z'",
  );
  await addColumnIfMissing(
    database,
    dialect,
    tableName,
    "current_secret_last_used_at",
    "varchar(64) null",
  );
  await addColumnIfMissing(
    database,
    dialect,
    tableName,
    "next_secret_hash",
    "text null",
  );
  await addColumnIfMissing(
    database,
    dialect,
    tableName,
    "next_secret_created_at",
    "varchar(64) null",
  );
  await addColumnIfMissing(
    database,
    dialect,
    tableName,
    "next_secret_expires_at",
    "varchar(64) null",
  );
  await addColumnIfMissing(
    database,
    dialect,
    tableName,
    "next_secret_last_used_at",
    "varchar(64) null",
  );
  await addColumnIfMissing(
    database,
    dialect,
    tableName,
    "secret_last_rotated_at",
    "varchar(64) null",
  );
}

async function addColumnIfMissing(
  database: Kysely<SqlDatabase>,
  dialect: SqlDialect,
  tableName: string,
  columnName: string,
  definition: string,
): Promise<void> {
  try {
    await sql
      .raw(
        `alter table ${escapeIdentifier(dialect, tableName)} add column ${escapeIdentifier(dialect, columnName)} ${definition}`,
      )
      .execute(database);
  } catch (error) {
    if (!isDuplicateColumnError(error, dialect)) {
      throw error;
    }
  }
}

function escapeIdentifier(dialect: SqlDialect, value: string): string {
  if (dialect === "mysql") {
    return `\`${value.replaceAll("`", "``")}\``;
  }

  return `"${value.replaceAll('"', '""')}"`;
}

function isDuplicateColumnError(error: unknown, dialect: SqlDialect): boolean {
  const message =
    error instanceof Error ? error.message.toLowerCase() : String(error);

  if (dialect === "mysql") {
    return message.includes("duplicate column name");
  }

  return message.includes("already exists");
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

function mapClientForWrite(client: ServiceClient): Record<string, unknown> {
  return {
    id: client.id,
    client_id: client.clientId,
    name: client.name,
    scopes: JSON.stringify(client.scopes),
    created_at: client.createdAt.toISOString(),
    updated_at: client.updatedAt.toISOString(),
    last_seen_at: client.lastSeenAt?.toISOString() ?? null,
    current_secret_hash: client.currentSecretHash,
    current_secret_created_at: client.currentSecretCreatedAt.toISOString(),
    current_secret_last_used_at:
      client.currentSecretLastUsedAt?.toISOString() ?? null,
    next_secret_hash: client.nextSecretHash,
    next_secret_created_at: client.nextSecretCreatedAt?.toISOString() ?? null,
    next_secret_expires_at: client.nextSecretExpiresAt?.toISOString() ?? null,
    next_secret_last_used_at:
      client.nextSecretLastUsedAt?.toISOString() ?? null,
    secret_last_rotated_at: client.secretLastRotatedAt?.toISOString() ?? null,
    active: serializeBoolean(client.active),
    tokens_invalid_before: client.tokensInvalidBefore?.toISOString() ?? null,
  };
}

function mapClientUpdatesForWrite(
  updates: Partial<ServiceClient>,
): Record<string, unknown> {
  const values: Record<string, unknown> = {};

  if ("name" in updates) {
    values.name = updates.name;
  }
  if ("scopes" in updates) {
    values.scopes = JSON.stringify(updates.scopes ?? []);
  }
  if ("updatedAt" in updates) {
    values.updated_at = updates.updatedAt?.toISOString();
  }
  if ("lastSeenAt" in updates) {
    values.last_seen_at = updates.lastSeenAt?.toISOString() ?? null;
  }
  if ("currentSecretHash" in updates) {
    values.current_secret_hash = updates.currentSecretHash;
  }
  if ("currentSecretCreatedAt" in updates) {
    values.current_secret_created_at =
      updates.currentSecretCreatedAt?.toISOString();
  }
  if ("currentSecretLastUsedAt" in updates) {
    values.current_secret_last_used_at =
      updates.currentSecretLastUsedAt?.toISOString() ?? null;
  }
  if ("nextSecretHash" in updates) {
    values.next_secret_hash = updates.nextSecretHash ?? null;
  }
  if ("nextSecretCreatedAt" in updates) {
    values.next_secret_created_at =
      updates.nextSecretCreatedAt?.toISOString() ?? null;
  }
  if ("nextSecretExpiresAt" in updates) {
    values.next_secret_expires_at =
      updates.nextSecretExpiresAt?.toISOString() ?? null;
  }
  if ("nextSecretLastUsedAt" in updates) {
    values.next_secret_last_used_at =
      updates.nextSecretLastUsedAt?.toISOString() ?? null;
  }
  if ("secretLastRotatedAt" in updates) {
    values.secret_last_rotated_at =
      updates.secretLastRotatedAt?.toISOString() ?? null;
  }
  if ("active" in updates) {
    values.active = serializeBoolean(Boolean(updates.active));
  }
  if ("tokensInvalidBefore" in updates) {
    values.tokens_invalid_before =
      updates.tokensInvalidBefore?.toISOString() ?? null;
  }

  return values;
}

function mapClientRow(row: ClientRow): ServiceClient {
  return {
    id: row.id,
    clientId: row.client_id,
    name: row.name,
    scopes: JSON.parse(row.scopes) as string[],
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    lastSeenAt: row.last_seen_at ? new Date(row.last_seen_at) : null,
    currentSecretHash: row.current_secret_hash,
    currentSecretCreatedAt: new Date(row.current_secret_created_at),
    currentSecretLastUsedAt: row.current_secret_last_used_at
      ? new Date(row.current_secret_last_used_at)
      : null,
    nextSecretHash: row.next_secret_hash,
    nextSecretCreatedAt: row.next_secret_created_at
      ? new Date(row.next_secret_created_at)
      : null,
    nextSecretExpiresAt: row.next_secret_expires_at
      ? new Date(row.next_secret_expires_at)
      : null,
    nextSecretLastUsedAt: row.next_secret_last_used_at
      ? new Date(row.next_secret_last_used_at)
      : null,
    secretLastRotatedAt: row.secret_last_rotated_at
      ? new Date(row.secret_last_rotated_at)
      : null,
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

function createClientSecretRecord(
  client: ServiceClient,
  secretKind: "current" | "next",
): ClientSecretRecord {
  return {
    clientId: client.clientId,
    secretKind,
    secretHash:
      secretKind === "current"
        ? client.currentSecretHash
        : (client.nextSecretHash as string),
    currentSecretHash: client.currentSecretHash,
    nextSecretHash: client.nextSecretHash,
    nextSecretCreatedAt: client.nextSecretCreatedAt,
    nextSecretExpiresAt: client.nextSecretExpiresAt,
  };
}

function serializeBoolean(value: boolean): number {
  return value ? 1 : 0;
}

function deserializeBoolean(value: number | boolean | undefined): boolean {
  return value === true || value === 1;
}
