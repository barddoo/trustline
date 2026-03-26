import Database from "better-sqlite3";

import type { ServiceClient, SigningKey, StorageAdapter } from "./interface";

export function sqliteStorage(path: string): StorageAdapter {
  const database = new Database(path);
  database.pragma("journal_mode = WAL");

  database.exec(`
    create table if not exists trustline_clients (
      id text not null,
      client_id text primary key,
      client_secret text not null,
      name text not null,
      scopes text not null,
      created_at text not null,
      last_seen_at text
    );

    create table if not exists trustline_signing_keys (
      key_id text primary key,
      algorithm text not null,
      private_key text not null,
      public_key text not null,
      created_at text not null,
      retired_at text
    );
  `);

  return {
    async findClient(clientId) {
      const row = database
        .prepare(
          `
            select id, client_id, client_secret, name, scopes, created_at, last_seen_at
            from trustline_clients
            where client_id = ?
          `,
        )
        .get(clientId) as ClientRow | undefined;

      return row ? mapClientRow(row) : null;
    },
    async createClient(client) {
      database
        .prepare(
          `
            insert into trustline_clients (
              id, client_id, client_secret, name, scopes, created_at, last_seen_at
            ) values (?, ?, ?, ?, ?, ?, ?)
          `,
        )
        .run(
          client.id,
          client.clientId,
          client.clientSecret,
          client.name,
          JSON.stringify(client.scopes),
          client.createdAt.toISOString(),
          client.lastSeenAt?.toISOString() ?? null,
        );
    },
    async deleteClient(clientId) {
      database
        .prepare(`delete from trustline_clients where client_id = ?`)
        .run(clientId);
    },
    async listClients() {
      const rows = database
        .prepare(
          `
            select id, client_id, client_secret, name, scopes, created_at, last_seen_at
            from trustline_clients
            order by created_at asc
          `,
        )
        .all() as ClientRow[];

      return rows.map(mapClientRow);
    },
    async touchClient(clientId, lastSeenAt) {
      database
        .prepare(
          `update trustline_clients set last_seen_at = ? where client_id = ?`,
        )
        .run(lastSeenAt.toISOString(), clientId);
    },
    async getSigningKeys() {
      const rows = database
        .prepare(
          `
            select key_id, algorithm, private_key, public_key, created_at, retired_at
            from trustline_signing_keys
            order by created_at asc
          `,
        )
        .all() as SigningKeyRow[];

      return rows.map(mapSigningKeyRow);
    },
    async addSigningKey(key) {
      database
        .prepare(
          `
            insert into trustline_signing_keys (
              key_id, algorithm, private_key, public_key, created_at, retired_at
            ) values (?, ?, ?, ?, ?, ?)
          `,
        )
        .run(
          key.keyId,
          key.algorithm,
          key.privateKey,
          key.publicKey,
          key.createdAt.toISOString(),
          key.retiredAt?.toISOString() ?? null,
        );
    },
    async retireKey(keyId) {
      database
        .prepare(
          `update trustline_signing_keys set retired_at = ? where key_id = ?`,
        )
        .run(new Date().toISOString(), keyId);
    },
  };
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
