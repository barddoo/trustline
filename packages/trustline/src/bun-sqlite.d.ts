declare module "bun:sqlite" {
  export class Database {
    constructor(path: string);
    close(): void;
    exec(sql: string): void;
    prepare(sql: string): {
      all(...parameters: unknown[]): unknown[];
      columnNames?: string[];
      iterate(...parameters: unknown[]): IterableIterator<unknown>;
      run(...parameters: unknown[]): {
        changes: number | bigint;
        lastInsertRowid: number | bigint;
      };
    };
  }
}
